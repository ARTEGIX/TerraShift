"""NASA POWER Agroclimatology client (monthly, point).

Docs: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

* Coordinates are rounded to 2 dp (≈1.1 km) so nearby farms share a cache entry.
* Responses are cached in Redis for 24 h.
* On timeout / HTTP error / malformed payload a deterministic synthetic dataset is
  returned (``source="fallback"``) so the demo never breaks.
"""
from __future__ import annotations

import calendar
import logging
import math
from datetime import date

import httpx
import numpy as np

from app import cache
from app.config import get_settings
from app.schemas import ClimateData, ClimateMonth

log = logging.getLogger(__name__)

PARAMETERS = ("T2M_MAX", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "EVPTRNS")
FILL_VALUE = -999.0
LATENT_HEAT_MJ_PER_KG = 2.45  # MJ needed to evaporate 1 kg (= 1 mm over 1 m²) of water


def round_coords(lat: float, lon: float) -> tuple[float, float]:
    return round(lat, 2), round(lon, 2)


def year_window(years: int | None = None, today: date | None = None) -> tuple[int, int]:
    """Last *complete* N calendar years (POWER monthly lags ~1-2 months)."""
    years = years or get_settings().nasa_history_years
    end = (today or date.today()).year - 1
    return end - years + 1, end


def cache_key(lat: float, lon: float, start: int, end: int) -> str:
    return f"nasa:power:monthly:{lat:.2f}:{lon:.2f}:{start}-{end}"


# --------------------------------------------------------------------- public
async def fetch_climate(lat: float, lon: float) -> ClimateData:
    lat, lon = round_coords(lat, lon)
    start, end = year_window()
    key = cache_key(lat, lon, start, end)

    cached = await cache.get_json(key)
    if cached:
        data = ClimateData.model_validate(cached)
        data.cached = True
        return data

    try:
        raw = await _request_power(lat, lon, start, end)
        data = parse_power_response(raw, lat, lon, start, end)
        await cache.set_json(key, data.model_dump())
        return data
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        log.warning("NASA POWER unavailable for (%s, %s): %r — using fallback", lat, lon, exc)
        return fallback_climate(lat, lon, start, end)


# --------------------------------------------------------------------- internals
async def _request_power(lat: float, lon: float, start: int, end: int) -> dict:
    settings = get_settings()
    params = {
        "parameters": ",".join(PARAMETERS),
        "community": "AG",
        "latitude": lat,
        "longitude": lon,
        "start": start,
        "end": end,
        "format": "JSON",
    }
    async with httpx.AsyncClient(timeout=settings.nasa_timeout_seconds) as client:
        resp = await client.get(settings.nasa_power_base_url, params=params)
        resp.raise_for_status()
        return resp.json()


def _et_to_mm_per_day(value: float, units: str) -> float:
    u = units.lower().replace(" ", "")
    if "mj" in u:                      # MJ/m^2/day -> mm/day
        return value / LATENT_HEAT_MJ_PER_KG
    if u.startswith("w"):              # W/m^2 -> mm/day
        return value * 86_400 / (LATENT_HEAT_MJ_PER_KG * 1e6)
    return value                       # already mm/day


def parse_power_response(raw: dict, lat: float, lon: float, start: int, end: int) -> ClimateData:
    series: dict[str, dict[str, float]] = raw["properties"]["parameter"]
    meta: dict = raw.get("parameters", {})
    et_units = str(meta.get("EVPTRNS", {}).get("units", "MJ/m^2/day"))

    keys = sorted(k for k in series["T2M_MAX"] if not k.endswith("13"))  # drop annual "YYYY13"
    if not keys:
        raise ValueError("empty POWER payload")

    # Build a frame and interpolate NASA fill values (-999).
    cols = {p: np.array([series[p].get(k, FILL_VALUE) for k in keys], dtype=float) for p in PARAMETERS}
    for p, arr in cols.items():
        arr[arr <= FILL_VALUE + 1] = np.nan
        if np.all(np.isnan(arr)):
            raise ValueError(f"parameter {p} entirely missing")
        idx = np.arange(arr.size)
        mask = np.isnan(arr)
        arr[mask] = np.interp(idx[mask], idx[~mask], arr[~mask])

    monthly: list[ClimateMonth] = []
    for i, k in enumerate(keys):
        year, month = int(k[:4]), int(k[4:6])
        days = calendar.monthrange(year, month)[1]
        monthly.append(
            ClimateMonth(
                month=f"{year:04d}-{month:02d}",
                t2m_max_c=round(float(cols["T2M_MAX"][i]), 2),
                precip_mm=round(float(cols["PRECTOTCORR"][i]) * days, 1),
                solar_kwh_m2_day=round(float(cols["ALLSKY_SFC_SW_DWN"][i]), 2),
                evapotranspiration_mm=round(_et_to_mm_per_day(float(cols["EVPTRNS"][i]), et_units) * days, 1),
            )
        )
    return ClimateData(source="nasa_power", lat=lat, lon=lon, start_year=start, end_year=end, monthly=monthly)


def fallback_climate(lat: float, lon: float, start: int, end: int) -> ClimateData:
    """Deterministic, Sri-Lanka-like bimodal monsoon climate seeded by the rounded coords.

    Same (lat, lon, years) -> identical output, so tests and demos are reproducible.
    """
    seed = (int(round(abs(lat) * 100)) * 100_003 + int(round(abs(lon) * 100)) * 7_919) % (2**32)
    rng = np.random.default_rng(seed)
    dryness = 0.6 + 0.4 * ((seed % 97) / 96)        # 0.6 (wet zone) .. 1.0 (dry zone)

    monthly: list[ClimateMonth] = []
    n = 0
    for year in range(start, end + 1):
        for month in range(1, 13):
            days = calendar.monthrange(year, month)[1]
            # Bimodal rainfall: NE monsoon (Nov-Dec) + SW / inter-monsoon (Apr-May)
            maha = math.exp(-((month - 11.5) ** 2) / 2.5) + math.exp(-((month + 0.5) ** 2) / 2.5)
            yala = 0.6 * math.exp(-((month - 4.5) ** 2) / 1.5)
            precip_day = (0.8 + 9.0 * (maha + yala) / dryness) * rng.uniform(0.75, 1.25)
            precip_day *= 1 - 0.02 * n / 12                 # slight drying trend
            tmax = 31.0 + 2.5 * math.sin((month - 1) / 12 * 2 * math.pi) + 0.04 * n / 12 + rng.normal(0, 0.4)
            solar = 5.2 + 0.8 * math.sin((month - 2) / 12 * 2 * math.pi) + rng.normal(0, 0.15)
            et_day = 2.6 + 0.35 * (tmax - 30) + 0.25 * (solar - 5) + rng.normal(0, 0.1)
            monthly.append(
                ClimateMonth(
                    month=f"{year:04d}-{month:02d}",
                    t2m_max_c=round(tmax, 2),
                    precip_mm=round(max(precip_day, 0) * days, 1),
                    solar_kwh_m2_day=round(solar, 2),
                    evapotranspiration_mm=round(max(et_day, 0.5) * days, 1),
                )
            )
            n += 1
    return ClimateData(source="fallback", lat=lat, lon=lon, start_year=start, end_year=end, monthly=monthly)
