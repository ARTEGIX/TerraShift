"""Seasonal Climate Forecast client with Redis cache (`forecast_client.py`).

Fetches 6-month ahead ensemble precipitation & temperature outlooks from Open-Meteo
Seasonal Forecast API (SEAS5/CFSv2), cached in Redis under `forecast:grid:{lat:.2f}:{lon:.2f}`.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app import cache
from app.config import get_settings

log = logging.getLogger(__name__)


def forecast_cache_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"forecast:grid:{rlat:.2f}:{rlon:.2f}"


def parse_seasonal_forecast(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Summarize next-6-month rainfall total and mean max temperature from daily ensemble."""
    daily = raw.get("daily")
    if not isinstance(daily, dict):
        return None

    precip_vals = [float(x) for x in (daily.get("precipitation_sum") or []) if x is not None]
    tmax_vals = [float(x) for x in (daily.get("temperature_2m_max") or []) if x is not None]
    if not precip_vals:
        return None

    # ~180 days = 6-month Season 1 outlook
    s1_precip = precip_vals[:180]
    s1_tmax = tmax_vals[:180]
    return {
        "source": "open_meteo_seasonal",
        "horizon_days": len(s1_precip),
        "season1_precip_mm": round(float(sum(s1_precip)), 1),
        "season1_mean_tmax_c": round(float(sum(s1_tmax) / len(s1_tmax)), 2) if s1_tmax else None,
    }


async def _fetch_seasonal_raw(lat: float, lon: float) -> dict[str, Any]:
    settings = get_settings()
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max",
        "models": "ecmwf_seas5",
    }
    t0 = time.perf_counter()
    log.info("Calling Seasonal Forecast API: url=%s lat=%.2f lon=%.2f", settings.seasonal_forecast_base_url, lat, lon)
    async with httpx.AsyncClient(timeout=settings.external_timeout_seconds) as client:
        resp = await client.get(settings.seasonal_forecast_base_url, params=params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        log.info("Seasonal Forecast API response: status=%d elapsed=%.1fms", resp.status_code, elapsed_ms)
        resp.raise_for_status()
        return resp.json()


async def fetch_seasonal_forecast(lat: float, lon: float) -> dict[str, Any] | None:
    """Fetch or load from Redis (`forecast:grid:{lat:.2f}:{lon:.2f}`) 6-month climate outlook."""
    rlat, rlon, key = forecast_cache_key(lat, lon)
    cached_payload = await cache.get_json(key)
    if cached_payload and "season1_precip_mm" in cached_payload:
        return {**cached_payload, "cached": True}

    try:
        raw = await _fetch_seasonal_raw(rlat, rlon)
        parsed = parse_seasonal_forecast(raw)
        if parsed is None:
            return None
        await cache.set_json(key, parsed, ttl_seconds=get_settings().cache_ttl_seconds)
        return {**parsed, "cached": False}
    except Exception as exc:  # noqa: BLE001
        log.warning("Seasonal Forecast fetch failed for %s (%r) — using Ridge projection only.", key, exc)
        return None
