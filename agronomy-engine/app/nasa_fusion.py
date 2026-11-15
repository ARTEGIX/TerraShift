"""Step 0: Spatial-Temporal Data Fusion + ~1km Redis Grid Cache (`nasa_fusion.py`).

1. Rounds geofence centroid `(lat, lon)` to 2 decimal places (`~1.1 km` grid cell)
   and checks Redis key `nasa:grid:{lat:.2f}:{lon:.2f}` (TTL = 24 hours).
2. Fetches monthly agroclimatology data from NASA POWER (`T2M_MAX`, `PRECTOTCORR`,
   `ALLSKY_SFC_SW_DWN`, `EVPTRNS`), or falls back deterministically if offline.
3. Harmonizes the last 36 months with simulated SMAP L4 root-zone soil moisture (%)
   and MODIS / Sentinel-2 NDVI into a contiguous 36x6 `np.float64` matrix in RAM:

   Columns of `FusedClimateCube.matrix` (`shape=(36, 6)`, `dtype=np.float64`):
       0: t2m_max_c          (°C)
       1: precip_mm          (mm / month)
       2: solar_kwh_m2_day   (kWh / m² / day)
       3: et_mm              (evapotranspiration, mm / month)
       4: smap_moisture_pct  (SMAP root-zone soil moisture, %)
       5: ndvi               (MODIS/Sentinel-2 normalized difference vegetation index, 0..1)
"""
from __future__ import annotations

import calendar
import logging
import math
import time
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx
import numpy as np

from app import appeears_client, cache
from app.config import get_settings

log = logging.getLogger(__name__)

PARAMETERS = ("T2M_MAX", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "EVPTRNS")
SOIL_PARAMETERS = ("GWETROOT", "GWETTOP")
EXTRA_PARAMETERS = ("T2M_MIN", "RH2M")
FILL_VALUE = -999.0
LATENT_HEAT_MJ_PER_KG = 2.45
MJ_PER_KWH = 3.6
FUSION_MONTHS = 36

# Column indices in the (36, 6) fused NumPy array
COL_T2M_MAX = 0
COL_PRECIP = 1
COL_SOLAR = 2
COL_ET = 3
COL_SMAP_MOISTURE = 4
COL_NDVI = 5


