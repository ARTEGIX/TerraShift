"""Startup In-Memory Pre-Fetcher (`InMemoryLookupStore`) + Contiguous 2D NumPy Matrix.

Loads `crops_catalog`, `soil_profiles`, and `regional_saturation` from MongoDB Atlas
(`lookup_db`) into Python RAM dictionaries on FastAPI startup (`lifespan` event) and
packs a contiguous 2D `np.float64` matrix (`shape = N_crops x 6`) so Layer 2's
Evolutionary Algorithm evaluates thousands of chromosomes in pure RAM with zero network I/O.

Also supports region-specific lookup slices (`store.for_region(region_id, ensure_crop_id)`),
where each discovered region has its own viable crops, localized market revenue / input cost
overrides, regional soil profile (`soil_{region_id}`), and external saturation profile.

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
from pymongo import MongoClient, ReplaceOne

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

CAT_MAP = {"cash_crop": 0, "legume": 1, "cover_crop": 2, "drought_tolerant": 3}

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


def _normalize_crop_doc(raw: dict[str, Any]) -> dict[str, Any]:
    raw_id = str(raw.get("_id") or raw.get("id") or "")
    cid = str(raw.get("crop_id") or (raw_id.split(":", 1)[1] if ":" in raw_id else raw_id))
    return {
        **raw,
        "_id": cid,
        "id": cid,
        "crop_id": cid,
        "doc_id": raw_id or cid,
        "region_id": str(raw.get("region_id") or ("global" if ":" not in raw_id else raw_id.split(":", 1)[0])),
        "viable": bool(raw.get("viable", True)),
        "family": raw.get("pest_family", raw.get("family", "unknown")),
        "avg_input_cost_usd_ha": float(raw["input_cost_usd_ha"]),
        "avg_market_revenue_usd_ha": float(raw["market_revenue_usd_ha"]),
    }


def _pack_crop_arrays(
    crops_list: list[dict[str, Any]],
    shared_family_vocab: dict[str, int] | None = None,
) -> tuple[
    dict[str, dict[str, Any]],
    list[str],
    dict[str, int],
    np.ndarray,
    dict[str, int],
    np.ndarray,
    np.ndarray,
]:
    sorted_crops = sorted(crops_list, key=lambda d: d["_id"])
    crops_by_id = {c["_id"]: c for c in sorted_crops}
    crop_ids = [c["_id"] for c in sorted_crops]
    crop_index = {cid: idx for idx, cid in enumerate(crop_ids)}

    n = len(sorted_crops)
    matrix = np.zeros((n, 6), dtype=np.float64)
    family_vocab: dict[str, int] = dict(shared_family_vocab) if shared_family_vocab is not None else {}
    family_codes = np.zeros(n, dtype=np.int32)
    cat_codes = np.zeros(n, dtype=np.int32)

    for i, c in enumerate(sorted_crops):
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
        cat_codes[i] = CAT_MAP.get(str(c.get("category", "cash_crop")), 0)

    return (
        crops_by_id,
        crop_ids,
        crop_index,
        np.ascontiguousarray(matrix, dtype=np.float64),
        family_vocab,
        np.ascontiguousarray(family_codes, dtype=np.int32),
        np.ascontiguousarray(cat_codes, dtype=np.int32),
    )


class RegionalLookupView:
    """Region-scoped view of `InMemoryLookupStore` with a pre-packed regional 2D NumPy matrix."""

    def __init__(
        self,
        parent: InMemoryLookupStore,
        region_id: str,
        crops_list: list[dict[str, Any]],
    ) -> None:
        self.parent = parent
        self.region_id = region_id
        self.source = f"{parent.source}:{region_id}"
        self.soil_profiles = parent.soil_profiles
        self.regional_saturation = parent.regional_saturation
        (
            self.crops_by_id,
            self.crop_ids,
            self.crop_index,
            self.crop_matrix,
            self.pest_family_vocab,
            self.pest_family_ids,
            self.category_ids,
        ) = _pack_crop_arrays(crops_list, shared_family_vocab=parent.pest_family_vocab)

    def resolve_crop_id(self, value: str) -> str | None:
        return self.parent.resolve_crop_id(value)

    def resolve_soil_profile(self, soil_type: str, region_id: str | None = None) -> dict[str, Any]:
        return self.parent.resolve_soil_profile(soil_type, region_id=region_id or self.region_id)

    def resolve_region_profile(
        self,
        region_id: str | None = None,
        lat: float = 8.31,
        lon: float | None = None,
    ) -> dict[str, Any]:
        return self.parent.resolve_region_profile(region_id or self.region_id, lat=lat, lon=lon)

    def oversupplied_mask(self, region_id: str | None = None, lat: float = 8.31) -> np.ndarray:
        region = self.resolve_region_profile(region_id or self.region_id, lat)
        oversupplied = set(region.get("oversupplied_crops", []))
        return np.array([1.0 if cid in oversupplied else 0.0 for cid in self.crop_ids], dtype=np.float64)

    def for_region(self, region_id: str | None, ensure_crop_id: str | None = None) -> RegionalLookupView | InMemoryLookupStore:
        return self.parent.for_region(region_id or self.region_id, ensure_crop_id=ensure_crop_id)


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
        self.regional_crops_by_region: dict[str, dict[str, dict[str, Any]]] = {}
        self._load_from_seed()

    def _populate(
        self,
        crops_docs: list[dict[str, Any]],
        soil_docs: list[dict[str, Any]],
        region_docs: list[dict[str, Any]],
        source: str,
    ) -> None:
        global_crops: dict[str, dict[str, Any]] = {}
        regional_crops: dict[str, dict[str, dict[str, Any]]] = {}

        for raw in crops_docs:
            doc = _normalize_crop_doc(raw)
            reg_id = doc["region_id"]
            cid = doc["_id"]
            if reg_id == "global":
                global_crops[cid] = doc
            else:
                regional_crops.setdefault(reg_id, {})[cid] = doc

        # Ensure global baseline always has at least the seed crops if only regional overrides were returned
        if not global_crops:
            for raw in CROPS_CATALOG_SEED:
                doc = _normalize_crop_doc(raw)
                global_crops[doc["_id"]] = doc

        (
            self.crops_by_id,
            self.crop_ids,
            self.crop_index,
            self.crop_matrix,
            self.pest_family_vocab,
            self.pest_family_ids,
            self.category_ids,
        ) = _pack_crop_arrays(list(global_crops.values()))

        self.regional_crops_by_region = regional_crops
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
            log.warning(
                "⚠️ [DEGRADED] LOOKUP_MONGO_URI / ATLAS_MONGO_URI not configured — using deterministic local_seed_fallback."
            )
            self._load_from_seed()
            return self.status()

        masked = re.sub(r"(mongodb(?:\+srv)?://[^:]+:)[^@]+(@)", r"\1***\2", uri)
        log.info("🔌 Connecting to MongoDB Atlas (lookup_db): %s", masked)
        try:
            client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=5_000)
            db = client["lookup_db"]
            crops_docs = list(db["crops_catalog"].find({}))
            soil_docs = list(db["soil_profiles"].find({}))
            region_docs = list(db["regional_saturation"].find({}))
            client.close()

            if not crops_docs or not soil_docs or not region_docs:
                log.warning(
                    "⚠️ [DEGRADED] lookup_db collections empty on Atlas (run seed_atlas.py); falling back to local_seed_fallback."
                )
                self._load_from_seed()
                return self.status()

            self._populate(crops_docs, soil_docs, region_docs, source="mongodb_atlas_lookup_db")
            log.info(
                "✅ Loaded lookup_db from Atlas into RAM: %d global crops (matrix %s), %d regional crop sets, %d soils, %d regions",
                len(self.crop_ids),
                self.crop_matrix.shape,
                len(self.regional_crops_by_region),
                len(self.soil_profiles),
                len(self.regional_saturation),
            )
        except Exception as exc:  # noqa: BLE001
            log.error(
                "❌ [DB CONNECTION FAILED] Atlas lookup_db unreachable (%s) — using local_seed_fallback. "
                "Check Atlas Network Access IP whitelist (0.0.0.0/0), credentials, or SRV DNS.",
                exc,
            )
            self._load_from_seed()
        return self.status()

    def upsert_region_bundle(
        self,
        region_doc: dict[str, Any],
        soil_doc: dict[str, Any],
        regional_crops: list[dict[str, Any]],
        persist_atlas: bool = True,
    ) -> dict[str, Any]:
        """Save a region's `regional_saturation`, `soil_profiles`, and `crops_catalog` into RAM and MongoDB Atlas."""
        region_id = str(region_doc["_id"])
        soil_id = str(soil_doc["_id"])

        self.regional_saturation[region_id] = {**region_doc, "_id": region_id, "id": region_id}
        self.soil_profiles[soil_id] = {**soil_doc, "_id": soil_id, "id": soil_id}

        normalized_map: dict[str, dict[str, Any]] = {}
        atlas_crop_docs: list[dict[str, Any]] = []
        for raw in regional_crops:
            norm = _normalize_crop_doc({**raw, "region_id": region_id})
            cid = norm["_id"]
            doc_id = f"{region_id}:{cid}"
            norm["doc_id"] = doc_id
            normalized_map[cid] = norm
            atlas_crop_docs.append({**norm, "_id": doc_id})

        if normalized_map:
            self.regional_crops_by_region[region_id] = normalized_map

        persisted = False
        uri = get_settings().resolved_lookup_uri() if persist_atlas else ""
        if uri:
            try:
                client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=4_000)
                db = client["lookup_db"]
                db["regional_saturation"].replace_one({"_id": region_id}, self.regional_saturation[region_id], upsert=True)
                db["soil_profiles"].replace_one({"_id": soil_id}, self.soil_profiles[soil_id], upsert=True)
                if atlas_crop_docs:
                    db["crops_catalog"].bulk_write(
                        [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in atlas_crop_docs]
                    )
                client.close()
                persisted = True
                log.info(
                    "💾 Persisted regional lookup bundle to Atlas lookup_db: region=%s soil=%s crops=%d",
                    region_id,
                    soil_id,
                    len(atlas_crop_docs),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("⚠️ Could not persist region bundle %s to Atlas (%r) — kept in RAM.", region_id, exc)

        return {
            "region_id": region_id,
            "soil_id": soil_id,
            "crops_count": len(normalized_map),
            "persisted_to_atlas": persisted,
        }

    def get_crops_for_region(
        self,
        region_id: str | None = None,
        viable_only: bool = True,
        ensure_crop_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return the region-specific crop catalog (or global catalog if region has no custom overrides)."""
        if not region_id or region_id not in self.regional_crops_by_region:
            return list(self.crops_by_id.values())

        reg_map = self.regional_crops_by_region[region_id]
        merged: list[dict[str, Any]] = []
        for cid, base_doc in self.crops_by_id.items():
            doc = reg_map.get(cid, base_doc)
            if not viable_only or doc.get("viable", True) or (ensure_crop_id and cid == ensure_crop_id):
                merged.append(doc)

        # Ensure at least 4 crops exist for GA evolution diversity
        if len(merged) < 4:
            return [reg_map.get(cid, base_doc) for cid, base_doc in self.crops_by_id.items()]
        return merged

    def for_region(
        self,
        region_id: str | None = None,
        ensure_crop_id: str | None = None,
    ) -> RegionalLookupView | InMemoryLookupStore:
        """Return a `RegionalLookupView` with a contiguous NumPy matrix scoped to `region_id`."""
        if not region_id or region_id not in self.regional_crops_by_region:
            return self
        crops_list = self.get_crops_for_region(region_id, viable_only=True, ensure_crop_id=ensure_crop_id)
        return RegionalLookupView(self, region_id, crops_list)

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

    def resolve_soil_profile(self, soil_type: str, region_id: str | None = None) -> dict[str, Any]:
        slug = _slug(soil_type)
        key = SOIL_ALIASES.get(slug, slug)
        if key in self.soil_profiles:
            return self.soil_profiles[key]
        if region_id:
            reg_soil_key = f"soil_{region_id}"
            if reg_soil_key in self.soil_profiles:
                return self.soil_profiles[reg_soil_key]
        return next(iter(self.soil_profiles.values()))

    def resolve_region_profile(
        self,
        region_id: str | None = None,
        lat: float = 8.31,
        lon: float | None = None,
    ) -> dict[str, Any]:
        if region_id and region_id in self.regional_saturation:
            return self.regional_saturation[region_id]

        # Check if any dynamically ingested region in RAM is within ~1.5 degrees of (lat, lon)
        if lon is not None:
            best_doc: dict[str, Any] | None = None
            best_dist = 2.25  # (1.5 deg)^2
            for rdoc in self.regional_saturation.values():
                c = rdoc.get("centroid")
                if isinstance(c, dict) and "lat" in c and "lon" in c:
                    d2 = (float(c["lat"]) - float(lat)) ** 2 + (float(c["lon"]) - float(lon)) ** 2
                    if d2 < best_dist:
                        best_dist = d2
                        best_doc = rdoc
            if best_doc is not None:
                return best_doc

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
            "regional_crop_sets": list(self.regional_crops_by_region.keys()),
            "matrix_shape": list(self.crop_matrix.shape),
            "matrix_dtype": str(self.crop_matrix.dtype),
            "soil_profiles": list(self.soil_profiles.keys()),
            "regions": list(self.regional_saturation.keys()),
        }


# Global singleton instance pre-fetched on FastAPI lifespan startup
lookup_store = InMemoryLookupStore()
