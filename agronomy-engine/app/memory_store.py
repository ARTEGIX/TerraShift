"""Startup In-Memory Pre-Fetcher (`InMemoryLookupStore`) + Contiguous 2D NumPy Matrix.

Loads `crops_catalog`, `soil_profiles`, and `regional_saturation` from MongoDB Atlas
(`lookup_db`) into Python RAM dictionaries on FastAPI startup (`lifespan` event) and
packs a contiguous 2D `np.float64` matrix (`shape = N_crops x 6`) so Layer 2's
Evolutionary Algorithm evaluates thousands of chromosomes in pure RAM with zero network I/O.

Matrix Columns (`self.crop_matrix`, `dtype=np.float64`, `shape=(N_crops, 6)`):
    0: water_demand_mm
    1: drought_tolerance
    2: nitrogen_impact_kg_ha
    3: erosion_cover_factor
    4: input_cost_usd_ha
    5: market_revenue_usd_ha

If `ATLAS_MONGO_URI` / `LOOKUP_MONGO_URI` is not yet configured or unreachable, falls back
deterministically to the built-in seed catalog from `seed_atlas.py`.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import numpy as np
from pymongo import MongoClient

from app.config import get_settings
from seed_atlas import CROPS_CATALOG_SEED, REGIONAL_SATURATION_SEED, SOIL_PROFILES_SEED

log = logging.getLogger(__name__)

# Column indices into `InMemoryLookupStore.crop_matrix`
COL_WATER_DEMAND = 0
COL_DROUGHT_TOL = 1
COL_NITROGEN_IMPACT = 2
COL_EROSION_COVER = 3
COL_INPUT_COST = 4
COL_MARKET_REVENUE = 5

MATRIX_COLUMNS = (
    "water_demand_mm",
    "drought_tolerance",
    "nitrogen_impact_kg_ha",
    "erosion_cover_factor",
    "input_cost_usd_ha",
    "market_revenue_usd_ha",
)

# Friendly aliases so callers can pass either `clay` or `soil_clay_loam`
SOIL_ALIASES: dict[str, str] = {
    "soil_sandy_loam": "soil_sandy_loam",
    "sandy_loam": "soil_sandy_loam",
    "sandy": "soil_sandy_loam",
    "loam": "soil_sandy_loam",
    "soil_clay_loam": "soil_clay_loam",
    "clay_loam": "soil_clay_loam",
    "clay": "soil_clay_loam",
    "silt": "soil_clay_loam",
    "soil_degraded_dry": "soil_degraded_dry",
    "degraded_dry": "soil_degraded_dry",
    "degraded": "soil_degraded_dry",
    "laterite": "soil_degraded_dry",
}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


class InMemoryLookupStore:
    """Singleton holding all `lookup_db` collections and pre-packed NumPy arrays in RAM."""

    def __init__(self) -> None:
        self.source: str = "uninitialized"
        self.crops_by_id: dict[str, dict[str, Any]] = {}
        self.crop_ids: list[str] = []
        self.crop_index: dict[str, int] = {}
        self.crop_matrix: np.ndarray = np.empty((0, 6), dtype=np.float64)
        self.pest_family_ids: np.ndarray = np.empty((0,), dtype=np.int32)
        self.pest_family_vocab: dict[str, int] = {}
        self.category_ids: np.ndarray = np.empty((0,), dtype=np.int32)
        self.soil_profiles: dict[str, dict[str, Any]] = {}
        self.regional_saturation: dict[str, dict[str, Any]] = {}
        self._load_from_seed()

    def _populate(
        self,
        crops_docs: list[dict[str, Any]],
        soil_docs: list[dict[str, Any]],
        region_docs: list[dict[str, Any]],
        source: str,
    ) -> None:
        # Normalize crop records so both `_id` and `id` exist
        normalized_crops: list[dict[str, Any]] = []
        for raw in crops_docs:
            cid = str(raw.get("_id") or raw.get("id"))
            doc = {
                **raw,
                "_id": cid,
                "id": cid,
                "family": raw.get("pest_family", raw.get("family", "unknown")),
                "avg_input_cost_usd_ha": float(raw["input_cost_usd_ha"]),
                "avg_market_revenue_usd_ha": float(raw["market_revenue_usd_ha"]),
            }
            normalized_crops.append(doc)

        normalized_crops.sort(key=lambda d: d["_id"])
        self.crops_by_id = {c["_id"]: c for c in normalized_crops}
        self.crop_ids = [c["_id"] for c in normalized_crops]
        self.crop_index = {cid: idx for idx, cid in enumerate(self.crop_ids)}

        n = len(normalized_crops)
        matrix = np.zeros((n, 6), dtype=np.float64)
        family_vocab: dict[str, int] = {}
        family_codes = np.zeros(n, dtype=np.int32)
        cat_map = {"cash_crop": 0, "legume": 1, "cover_crop": 2, "drought_tolerant": 3}
        cat_codes = np.zeros(n, dtype=np.int32)

        for i, c in enumerate(normalized_crops):
            matrix[i, COL_WATER_DEMAND] = float(c["water_demand_mm"])
            matrix[i, COL_DROUGHT_TOL] = float(c["drought_tolerance"])
            matrix[i, COL_NITROGEN_IMPACT] = float(c["nitrogen_impact_kg_ha"])
            matrix[i, COL_EROSION_COVER] = float(c["erosion_cover_factor"])
            matrix[i, COL_INPUT_COST] = float(c["input_cost_usd_ha"])
            matrix[i, COL_MARKET_REVENUE] = float(c["market_revenue_usd_ha"])

            fam = str(c.get("pest_family", "unknown"))
            if fam not in family_vocab:
                family_vocab[fam] = len(family_vocab)
            family_codes[i] = family_vocab[fam]
            cat_codes[i] = cat_map.get(str(c.get("category", "cash_crop")), 0)

        self.crop_matrix = np.ascontiguousarray(matrix, dtype=np.float64)
        self.pest_family_vocab = family_vocab
        self.pest_family_ids = np.ascontiguousarray(family_codes, dtype=np.int32)
        self.category_ids = np.ascontiguousarray(cat_codes, dtype=np.int32)

        self.soil_profiles = {str(s["_id"]): {**s, "id": str(s["_id"])} for s in soil_docs}
        self.regional_saturation = {str(r["_id"]): {**r, "id": str(r["_id"])} for r in region_docs}
        self.source = source

    def _load_from_seed(self) -> None:
        self._populate(
            CROPS_CATALOG_SEED,
            SOIL_PROFILES_SEED,
            REGIONAL_SATURATION_SEED,
            source="local_seed_fallback",
        )

    def reload_from_atlas(self, uri_override: str | None = None) -> dict[str, Any]:
        """Connect to MongoDB Atlas `lookup_db` and refresh in-memory dictionaries + NumPy matrix."""
        uri = uri_override or get_settings().resolved_lookup_uri()
        if not uri:
            log.info("LOOKUP_MONGO_URI not configured — using deterministic in-memory seed store.")
            self._load_from_seed()
            return self.status()

        try:
            client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=4_000)
            db = client["lookup_db"]
            crops_docs = list(db["crops_catalog"].find({}))
            soil_docs = list(db["soil_profiles"].find({}))
            region_docs = list(db["regional_saturation"].find({}))
            client.close()

            if not crops_docs or not soil_docs or not region_docs:
                log.warning("lookup_db collections empty on Atlas; falling back to local seed catalog.")
                self._load_from_seed()
                return self.status()

            self._populate(crops_docs, soil_docs, region_docs, source="mongodb_atlas_lookup_db")
            log.info(
                "Loaded lookup_db from Atlas into RAM: %d crops (matrix %s), %d soils, %d regions",
                len(self.crop_ids),
                self.crop_matrix.shape,
                len(self.soil_profiles),
                len(self.regional_saturation),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Atlas lookup_db unreachable (%s) — using deterministic seed store.", exc)
            self._load_from_seed()
        return self.status()

    def resolve_crop_id(self, value: str) -> str | None:
        slug = _slug(value)
        if slug.startswith("crop_"):
            slug = slug[5:]
        if slug in self.crops_by_id:
            return slug
        for cid, crop in self.crops_by_id.items():
            name_slug = _slug(crop["name"])
            if name_slug.startswith(slug) or slug in name_slug:
                return cid
        return None

    def resolve_soil_profile(self, soil_type: str) -> dict[str, Any]:
        slug = _slug(soil_type)
        key = SOIL_ALIASES.get(slug, slug)
        if key in self.soil_profiles:
            return self.soil_profiles[key]
        return next(iter(self.soil_profiles.values()))

    def resolve_region_profile(self, region_id: str | None = None, lat: float = 8.31) -> dict[str, Any]:
        if region_id and region_id in self.regional_saturation:
            return self.regional_saturation[region_id]
        # Auto-select based on latitude if not explicitly provided
        inferred = "region_us_midwest" if lat > 23.5 else "region_lk_dryzone"
        return self.regional_saturation.get(inferred) or next(iter(self.regional_saturation.values()))

    def oversupplied_mask(self, region_id: str | None = None, lat: float = 8.31) -> np.ndarray:
        region = self.resolve_region_profile(region_id, lat)
        oversupplied = set(region.get("oversupplied_crops", []))
        return np.array([1.0 if cid in oversupplied else 0.0 for cid in self.crop_ids], dtype=np.float64)

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "crops_count": len(self.crop_ids),
            "matrix_shape": list(self.crop_matrix.shape),
            "matrix_dtype": str(self.crop_matrix.dtype),
            "soil_profiles": list(self.soil_profiles.keys()),
            "regions": list(self.regional_saturation.keys()),
        }


# Global singleton instance pre-fetched on FastAPI lifespan startup
lookup_store = InMemoryLookupStore()