@dataclass
class FusedClimateCube:
    """In-memory 36-month spatial-temporal fused climate & remote-sensing cube."""

    lat: float
    lon: float
    grid_key: str
    source: str  # "nasa_power" | "fallback"
    cached: bool
    months: list[str]            # length 36, "YYYY-MM"
    month_numbers: np.ndarray    # shape (36,), int32 (1..12)
    matrix: np.ndarray           # shape (36, 6), float64
    extra_series: dict[str, list[float]] | None = None

    def to_cache_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "lat": self.lat,
            "lon": self.lon,
            "grid_key": self.grid_key,
            "source": self.source,
            "months": self.months,
            "month_numbers": self.month_numbers.tolist(),
            "matrix": self.matrix.tolist(),
        }
        if self.extra_series:
            payload["extra_series"] = self.extra_series
        return payload

    @classmethod
    def from_cache_dict(cls, data: dict[str, Any], cached: bool = True) -> "FusedClimateCube":
        return cls(
            lat=float(data["lat"]),
            lon=float(data["lon"]),
            grid_key=str(data["grid_key"]),
            source=str(data["source"]),
            cached=cached,
            months=list(data["months"]),
            month_numbers=np.asarray(data["month_numbers"], dtype=np.int32),
            matrix=np.ascontiguousarray(data["matrix"], dtype=np.float64),
            extra_series=data.get("extra_series"),
        )

    def to_monthly_records(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        extra = self.extra_series or {}
        t2m_min = extra.get("t2m_min_c")
        rh2m = extra.get("rh2m_pct")
        for i, m in enumerate(self.months):
            row = self.matrix[i]
            rec: dict[str, Any] = {
                "month": m,
                "t2m_max_c": round(float(row[COL_T2M_MAX]), 2),
                "precip_mm": round(float(row[COL_PRECIP]), 1),
                "solar_kwh_m2_day": round(float(row[COL_SOLAR]), 2),
                "evapotranspiration_mm": round(float(row[COL_ET]), 1),
                "smap_rootzone_pct": round(float(row[COL_SMAP_MOISTURE]), 1),
                "ndvi": round(float(row[COL_NDVI]), 3),
            }
            if t2m_min and i < len(t2m_min):
                rec["t2m_min_c"] = round(float(t2m_min[i]), 2)
            if rh2m and i < len(rh2m):
                rec["rh2m_pct"] = round(float(rh2m[i]), 1)
            out.append(rec)
        return out


def grid_cache_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"nasa:grid:{rlat:.2f}:{rlon:.2f}"


def _year_window_36m(today: date | None = None) -> tuple[int, int]:
    end_year = (today or date.today()).year - 1
    return end_year - 2, end_year


def _harmonize_smap_and_ndvi(
    precip_mm: np.ndarray,
    et_mm: np.ndarray,
    t2m_max_c: np.ndarray,
    water_holding_mm_m: float = 140.0,
    smap_override_pct: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Use real NASA GWETROOT when available (or synthesize SMAP moisture) and derive interim NDVI."""
    n = precip_mm.size
    ndvi = np.zeros(n, dtype=np.float64)

    if smap_override_pct is not None:
        smap_pct = np.clip(smap_override_pct, 0.0, 100.0)
    else:
        smap_pct = np.zeros(n, dtype=np.float64)
        storage = 0.55 * water_holding_mm_m
        for i in range(n):
            net_flux = 0.78 * precip_mm[i] - 0.62 * et_mm[i]
            storage = float(np.clip(storage * 0.82 + net_flux * 0.38, 0.12 * water_holding_mm_m, water_holding_mm_m))
            smap_pct[i] = np.clip(100.0 * (storage / water_holding_mm_m), 10.0, 96.0)

    for i in range(n):
        # Vegetation greenness lags root-zone moisture slightly and drops under extreme heat
        lag_moisture = smap_pct[i] if i == 0 else 0.65 * smap_pct[i] + 0.35 * smap_pct[i - 1]
        heat_stress = max(0.0, float(t2m_max_c[i]) - 34.0) * 0.025
        ndvi[i] = float(np.clip(0.16 + 0.0068 * lag_moisture - heat_stress, 0.14, 0.84))

    return smap_pct, ndvi


async def _fetch_power_raw(lat: float, lon: float, start_year: int, end_year: int) -> dict[str, Any]:
    settings = get_settings()
    params = {
        "parameters": ",".join(PARAMETERS + EXTRA_PARAMETERS),
        "community": "AG",
        "latitude": lat,
        "longitude": lon,
        "start": start_year,
        "end": end_year,
        "format": "JSON",
    }
    t0 = time.perf_counter()
    log.info("Calling NASA POWER API: url=%s lat=%.2f lon=%.2f years=%s-%s", settings.nasa_power_base_url, lat, lon, start_year, end_year)
    async with httpx.AsyncClient(timeout=settings.nasa_timeout_seconds) as client:
        resp = await client.get(settings.nasa_power_base_url, params=params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        log.info("NASA POWER API response: status=%d elapsed=%.1fms lat=%.2f lon=%.2f", resp.status_code, elapsed_ms, lat, lon)
        resp.raise_for_status()
        return resp.json()


def _interpolate_series(raw_map: dict[str, float], ym_keys: list[str], name: str) -> np.ndarray:
    """Convert a NASA POWER parameter dict into a gap-filled float64 array."""
    arr = np.array([raw_map.get(k, FILL_VALUE) for k in ym_keys], dtype=np.float64)
    arr[arr <= FILL_VALUE + 1] = np.nan
    if np.all(np.isnan(arr)):
        raise ValueError(f"NASA POWER parameter {name} is all NaN")
    idx = np.arange(arr.size)
    mask = np.isnan(arr)
    if np.any(mask):
        arr[mask] = np.interp(idx[mask], idx[~mask], arr[~mask])
    return arr


def _apply_appeears_override(
    smap_pct: np.ndarray,
    ndvi: np.ndarray,
    months: list[str],
    appeears_override: dict[str, Any] | None,
) -> tuple[np.ndarray, np.ndarray, bool]:
    """Replace simulated SMAP/NDVI with pre-fetched AppEEARS satellite arrays when aligned."""
    if not appeears_override or appeears_override.get("months") != months:
        return smap_pct, ndvi, False

    applied = False
    raw_smap = appeears_override.get("smap_moisture_pct")
    if isinstance(raw_smap, list) and len(raw_smap) == len(months):
        smap_pct = np.asarray(raw_smap, dtype=np.float64)
        applied = True

    raw_ndvi = appeears_override.get("ndvi")
    if isinstance(raw_ndvi, list) and len(raw_ndvi) == len(months):
        ndvi = np.asarray(raw_ndvi, dtype=np.float64)
        applied = True

    return smap_pct, ndvi, applied


def build_cube_from_power(
    raw: dict[str, Any],
    lat: float,
    lon: float,
    key: str,
    appeears_override: dict[str, Any] | None = None,
) -> FusedClimateCube:
    series: dict[str, dict[str, float]] = raw["properties"]["parameter"]
    meta: dict[str, Any] = raw.get("parameters", {})
    et_units = str(meta.get("EVPTRNS", {}).get("units", "MJ/m^2/day")).lower()
    solar_units = str(meta.get("ALLSKY_SFC_SW_DWN", {}).get("units", "MJ/m^2/day")).lower()

    ym_keys = sorted(k for k in series["T2M_MAX"] if not k.endswith("13"))[-FUSION_MONTHS:]
    if len(ym_keys) < FUSION_MONTHS:
        raise ValueError(f"Expected {FUSION_MONTHS} monthly records, got {len(ym_keys)}")

    cols = {p: _interpolate_series(series[p], ym_keys, p) for p in PARAMETERS}

    extra_series: dict[str, list[float]] = {}
    for p, out_key in (("T2M_MIN", "t2m_min_c"), ("RH2M", "rh2m_pct")):
        if p in series:
            try:
                extra_series[out_key] = _interpolate_series(series[p], ym_keys, p).tolist()
            except ValueError:
                pass

    gwetroot_pct: np.ndarray | None = None
    if "GWETROOT" in series:
        try:
            gwetroot_pct = np.clip(
                _interpolate_series(series["GWETROOT"], ym_keys, "GWETROOT") * 100.0,
                0.0,
                100.0,
            )
            extra_series["gwetroot_pct"] = gwetroot_pct.tolist()
        except ValueError:
            log.warning("NASA POWER GWETROOT all-NaN for %s; falling back to synthesized moisture.", key)

    if "GWETTOP" in series:
        try:
            gwettop_pct = np.clip(
                _interpolate_series(series["GWETTOP"], ym_keys, "GWETTOP") * 100.0,
                0.0,
                100.0,
            )
            extra_series["gwettop_pct"] = gwettop_pct.tolist()
        except ValueError:
            pass

    if appeears_override and isinstance(appeears_override.get("ecostress_esi"), list):
        extra_series["ecostress_esi"] = appeears_override["ecostress_esi"]

    months: list[str] = []
    month_numbers = np.zeros(FUSION_MONTHS, dtype=np.int32)
    days_arr = np.zeros(FUSION_MONTHS, dtype=np.float64)
    for i, k in enumerate(ym_keys):
        yr, mo = int(k[:4]), int(k[4:6])
        months.append(f"{yr:04d}-{mo:02d}")
        month_numbers[i] = mo
        days_arr[i] = calendar.monthrange(yr, mo)[1]

    t2m = cols["T2M_MAX"]
    precip = np.maximum(0.0, cols["PRECTOTCORR"] * days_arr)
    solar = cols["ALLSKY_SFC_SW_DWN"] / MJ_PER_KWH if "mj" in solar_units else cols["ALLSKY_SFC_SW_DWN"]
    et_daily = cols["EVPTRNS"] / LATENT_HEAT_MJ_PER_KG if "mj" in et_units else cols["EVPTRNS"]
    et = np.maximum(10.0, et_daily * days_arr)

    smap_pct, ndvi = _harmonize_smap_and_ndvi(precip, et, t2m, smap_override_pct=gwetroot_pct)
    smap_pct, ndvi, has_appeears = _apply_appeears_override(smap_pct, ndvi, months, appeears_override)
    matrix = np.column_stack([t2m, precip, solar, et, smap_pct, ndvi]).astype(np.float64)

    return FusedClimateCube(
        lat=lat,
        lon=lon,
        grid_key=key,
        source="nasa_power+appeears" if has_appeears else "nasa_power",
        cached=False,
        months=months,
        month_numbers=month_numbers,
        matrix=np.ascontiguousarray(matrix, dtype=np.float64),
        extra_series=extra_series or None,
    )


def build_fallback_cube(lat: float, lon: float, key: str | None = None) -> FusedClimateCube:
    """Deterministic 36-month fused NASA POWER + SMAP + NDVI cube when offline."""
    rlat, rlon, resolved_key = grid_cache_key(lat, lon)
    grid_key = key or resolved_key
    start_year, end_year = _year_window_36m()

    seed = (int(round(abs(rlat) * 100)) * 100_003 + int(round(abs(rlon) * 100)) * 7_919) % (2**32)
    rng = np.random.default_rng(seed)
    dryness = 0.65 + 0.35 * ((seed % 97) / 96.0)

    months: list[str] = []
    month_numbers = np.zeros(FUSION_MONTHS, dtype=np.int32)
    t2m = np.zeros(FUSION_MONTHS, dtype=np.float64)
    precip = np.zeros(FUSION_MONTHS, dtype=np.float64)
    solar = np.zeros(FUSION_MONTHS, dtype=np.float64)
    et = np.zeros(FUSION_MONTHS, dtype=np.float64)

    idx = 0
    for yr in range(start_year, end_year + 1):
        for mo in range(1, 13):
            days = calendar.monthrange(yr, mo)[1]
            maha = math.exp(-((mo - 11.5) ** 2) / 2.5) + math.exp(-((mo + 0.5) ** 2) / 2.5)
            yala = 0.6 * math.exp(-((mo - 4.5) ** 2) / 1.5)
            precip_day = (0.8 + 8.8 * (maha + yala) / dryness) * rng.uniform(0.80, 1.20)
            precip_day *= 1.0 - 0.03 * (idx / 12.0)  # gradual drying trend

            tmax = 31.2 + 2.4 * math.sin((mo - 1) / 12.0 * 2.0 * math.pi) + 0.05 * (idx / 12.0) + rng.normal(0, 0.3)
            sol = 5.2 + 0.75 * math.sin((mo - 2) / 12.0 * 2.0 * math.pi) + rng.normal(0, 0.12)
            et_day = 2.7 + 0.34 * (tmax - 30.0) + 0.22 * (sol - 5.0) + rng.normal(0, 0.08)

            months.append(f"{yr:04d}-{mo:02d}")
            month_numbers[idx] = mo
            t2m[idx] = tmax
            precip[idx] = max(0.0, precip_day) * days
            solar[idx] = sol
            et[idx] = max(0.5, et_day) * days
            idx += 1

    smap_pct, ndvi = _harmonize_smap_and_ndvi(precip, et, t2m)
    matrix = np.column_stack([t2m, precip, solar, et, smap_pct, ndvi]).astype(np.float64)

    return FusedClimateCube(
        lat=rlat,
        lon=rlon,
        grid_key=grid_key,
        source="fallback",
        cached=False,
        months=months,
        month_numbers=month_numbers,
        matrix=np.ascontiguousarray(matrix, dtype=np.float64),
    )


async def fetch_fused_climate(lat: float, lon: float) -> FusedClimateCube:
    """Fetch or load from Redis (`nasa:grid:{lat:.2f}:{lon:.2f}`) the 36-month fused array."""
    rlat, rlon, key = grid_cache_key(lat, lon)
    cached_payload = await cache.get_json(key)
    appeears_data = await appeears_client.get_cached_appeears_series(rlat, rlon)
    if appeears_data is None:
        appeears_client.trigger_background_prefetch(rlat, rlon)

    if cached_payload and "matrix" in cached_payload:
        cube = FusedClimateCube.from_cache_dict(cached_payload, cached=True)
        if appeears_data and cube.source == "nasa_power":
            smap_pct, ndvi, has_appeears = _apply_appeears_override(
                cube.matrix[:, COL_SMAP_MOISTURE],
                cube.matrix[:, COL_NDVI],
                cube.months,
                appeears_data,
            )
            if has_appeears:
                cube.matrix[:, COL_SMAP_MOISTURE] = smap_pct
                cube.matrix[:, COL_NDVI] = ndvi
                if isinstance(appeears_data.get("ecostress_esi"), list):
                    cube.extra_series = {**(cube.extra_series or {}), "ecostress_esi": appeears_data["ecostress_esi"]}
                cube.source = "nasa_power+appeears"
        return cube

    start_year, end_year = _year_window_36m()
    try:
        raw = await _fetch_power_raw(rlat, rlon, start_year, end_year)
        cube = build_cube_from_power(raw, rlat, rlon, key, appeears_override=appeears_data)
        await cache.set_json(key, cube.to_cache_dict(), ttl_seconds=get_settings().cache_ttl_seconds)
        return cube
    except Exception as exc:  # noqa: BLE001
        log.warning("NASA POWER fetch failed for %s (%r) — using deterministic 36m fallback.", key, exc)
        return build_fallback_cube(rlat, rlon, key)
