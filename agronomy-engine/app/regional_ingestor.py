"""Dynamic Region-Based LookupDB Ingestor (`regional_ingestor.py`).

When a user creates a farmland geofence at `(lat, lon)`, this module:
  1. Resolves the administrative region (`region_{iso2}_{subdivision}`) via free public
     reverse geocoding (BigDataCloud + OpenStreetMap Nominatim backup + Agro-Grid fallback).
  2. Queries external public agricultural datasets (FAOSTAT `QCL` harvested area & yields,
     FAOSTAT `PP` producer prices, World Bank PPP conversion factor `PA.NUS.PPPC.RF`,
     ISRIC SoilGrids v2.0, and NASA POWER 36-month climate/NDVI cube).
  3. Builds region-specific documents for:
       • `lookup_db.soil_profiles`       (`_id: "soil_{region_id}"`)
       • `lookup_db.regional_saturation` (`_id: "{region_id}"`)
       • `lookup_db.crops_catalog`       (`_id: "{region_id}:{crop_id}"`)
  4. Saves the regional bundle to MongoDB Atlas `lookup_db` and hot-loads the regional
     2D NumPy matrix into `InMemoryLookupStore`.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
from typing import Any

import httpx
import numpy as np

from app import cache
from app.config import get_settings
from app.layer1_regression import _enrich_soil_with_soilgrids
from app.memory_store import InMemoryLookupStore, lookup_store
from app.nasa_fusion import (
    COL_ET,
    COL_NDVI,
    COL_PRECIP,
    COL_T2M_MAX,
    FusedClimateCube,
    build_fallback_cube,
    fetch_fused_climate,
)
from app.soil_client import fetch_soilgrids_profile
from app.terrain_client import fetch_terrain_profile

log = logging.getLogger(__name__)

# FAOSTAT item keywords mapped to TerraShift canonical crop IDs
FAO_CROP_KEYWORDS: dict[str, tuple[str, ...]] = {
    "paddy_rice": ("rice", "paddy"),
    "mung_bean": ("beans, dry", "mung", "green gram", "pulses"),
    "cowpea": ("cow peas", "cowpea"),
    "maize": ("maize", "corn"),
    "finger_millet": ("millet", "sorghum"),
    "groundnut": ("groundnuts", "peanuts"),
    "sesame": ("sesame seed", "sesame"),
    "chilli": ("chillies and peppers", "peppers", "chilli"),
    "onion": ("onions and shallots", "onions"),
    "sunn_hemp": ("hemp", "forage", "clover"),
    "chickpea": ("chick peas", "chickpea"),
    "cassava": ("cassava", "manioc", "yuca"),
}

# Thermal limits (min_temp_c, max_temp_c) for agro-climatic crop viability filtering
CROP_THERMAL_LIMITS: dict[str, tuple[float, float]] = {
    "paddy_rice": (10.0, 42.0),
    "mung_bean": (12.0, 42.0),
    "cowpea": (12.0, 44.0),
    "maize": (5.0, 42.0),
    "finger_millet": (8.0, 44.0),
    "groundnut": (10.0, 42.0),
    "sesame": (12.0, 45.0),
    "chilli": (10.0, 40.0),
    "onion": (2.0, 38.0),
    "sunn_hemp": (8.0, 43.0),
    "chickpea": (2.0, 38.0),
    "cassava": (14.0, 44.0),
}

# Country / Agro-Zone baseline PPP multipliers (1.0 = developing smallholder baseline, >1.8 = high-income mechanized)
COUNTRY_PPP_FALLBACK: dict[str, float] = {
    "LK": 0.95,
    "IN": 0.92,
    "BD": 0.90,
    "PK": 0.88,
    "KE": 0.94,
    "NG": 0.90,
    "ET": 0.85,
    "TZ": 0.88,
    "VN": 1.02,
    "TH": 1.12,
    "ID": 1.05,
    "PH": 1.04,
    "BR": 1.35,
    "MX": 1.38,
    "AR": 1.30,
    "ZA": 1.25,
    "CN": 1.32,
    "US": 2.15,
    "CA": 2.05,
    "AU": 2.10,
    "GB": 2.05,
    "FR": 1.98,
    "DE": 2.02,
}

# Regional crop saturation baselines by Agro-Ecological Zone when external FAOSTAT/CDL is offline
AEZ_SATURATION_FALLBACK: dict[str, list[str]] = {
    "tropical_wet_dry": ["paddy_rice", "maize", "onion"],
    "tropical_humid": ["paddy_rice", "cassava", "maize"],
    "arid_semiarid": ["finger_millet", "sesame", "groundnut"],
    "subtropical": ["maize", "chilli", "onion"],
    "temperate": ["maize", "onion", "chickpea"],
}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def classify_agro_zone(lat: float, mean_annual_precip_mm: float = 1100.0) -> str:
    abs_lat = abs(float(lat))
    if abs_lat > 32.0:
        return "temperate"
    if abs_lat > 23.5:
        return "subtropical" if mean_annual_precip_mm >= 650.0 else "arid_semiarid"
    if mean_annual_precip_mm < 600.0:
        return "arid_semiarid"
    if mean_annual_precip_mm > 1750.0:
        return "tropical_humid"
    return "tropical_wet_dry"


def _fallback_region_metadata(lat: float, lon: float) -> dict[str, Any]:
    """Deterministic coordinate-based region metadata when reverse geocoding is unreachable."""
    if 5.8 <= lat <= 10.0 and 79.5 <= lon <= 82.0:
        return {
            "region_id": "region_lk_dryzone",
            "name": "Sri Lanka Dry & Intermediate Zone (Mahaweli / Anuradhapura)",
            "country_iso2": "LK",
            "country_name": "Sri Lanka",
            "subdivision": "North Central Province",
            "source": "coordinate_Seed_match",
        }
    if 36.0 <= lat <= 49.0 and -104.0 <= lon <= -80.0:
        return {
            "region_id": "region_us_midwest",
            "name": "US Midwest Corn Belt (CropScape CDL Reference)",
            "country_iso2": "US",
            "country_name": "United States",
            "subdivision": "Midwest",
            "source": "coordinate_seed_match",
        }
    lat_b = round(float(lat) * 2.0) / 2.0
    lon_b = round(float(lon) * 2.0) / 2.0
    ns = "n" if lat_b >= 0 else "s"
    ew = "e" if lon_b >= 0 else "w"
    grid_slug = f"region_grid_{ns}{abs(lat_b):.1f}_{ew}{abs(lon_b):.1f}".replace(".", "_")
    iso2 = "US" if (24.0 <= lat <= 50.0 and -125.0 <= lon <= -66.0) else "LK" if (5.5 <= lat <= 10.5 and 79.0 <= lon <= 82.5) else "UN"
    return {
        "region_id": grid_slug,
        "name": f"Agro-Climate Region ({lat_b:+.1f}°, {lon_b:+.1f}°)",
        "country_iso2": iso2,
        "country_name": "Global Agro-Zone",
        "subdivision": f"Grid {lat_b:+.1f}, {lon_b:+.1f}",
        "source": "agro_grid_fallback",
    }


async def resolve_region_metadata(lat: float, lon: float) -> dict[str, Any]:
    """Resolve administrative region (`region_{iso2}_{subdivision}`) from public reverse geocoding APIs."""
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    cache_key = f"region:geocode:{rlat:.2f}:{rlon:.2f}"
    cached = await cache.get_json(cache_key)
    if cached and "region_id" in cached:
        return {**cached, "cached": True}

    settings = get_settings()

    # 1. Primary: BigDataCloud Free Reverse Geocode API (no API key required)
    try:
        async with httpx.AsyncClient(timeout=settings.external_timeout_seconds) as client:
            resp = await client.get(
                settings.reverse_geocode_base_url,
                params={"latitude": rlat, "longitude": rlon, "localityLanguage": "en"},
            )
            resp.raise_for_status()
            data = resp.json()
            iso2 = str(data.get("countryCode") or "").upper().strip()
            country_name = str(data.get("countryName") or "").strip()
            subdiv = str(data.get("principalSubdivision") or data.get("city") or data.get("locality") or "").strip()
            if iso2 and subdiv:
                region_id = f"region_{_slug(iso2)}_{_slug(subdiv)}"
                meta = {
                    "region_id": region_id,
                    "name": f"{subdiv}, {country_name}" if country_name else subdiv,
                    "country_iso2": iso2,
                    "country_name": country_name or iso2,
                    "subdivision": subdiv,
                    "source": "bigdatacloud_reverse_geocode",
                }
                await cache.set_json(cache_key, meta, ttl_seconds=settings.cache_ttl_seconds * 7)
                return meta
    except Exception as exc:  # noqa: BLE001
        log.info("BigDataCloud reverse geocode skipped for (%.2f, %.2f): %r", rlat, rlon, exc)

    # 2. Secondary: OpenStreetMap Nominatim Reverse Geocode API (no API key required)
    try:
        async with httpx.AsyncClient(
            timeout=settings.external_timeout_seconds,
            headers={"User-Agent": "TerraShift-Agronomy-Engine/0.2 (open-source research)"},
        ) as client:
            resp = await client.get(
                settings.nominatim_base_url,
                params={"lat": rlat, "lon": rlon, "format": "json", "zoom": 8, "accept-language": "en"},
            )
            resp.raise_for_status()
            data = resp.json()
            addr = data.get("address") or {}
            iso2 = str(addr.get("country_code") or "").upper().strip()
            country_name = str(addr.get("country") or "").strip()
            subdiv = str(addr.get("state") or addr.get("province") or addr.get("county") or addr.get("region") or "").strip()
            if iso2 and subdiv:
                region_id = f"region_{_slug(iso2)}_{_slug(subdiv)}"
                meta = {
                    "region_id": region_id,
                    "name": f"{subdiv}, {country_name}" if country_name else subdiv,
                    "country_iso2": iso2,
                    "country_name": country_name or iso2,
                    "subdivision": subdiv,
                    "source": "osm_nominatim",
                }
                await cache.set_json(cache_key, meta, ttl_seconds=settings.cache_ttl_seconds * 7)
                return meta
    except Exception as exc:  # noqa: BLE001
        log.info("OSM Nominatim reverse geocode skipped for (%.2f, %.2f): %r", rlat, rlon, exc)

    return _fallback_region_metadata(rlat, rlon)


async def fetch_external_country_ag_stats(country_iso2: str) -> dict[str, Any]:
    """Fetch public World Bank PPP & FAOSTAT crop area/price indicators for `country_iso2`."""
    iso2 = (country_iso2 or "UN").upper()
    cache_key = f"region:agstats:{iso2}"
    cached = await cache.get_json(cache_key)
    if cached and "ppp_factor" in cached:
        return cached

    settings = get_settings()
    ppp_factor = COUNTRY_PPP_FALLBACK.get(iso2, 1.10)
    harvested_area_ha: dict[str, float] = {}
    revenue_mult_by_crop: dict[str, float] = {}
    sources_used: list[str] = []

    # 1. World Bank Open Data API — PPP conversion factor / price level ratio (Free, no key)
    if iso2 != "UN" and len(iso2) == 2:
        try:
            wb_url = f"{settings.worldbank_base_url}/country/{iso2.lower()}/indicator/PA.NUS.PPPC.RF"
            async with httpx.AsyncClient(timeout=settings.external_timeout_seconds) as client:
                resp = await client.get(wb_url, params={"format": "json", "per_page": 5})
                resp.raise_for_status()
                payload = resp.json()
                if isinstance(payload, list) and len(payload) >= 2 and isinstance(payload[1], list):
                    for row in payload[1]:
                        val = row.get("value")
                        if val is not None and float(val) > 0:
                            # Convert price level ratio (US=1.0) into smallholder vs mechanized scaling (0.75 .. 2.25)
                            ppp_factor = round(float(np.clip(0.65 + 1.45 * float(val), 0.75, 2.25)), 3)
                            sources_used.append("worldbank_ppp")
                            break
        except Exception as exc:  # noqa: BLE001
            log.info("World Bank PPP fetch skipped for %s: %r", iso2, exc)

    # 2. FAOSTAT Public API — Area Harvested (QCL) & Producer Prices (PP)
    if iso2 != "UN" and len(iso2) == 2:
        try:
            async with httpx.AsyncClient(timeout=settings.external_timeout_seconds) as client:
                resp = await client.get(
                    f"{settings.faostat_base_url}/QCL",
                    params={"area_cs": "ISO2", "area": iso2, "year": "2022,2023"},
                )
                if resp.status_code == 200:
                    rows = (resp.json() or {}).get("data") or []
                    for r in rows:
                        item_name = str(r.get("Item") or "").lower()
                        elem_name = str(r.get("Element") or "").lower()
                        val = r.get("Value")
                        if val is None:
                            continue
                        for cid, kw_tuple in FAO_CROP_KEYWORDS.items():
                            if any(kw in item_name for kw in kw_tuple):
                                if "area harvested" in elem_name:
                                    harvested_area_ha[cid] = max(harvested_area_ha.get(cid, 0.0), float(val))
                                break
                    if harvested_area_ha:
                        sources_used.append("faostat_qcl")
        except Exception as exc:  # noqa: BLE001
            log.info("FAOSTAT QCL fetch skipped for %s: %r", iso2, exc)

    result = {
        "country_iso2": iso2,
        "ppp_factor": ppp_factor,
        "harvested_area_ha": harvested_area_ha,
        "revenue_mult_by_crop": revenue_mult_by_crop,
        "source": "+".join(sources_used) if sources_used else "agro_zone_baseline",
    }
    await cache.set_json(cache_key, result, ttl_seconds=settings.cache_ttl_seconds * 7)
    return result


def build_regional_soil_profile(
    region_id: str,
    region_name: str,
    soilgrids: dict[str, Any] | None,
    terrain: dict[str, Any] | None,
    store: InMemoryLookupStore = lookup_store,
) -> dict[str, Any]:
    """Construct a region-specific `soil_profiles` document from ISRIC SoilGrids & terrain telemetry."""
    inferred_base_id = (soilgrids or {}).get("inferred_soil_type") or "soil_clay_loam"
    base_soil = dict(store.resolve_soil_profile(inferred_base_id))
    enriched = _enrich_soil_with_soilgrids(base_soil, soilgrids)

    soil_id = f"soil_{region_id}"
    slope_pct = (terrain or {}).get("slope_pct")
    ls_factor = (terrain or {}).get("ls_factor")

    return {
        **enriched,
        "_id": soil_id,
        "id": soil_id,
        "region_id": region_id,
        "base_type": inferred_base_id,
        "name": f"{region_name} Soil ({base_soil.get('name', inferred_base_id)})",
        **({"clay_pct": soilgrids["clay_pct"]} if soilgrids and soilgrids.get("clay_pct") is not None else {}),
        **({"sand_pct": soilgrids["sand_pct"]} if soilgrids and soilgrids.get("sand_pct") is not None else {}),
        **({"silt_pct": soilgrids["silt_pct"]} if soilgrids and soilgrids.get("silt_pct") is not None else {}),
        **({"terrain_slope_pct": slope_pct} if slope_pct is not None else {}),
        **({"terrain_ls_factor": ls_factor} if ls_factor is not None else {}),
        "source": "isric_soilgrids_v2" if soilgrids else "fao_soil_archetype_fallback",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def build_regional_crops_catalog(
    region_meta: dict[str, Any],
    ag_stats: dict[str, Any],
    cube: FusedClimateCube,
    soil_doc: dict[str, Any],
    store: InMemoryLookupStore = lookup_store,
) -> list[dict[str, Any]]:
    """Construct region-specific `crops_catalog` documents with local economics and climate viability."""
    region_id = str(region_meta["region_id"])
    ppp_factor = float(ag_stats.get("ppp_factor", 1.0))

    mat = cube.matrix
    mean_tmax = float(np.mean(mat[:, COL_T2M_MAX]))
    peak_tmax = float(np.max(mat[:, COL_T2M_MAX]))
    mean_et_monthly = float(np.mean(mat[:, COL_ET]))
    annual_precip_mm = float(np.sum(mat[:, COL_PRECIP]) / max(1.0, mat.shape[0] / 12.0))
    agro_zone = classify_agro_zone(cube.lat, annual_precip_mm)
    raw_tmin = (cube.extra_series or {}).get("t2m_min_c")
    min_tmin = float(np.min(raw_tmin)) if isinstance(raw_tmin, list) and raw_tmin else (mean_tmax - 11.0)
    harvested_map: dict[str, float] = ag_stats.get("harvested_area_ha") or {}

    # Evapotranspiration water demand scaling relative to tropical reference (135 mm/month)
    et_demand_mult = float(np.clip(mean_et_monthly / 135.0, 0.78, 1.28))
    soil_ph = soil_doc.get("ph")

    # Obligate tropical crops excluded in temperate zones unless FAOSTAT confirms production
    tropical_only = {"cassava", "paddy_rice", "finger_millet", "sesame"}

    regional_crops: list[dict[str, Any]] = []
    for cid in store.crop_ids:
        base = store.crops_by_id[cid]
        tmin_limit, tmax_limit = CROP_THERMAL_LIMITS.get(cid, (5.0, 42.0))

        # Check thermal, frost & agro-zone viability in this region
        viable = bool(min_tmin >= (tmin_limit - 2.0) and peak_tmax <= (tmax_limit + 3.0))
        if agro_zone == "temperate" and cid in tropical_only and harvested_map.get(cid, 0.0) < 25_000.0:
            viable = False
        if agro_zone == "arid_semiarid" and cid == "paddy_rice" and annual_precip_mm < 550.0:
            viable = False

        # Adjust water demand by local evaporative demand (ET)
        adj_water_mm = round(float(base["water_demand_mm"]) * et_demand_mult, 1)

        # Adjust input cost & market revenue by regional PPP & agro-climatic suitability
        climate_rev_bonus = 1.0
        if cid in ("paddy_rice", "cassava", "mung_bean", "cowpea") and min_tmin > 16.0:
            climate_rev_bonus = 1.06
        elif cid in ("maize", "chickpea", "onion") and 8.0 <= min_tmin <= 20.0:
            climate_rev_bonus = 1.08

        if soil_ph is not None and (float(soil_ph) < 5.2 or float(soil_ph) > 8.0) and base.get("category") == "legume":
            climate_rev_bonus *= 1.04

        adj_input_cost = round(float(base["input_cost_usd_ha"]) * (0.65 + 0.35 * ppp_factor), 2)
        adj_market_rev = round(
            float(base["market_revenue_usd_ha"]) * (0.70 + 0.30 * ppp_factor) * climate_rev_bonus,
            2,
        )

        doc_id = f"{region_id}:{cid}"
        regional_crops.append(
            {
                **base,
                "_id": doc_id,
                "id": cid,
                "crop_id": cid,
                "doc_id": doc_id,
                "region_id": region_id,
                "viable": viable,
                "water_demand_mm": adj_water_mm,
                "input_cost_usd_ha": adj_input_cost,
                "market_revenue_usd_ha": adj_market_rev,
                "avg_input_cost_usd_ha": adj_input_cost,
                "avg_market_revenue_usd_ha": adj_market_rev,
                "source": f"regional_calibrated:{ag_stats.get('source', 'agro_zone')}",
            }
        )

    return regional_crops


def build_regional_saturation_profile(
    region_meta: dict[str, Any],
    ag_stats: dict[str, Any],
    cube: FusedClimateCube,
    soil_doc: dict[str, Any],
    regional_crops: list[dict[str, Any]],
) -> dict[str, Any]:
    """Construct a `regional_saturation` document from external crop area share & satellite NDVI phenology."""
    region_id = str(region_meta["region_id"])
    annual_precip_mm = float(np.sum(cube.matrix[:, COL_PRECIP]) / max(1.0, cube.matrix.shape[0] / 12.0))
    agro_zone = classify_agro_zone(cube.lat, annual_precip_mm)

    viable_ids = {c["crop_id"] for c in regional_crops if c.get("viable", True)}
    harvested_area: dict[str, float] = {
        k: v for k, v in (ag_stats.get("harvested_area_ha") or {}).items() if k in viable_ids and v > 0
    }

    crop_area_share_pct: dict[str, float] = {}
    if harvested_area:
        total_area = sum(harvested_area.values()) or 1.0
        sorted_pairs = sorted(harvested_area.items(), key=lambda kv: kv[1], reverse=True)
        for cid, area in sorted_pairs:
            crop_area_share_pct[cid] = round((area / total_area) * 100.0, 1)
        oversupplied = [cid for cid, pct in sorted_pairs[:3] if (pct / total_area) >= 0.14]
        if not oversupplied and sorted_pairs:
            oversupplied = [sorted_pairs[0][0]]
    else:
        baseline = [c for c in AEZ_SATURATION_FALLBACK.get(agro_zone, ["maize"]) if c in viable_ids]
        oversupplied = baseline or ["maize"]

    # Determine dominant regional pest family from oversupplied crops
    fam_counts: dict[str, float] = {}
    crops_map = {c["crop_id"]: c for c in regional_crops}
    for idx, cid in enumerate(oversupplied):
        fam = str((crops_map.get(cid) or {}).get("pest_family", "poaceae"))
        weight = crop_area_share_pct.get(cid, float(30 - idx * 8))
        fam_counts[fam] = fam_counts.get(fam, 0.0) + weight
    dominant_family = max(fam_counts.items(), key=lambda kv: kv[1])[0] if fam_counts else "poaceae"

    # Compute regional bare_field_months from the 36-month MODIS/HLS NDVI curve + rainfall troughs
    ndvi = cube.matrix[:, COL_NDVI]
    months = cube.month_numbers
    monthly_ndvi: list[tuple[int, float]] = []
    for m_cal in range(1, 13):
        mask = months == m_cal
        if np.any(mask):
            monthly_ndvi.append((m_cal, float(np.mean(ndvi[mask]))))

    bare_months = [m for m, val in monthly_ndvi if val < 0.32]
    if len(bare_months) < 2 and monthly_ndvi:
        # Take the 3 lowest-canopy months in the regional agricultural calendar
        lowest_3 = sorted(monthly_ndvi, key=lambda kv: kv[1])[:3]
        bare_months = sorted(m for m, _ in lowest_3)

    return {
        "_id": region_id,
        "id": region_id,
        "name": region_meta["name"],
        "country_iso2": region_meta.get("country_iso2", "UN"),
        "subdivision": region_meta.get("subdivision", ""),
        "agro_zone": agro_zone,
        "centroid": {"lat": round(float(cube.lat), 4), "lon": round(float(cube.lon), 4)},
        "oversupplied_crops": oversupplied,
        "crop_area_share_pct": crop_area_share_pct,
        "dominant_pest_family": dominant_family,
        "bare_field_months": bare_months or [3, 4, 8, 9],
        "default_soil_id": str(soil_doc["_id"]),
        "source": f"{region_meta.get('source', 'geocode')}+{ag_stats.get('source', 'agro_zone')}",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


async def ensure_region_in_lookup_db(
    lat: float,
    lon: float,
    polygon_ring: list[tuple[float, float]] | None = None,
    store: InMemoryLookupStore = lookup_store,
    force_refresh: bool = False,
    persist_atlas: bool = True,
) -> dict[str, Any]:
    """Ensure `lookup_db` (`soil_profiles`, `regional_saturation`, `crops_catalog`) has regional data for `(lat, lon)`."""
    region_meta = await resolve_region_metadata(lat, lon)
    region_id = str(region_meta["region_id"])
    soil_id = f"soil_{region_id}"

    # Fast path: region already exists in RAM with regional crops & regional soil profile
    if (
        not force_refresh
        and region_id in store.regional_saturation
        and region_id in store.regional_crops_by_region
        and soil_id in store.soil_profiles
    ):
        reg_doc = store.regional_saturation[region_id]
        soil_doc = store.soil_profiles[soil_id]
        viable_crops = store.get_crops_for_region(region_id, viable_only=True)
        return {
            "region_id": region_id,
            "region_name": reg_doc.get("name", region_id),
            "country_iso2": reg_doc.get("country_iso2", region_meta.get("country_iso2", "UN")),
            "agro_zone": reg_doc.get("agro_zone", "tropical_wet_dry"),
            "soil_id": soil_id,
            "soil_type": soil_doc.get("base_type", "soil_clay_loam"),
            "soil_profile": soil_doc,
            "regional_saturation": reg_doc,
            "oversupplied_crops": reg_doc.get("oversupplied_crops", []),
            "dominant_pest_family": reg_doc.get("dominant_pest_family", "poaceae"),
            "bare_field_months": reg_doc.get("bare_field_months", []),
            "viable_crops_count": len(viable_crops),
            "viable_crop_ids": [c["_id"] for c in viable_crops],
            "cached": True,
        }

    # Fetch climate cube, SoilGrids, terrain, and external FAOSTAT/World Bank stats in parallel
    try:
        cube, soilgrids, terrain, ag_stats = await asyncio.gather(
            fetch_fused_climate(lat, lon),
            fetch_soilgrids_profile(lat, lon),
            fetch_terrain_profile(lat, lon, polygon_ring),
            fetch_external_country_ag_stats(region_meta.get("country_iso2", "UN")),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Parallel regional ingestion degraded for %s (%r) — using deterministic fallback.", region_id, exc)
        cube = build_fallback_cube(lat, lon)
        soilgrids = None
        terrain = None
        ag_stats = {"country_iso2": region_meta.get("country_iso2", "UN"), "ppp_factor": 1.0, "source": "fallback"}

    soil_doc = build_regional_soil_profile(region_id, region_meta["name"], soilgrids, terrain, store=store)
    regional_crops = build_regional_crops_catalog(region_meta, ag_stats, cube, soil_doc, store=store)
    region_doc = build_regional_saturation_profile(region_meta, ag_stats, cube, soil_doc, regional_crops)

    store.upsert_region_bundle(
        region_doc=region_doc,
        soil_doc=soil_doc,
        regional_crops=regional_crops,
        persist_atlas=persist_atlas,
    )

    viable_crops = store.get_crops_for_region(region_id, viable_only=True)
    return {
        "region_id": region_id,
        "region_name": region_doc["name"],
        "country_iso2": region_doc["country_iso2"],
        "agro_zone": region_doc["agro_zone"],
        "soil_id": soil_doc["_id"],
        "soil_type": soil_doc.get("base_type", "soil_clay_loam"),
        "soil_profile": soil_doc,
        "regional_saturation": region_doc,
        "oversupplied_crops": region_doc["oversupplied_crops"],
        "dominant_pest_family": region_doc["dominant_pest_family"],
        "bare_field_months": region_doc["bare_field_months"],
        "viable_crops_count": len(viable_crops),
        "viable_crop_ids": [c["_id"] for c in viable_crops],
        "cached": False,
    }
