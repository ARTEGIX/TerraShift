"""ISRIC SoilGrids v2.0 client with ~1km Redis Grid Cache (`soil_client.py`).

Queries global soil properties (`clay`, `sand`, `silt`, `phh2o`, `soc`) at 0-5cm
for a `(lat, lon)` coordinate, caches the result in Redis under
`soilgrids:grid:{lat:.2f}:{lon:.2f}` for 24h, and classifies the texture into
one of TerraShift's canonical soil types (`soil_clay_loam`, `soil_sandy_loam`,
`soil_degraded_dry`). Fails gracefully to `None` if offline or unmapped.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app import cache
from app.config import get_settings

log = logging.getLogger(__name__)

SOILGRIDS_PROPERTIES = ("clay", "sand", "silt", "phh2o", "soc")


def soil_cache_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"soilgrids:grid:{rlat:.2f}:{rlon:.2f}"


def classify_soil_type(clay_pct: float | None, sand_pct: float | None, soc_g_kg: float | None) -> str:
    """Map SoilGrids texture & organic carbon to a canonical TerraShift soil profile."""
    if soc_g_kg is not None and soc_g_kg < 8.0 and (sand_pct or 0.0) >= 55.0:
        return "soil_degraded_dry"
    if clay_pct is not None and clay_pct >= 27.0:
        return "soil_clay_loam"
    if sand_pct is not None and sand_pct >= 52.0:
        return "soil_sandy_loam"
    return "soil_clay_loam"


def parse_soilgrids_response(raw: dict[str, Any], lat: float, lon: float) -> dict[str, Any] | None:
    """Extract surface soil properties from an ISRIC SoilGrids v2.0 GeoJSON payload."""
    layers = raw.get("properties", {}).get("layers")
    if not isinstance(layers, list):
        return None

    parsed: dict[str, float] = {}
    for layer in layers:
        name = layer.get("name")
        if name not in SOILGRIDS_PROPERTIES:
            continue
        d_factor = float(layer.get("unit_measure", {}).get("d_factor") or 1.0)
        depths = layer.get("depths") or []
        if not depths:
            continue
        mean_val = depths[0].get("values", {}).get("mean")
        if mean_val is None:
            continue
        parsed[name] = round(float(mean_val) / d_factor, 2)

    if not parsed:
        return None

    clay_pct = parsed.get("clay")
    sand_pct = parsed.get("sand")
    soc_g_kg = parsed.get("soc")
    return {
        "source": "isric_soilgrids",
        "lat": lat,
        "lon": lon,
        "clay_pct": clay_pct,
        "sand_pct": sand_pct,
        "silt_pct": parsed.get("silt"),
        "ph": parsed.get("phh2o"),
        "soc_g_kg": soc_g_kg,
        "inferred_soil_type": classify_soil_type(clay_pct, sand_pct, soc_g_kg),
    }


async def _fetch_soilgrids_raw(lat: float, lon: float) -> dict[str, Any]:
    settings = get_settings()
    params: list[tuple[str, str | float]] = [
        ("lat", lat),
        ("lon", lon),
        ("depth", "0-5cm"),
        ("value", "mean"),
    ]
    for prop in SOILGRIDS_PROPERTIES:
        params.append(("property", prop))

    t0 = time.perf_counter()
    log.info("Calling ISRIC SoilGrids API: url=%s lat=%.2f lon=%.2f", settings.soilgrids_base_url, lat, lon)
    async with httpx.AsyncClient(timeout=settings.soilgrids_timeout_seconds) as client:
        resp = await client.get(settings.soilgrids_base_url, params=params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        log.info("ISRIC SoilGrids API response: status=%d elapsed=%.1fms lat=%.2f lon=%.2f", resp.status_code, elapsed_ms, lat, lon)
        resp.raise_for_status()
        return resp.json()


async def fetch_soilgrids_profile(lat: float, lon: float) -> dict[str, Any] | None:
    """Fetch or load from Redis (`soilgrids:grid:{lat:.2f}:{lon:.2f}`) surface soil telemetry."""
    rlat, rlon, key = soil_cache_key(lat, lon)
    cached_payload = await cache.get_json(key)
    if cached_payload and "inferred_soil_type" in cached_payload:
        return {**cached_payload, "cached": True}

    try:
        raw = await _fetch_soilgrids_raw(rlat, rlon)
        profile = parse_soilgrids_response(raw, rlat, rlon)
        if profile is None:
            log.info("ISRIC SoilGrids returned no surface data for %s (masked/water pixel) — using request soil_type.", key)
            return None
        settings = get_settings()
        await cache.set_json(key, profile, ttl_seconds=settings.cache_ttl_seconds)
        return {**profile, "cached": False}
    except Exception as exc:  # noqa: BLE001
        log.warning("ISRIC SoilGrids fetch failed for %s (%r) — using request soil_type.", key, exc)
        return None
