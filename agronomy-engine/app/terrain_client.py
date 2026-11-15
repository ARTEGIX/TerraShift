"""Terrain Elevation & Slope (`LS` factor) client with Redis cache (`terrain_client.py`).

Queries Copernicus/SRTM DEM elevation across the farm centroid and polygon
vertices via Open-Meteo Elevation API, computes terrain slope (%) and USLE `LS`
erosion factor, and caches in Redis under `terrain:grid:{lat:.2f}:{lon:.2f}`.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

import httpx

from app import cache
from app.config import get_settings

log = logging.getLogger(__name__)


def terrain_cache_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"terrain:grid:{rlat:.2f}:{rlon:.2f}"


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * r * math.asin(min(1.0, math.sqrt(a)))


def compute_slope_and_ls(
    coords: list[tuple[float, float]],
    elevations: list[float],
) -> dict[str, Any]:
    """Compute mean elevation, max terrain slope (%), and USLE LS factor."""
    if not elevations or len(elevations) != len(coords):
        return {"elevation_m": 0.0, "slope_pct": 0.0, "ls_factor": 1.0}

    max_slope_pct = 0.0
    c_lat, c_lon = coords[0]
    c_elev = elevations[0]
    for (v_lat, v_lon), v_elev in zip(coords[1:], elevations[1:]):
        dist = _haversine_m(c_lat, c_lon, v_lat, v_lon)
        if dist >= 10.0:
            slope = abs(v_elev - c_elev) / dist * 100.0
            if slope > max_slope_pct:
                max_slope_pct = slope

    ls_factor = min(2.8, max(0.85, 0.85 + max_slope_pct * 0.08))
    return {
        "source": "copernicus_dem",
        "elevation_m": round(float(sum(elevations) / len(elevations)), 1),
        "slope_pct": round(float(max_slope_pct), 2),
        "ls_factor": round(float(ls_factor), 3),
    }


async def _fetch_elevation_raw(coords: list[tuple[float, float]]) -> list[float]:
    settings = get_settings()
    lats = ",".join(f"{lat:.5f}" for lat, _ in coords)
    lons = ",".join(f"{lon:.5f}" for _, lon in coords)
    t0 = time.perf_counter()
    log.info("Calling Elevation API: url=%s points=%d", settings.elevation_base_url, len(coords))
    async with httpx.AsyncClient(timeout=settings.external_timeout_seconds) as client:
        resp = await client.get(settings.elevation_base_url, params={"latitude": lats, "longitude": lons})
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        log.info("Elevation API response: status=%d elapsed=%.1fms", resp.status_code, elapsed_ms)
        resp.raise_for_status()
        return [float(x) for x in resp.json().get("elevation", [])]


async def fetch_terrain_profile(
    lat: float,
    lon: float,
    polygon_ring: list[tuple[float, float]] | None = None,
) -> dict[str, Any] | None:
    """Fetch or load from Redis (`terrain:grid:{lat:.2f}:{lon:.2f}`) terrain slope & LS factor."""
    rlat, rlon, key = terrain_cache_key(lat, lon)
    cached_payload = await cache.get_json(key)
    if cached_payload and "ls_factor" in cached_payload:
        return {**cached_payload, "cached": True}

    coords: list[tuple[float, float]] = [(lat, lon)]
    if polygon_ring:
        # GeoJSON coordinates are [lon, lat]; sample up to 8 boundary vertices
        step = max(1, len(polygon_ring) // 8)
        for p_lon, p_lat in polygon_ring[::step][:8]:
            coords.append((float(p_lat), float(p_lon)))

    try:
        elevations = await _fetch_elevation_raw(coords)
        profile = compute_slope_and_ls(coords, elevations)
        await cache.set_json(key, profile, ttl_seconds=get_settings().cache_ttl_seconds)
        return {**profile, "cached": False}
    except Exception as exc:  # noqa: BLE001
        log.warning("Elevation fetch failed for %s (%r) — using flat LS=1.0.", key, exc)
        return None
