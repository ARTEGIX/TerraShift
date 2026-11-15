"""Asynchronous / Pre-Fetched Satellite Series via NASA AppEEARS + Earthdata (`appeears_client.py`).

Fetches real 36-month point time series for:
  - MODIS Terra Vegetation Indices (`MOD13Q1.061` -> `_250m_16_days_NDVI`)
  - SMAP L4 Root-Zone Soil Moisture (`SPL4SMGP.008` -> `Geophysical_Data_sm_rootzone_pctl`)

Because AppEEARS point tasks run asynchronously (typically 30s-5min), `POST /predict`
never blocks on AppEEARS:
  1. `get_cached_appeears_series(lat, lon)` reads `appeears:grid:{lat:.2f}:{lon:.2f}` from Redis.
  2. On a cache miss when `EARTHDATA_TOKEN` is configured, `trigger_background_prefetch(lat, lon)`
     launches a deduplicated background `asyncio.Task` to populate Redis for subsequent requests.
  3. `scripts/prefetch_appeears.py` can also pre-warm demo farm coordinates ahead of time.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from datetime import date
from typing import Any

import httpx
import numpy as np

from app import appeears_store, cache
from app.config import get_settings

log = logging.getLogger(__name__)

MODIS_PRODUCT = "MOD13Q1.061"
MODIS_LAYER = "_250m_16_days_NDVI"
HLS_PRODUCT = "HLSS30_VI.020"
HLS_LAYER = "NDVI"
ECO_PRODUCT = "ECO_L4T_ESI.002"
ECO_LAYER = "ESI"
SMAP_PRODUCT = "SPL4SMGP.008"
SMAP_LAYER = "Geophysical_Data_sm_rootzone_pctl"
APPEEARS_CACHE_TTL_SECONDS = 604_800  # 7 days
APPEEARS_PENDING_TTL_SECONDS = 86_400  # 24 hours

_inflight_keys: set[str] = set()
_background_tasks: set[asyncio.Task[Any]] = set()
_cached_login_token: str = ""


def _has_credentials() -> bool:
    s = get_settings()
    return bool((s.earthdata_username and s.earthdata_password) or s.earthdata_token)


async def _get_appeears_token(client: httpx.AsyncClient, base: str) -> str:
    """Return an AppEEARS Bearer token, logging in via /api/login when username/password are set."""
    global _cached_login_token
    s = get_settings()
    if s.earthdata_username and s.earthdata_password:
        if _cached_login_token:
            return _cached_login_token
        log.info("Logging into NASA AppEEARS API: POST %s/login", base)
        resp = await client.post(f"{base}/login", auth=(s.earthdata_username, s.earthdata_password))
        log.info("NASA AppEEARS POST /login response: status=%d", resp.status_code)
        resp.raise_for_status()
        _cached_login_token = str(resp.json()["token"])
        return _cached_login_token
    return s.earthdata_token


def appeears_cache_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"appeears:grid:{rlat:.2f}:{rlon:.2f}"


def appeears_pending_key(lat: float, lon: float) -> tuple[float, float, str]:
    rlat, rlon = round(float(lat), 2), round(float(lon), 2)
    return rlat, rlon, f"appeears:pending:{rlat:.2f}:{rlon:.2f}"


def target_36_months(today: date | None = None) -> list[str]:
    """Return the 36 `YYYY-MM` labels matching `nasa_fusion._year_window_36m`."""
    end_year = (today or date.today()).year - 1
    start_year = end_year - 2
    return [f"{yr:04d}-{mo:02d}" for yr in range(start_year, end_year + 1) for mo in range(1, 13)]


def _window_years(months: list[str] | None = None) -> tuple[int, int]:
    seq = months or target_36_months()
    return int(seq[0][:4]), int(seq[-1][:4])


def _is_valid_appeears_payload(payload: Any) -> bool:
    return isinstance(payload, dict) and ("smap_moisture_pct" in payload or "ndvi" in payload)


def _redis_ttl_seconds() -> int:
    return max(get_settings().cache_ttl_seconds, APPEEARS_CACHE_TTL_SECONDS)


def build_point_task_payload(
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    task_name: str | None = None,
) -> dict[str, Any]:
    """Build an AppEEARS `POST /task` point-sample request payload."""
    rlat, rlon, key = appeears_cache_key(lat, lon)
    return {
        "task_type": "point",
        "task_name": task_name or f"terrashift_{rlat:.2f}_{rlon:.2f}_{start_year}_{end_year}",
        "params": {
            "dates": [
                {
                    "startDate": f"01-01-{start_year}",
                    "endDate": f"12-31-{end_year}",
                }
            ],
            "layers": [
                {"product": MODIS_PRODUCT, "layer": MODIS_LAYER},
                {"product": HLS_PRODUCT, "layer": HLS_LAYER},
                {"product": ECO_PRODUCT, "layer": ECO_LAYER},
                {"product": SMAP_PRODUCT, "layer": SMAP_LAYER},
            ],
            "coordinates": [
                {
                    "id": key,
                    "latitude": rlat,
                    "longitude": rlon,
                }
            ],
        },
    }


def _aggregate_csv_column(
    csv_text: str,
    column_substring: str,
    months: list[str],
    valid_min: float,
    valid_max: float,
    default_value: float,
) -> list[float] | None:
    """Parse an AppEEARS point CSV and compute gap-filled monthly means."""
    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        return None

    date_col = next((c for c in reader.fieldnames if c.lower() == "date"), None)
    val_col = next((c for c in reader.fieldnames if column_substring in c), None)
    if not date_col or not val_col:
        return None

    buckets: dict[str, list[float]] = {m: [] for m in months}
    for row in reader:
        raw_date = (row.get(date_col) or "").strip()
        raw_val = (row.get(val_col) or "").strip()
        if len(raw_date) < 7 or not raw_val:
            continue
        ym = raw_date[:7]
        if ym not in buckets:
            continue
        try:
            val = float(raw_val)
            if column_substring in {MODIS_LAYER, HLS_LAYER} and 1.5 < val <= 10_000.0:
                val *= 0.0001
        except ValueError:
            continue
        if valid_min <= val <= valid_max:
            buckets[ym].append(val)

    arr = np.array(
        [float(np.mean(buckets[m])) if buckets[m] else np.nan for m in months],
        dtype=np.float64,
    )
    if np.all(np.isnan(arr)):
        return None

    idx = np.arange(arr.size)
    mask = np.isnan(arr)
    if np.any(mask):
        arr[mask] = np.interp(idx[mask], idx[~mask], arr[~mask])
    arr = np.clip(arr, valid_min, valid_max)
    return [round(float(x), 4) for x in arr]


def aggregate_appeears_csvs(
    modis_csv: str | None,
    smap_csv: str | None,
    months: list[str],
    hls_csv: str | None = None,
    eco_csv: str | None = None,
) -> dict[str, Any] | None:
    """Combine HLS/MODIS NDVI, ECOSTRESS ESI, and SPL4SMGP moisture CSVs into 36-month series."""
    hls_ndvi = (
        _aggregate_csv_column(hls_csv, HLS_LAYER, months, 0.05, 0.95, 0.45)
        if hls_csv
        else None
    )
    modis_ndvi = (
        _aggregate_csv_column(modis_csv, MODIS_LAYER, months, 0.05, 0.95, 0.45)
        if modis_csv
        else None
    )
    ndvi = hls_ndvi if hls_ndvi is not None else modis_ndvi
    smap = (
        _aggregate_csv_column(smap_csv, SMAP_LAYER, months, 5.0, 98.0, 50.0)
        if smap_csv
        else None
    )
    esi = (
        _aggregate_csv_column(eco_csv, ECO_LAYER, months, 0.0, 2.0, 0.75)
        if eco_csv
        else None
    )
    if ndvi is None and smap is None and esi is None:
        return None
    return {
        "source": "appeears_hls_eco_smap" if (hls_ndvi or esi) else "appeears_smap_modis",
        "months": months,
        "smap_moisture_pct": smap,
        "ndvi": ndvi,
        **({"ecostress_esi": esi} if esi is not None else {}),
    }


async def _auth_headers(client: httpx.AsyncClient, base: str, force_refresh: bool = False) -> dict[str, str]:
    """Return Bearer auth headers, optionally clearing a stale cached login token."""
    global _cached_login_token
    if force_refresh:
        _cached_login_token = ""
    token = await _get_appeears_token(client, base)
    return {"Authorization": f"Bearer {token}"}


async def _download_and_cache_bundle(
    client: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    task_id: str,
    lat: float,
    lon: float,
    cache_key: str,
    pending_key: str,
    months: list[str],
) -> dict[str, Any] | None:
    """Download completed AppEEARS CSV bundle, aggregate, cache in L1 Redis + L2 general_db, and clear pending key."""
    bundle_resp = await client.get(f"{base}/bundle/{task_id}", headers=headers)
    log.info("NASA AppEEARS GET /bundle/%s: status=%d", task_id, bundle_resp.status_code)
    bundle_resp.raise_for_status()
    files = bundle_resp.json().get("files", [])

    modis_csv: str | None = None
    hls_csv: str | None = None
    eco_csv: str | None = None
    smap_csv: str | None = None
    for f in files:
        fname = str(f.get("file_name", ""))
        if not fname.endswith(".csv"):
            continue
        file_id = f["file_id"]
        t_dl = time.perf_counter()
        dl = await client.get(f"{base}/bundle/{task_id}/{file_id}", headers=headers)
        log.info(
            "NASA AppEEARS CSV download: file=%s status=%d elapsed=%.1fms",
            fname,
            dl.status_code,
            (time.perf_counter() - t_dl) * 1000.0,
        )
        dl.raise_for_status()
        norm_name = fname.replace("-", "_")
        if "HLSS30" in norm_name:
            hls_csv = dl.text
        elif "MOD13Q1" in norm_name:
            modis_csv = dl.text
        elif "ECO_L4T_ESI" in norm_name:
            eco_csv = dl.text
        elif "SPL4SMGP" in norm_name:
            smap_csv = dl.text

    aggregated = aggregate_appeears_csvs(modis_csv, smap_csv, months, hls_csv=hls_csv, eco_csv=eco_csv)
    if aggregated is None:
        await cache.delete_key(pending_key)
        return None

    await cache.set_json(
        cache_key,
        aggregated,
        ttl_seconds=_redis_ttl_seconds(),
    )
    start_year, end_year = _window_years(months)
    await appeears_store.save_appeears_series(cache_key, lat, lon, start_year, end_year, aggregated)
    await cache.delete_key(pending_key)
    log.info("Cached AppEEARS satellite series in Redis under %s", cache_key)
    return aggregated


async def prefetch_appeears_point(
    lat: float,
    lon: float,
    poll_interval_s: float = 30.0,
    timeout_s: float = 3600.0,
) -> dict[str, Any] | None:
    """Submit (or resume) an AppEEARS point task, poll until completion, and cache in Redis."""
    settings = get_settings()
    if not _has_credentials():
        log.debug("AppEEARS credentials not configured; skipping AppEEARS fetch.")
        return None

    rlat, rlon, key = appeears_cache_key(lat, lon)
    _, _, pending_key = appeears_pending_key(rlat, rlon)

    existing = await get_cached_appeears_series(rlat, rlon)
    if existing is not None:
        return existing

    base = settings.appeears_base_url.rstrip("/")
    pending = await cache.get_json(pending_key)
    task_id = str(pending.get("task_id")) if isinstance(pending, dict) and pending.get("task_id") else None
    raw_months = pending.get("months") if isinstance(pending, dict) else None
    if (
        task_id
        and isinstance(raw_months, list)
        and len(raw_months) == 36
        and all(isinstance(m, str) and len(m) == 7 for m in raw_months)
    ):
        months = list(raw_months)
    else:
        months = target_36_months()
    start_year = int(months[0][:4])
    end_year = int(months[-1][:4])

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        headers = await _auth_headers(client, base)

        if not task_id:
            payload = build_point_task_payload(rlat, rlon, start_year, end_year)
            t0 = time.perf_counter()
            log.info("Calling NASA AppEEARS API: POST %s/task lat=%.2f lon=%.2f", base, rlat, rlon)
            submit_resp = await client.post(f"{base}/task", json=payload, headers=headers)
            if submit_resp.status_code in {401, 403} and settings.earthdata_username and settings.earthdata_password:
                headers = await _auth_headers(client, base, force_refresh=True)
                submit_resp = await client.post(f"{base}/task", json=payload, headers=headers)
            log.info(
                "NASA AppEEARS POST /task response: status=%d elapsed=%.1fms",
                submit_resp.status_code,
                (time.perf_counter() - t0) * 1000.0,
            )
            submit_resp.raise_for_status()
            task_id = str(submit_resp.json()["task_id"])
            await cache.set_json(
                pending_key,
                {"task_id": task_id, "months": months},
                ttl_seconds=APPEEARS_PENDING_TTL_SECONDS,
            )
            log.info("AppEEARS task submitted for %s: task_id=%s", key, task_id)
        else:
            log.info("Resuming pending AppEEARS task for %s: task_id=%s", key, task_id)

        elapsed = 0.0
        while elapsed < timeout_s:
            status_resp = await client.get(f"{base}/task/{task_id}", headers=headers)
            if status_resp.status_code in {401, 403} and settings.earthdata_username and settings.earthdata_password:
                headers = await _auth_headers(client, base, force_refresh=True)
                status_resp = await client.get(f"{base}/task/{task_id}", headers=headers)
            if status_resp.status_code == 404:
                await cache.delete_key(pending_key)
                raise RuntimeError(f"AppEEARS task {task_id} no longer exists (404)")
            status_resp.raise_for_status()
            status = status_resp.json().get("status", "")
            log.info("NASA AppEEARS GET /task/%s: status=%s", task_id, status)
            if status == "done":
                break
            if status in {"error", "expired"}:
                await cache.delete_key(pending_key)
                raise RuntimeError(f"AppEEARS task {task_id} failed with status={status}")
            await asyncio.sleep(poll_interval_s)
            elapsed += poll_interval_s
        else:
            raise TimeoutError(f"AppEEARS task {task_id} timed out after {timeout_s}s (kept pending in Redis)")

        return await _download_and_cache_bundle(client, base, headers, task_id, rlat, rlon, key, pending_key, months)


async def get_cached_appeears_series(lat: float, lon: float) -> dict[str, Any] | None:
    """Read AppEEARS series from Redis (L1), falling back to MongoDB `general_db` (L2)."""
    _, _, key = appeears_cache_key(lat, lon)
    payload = await cache.get_json(key)
    if _is_valid_appeears_payload(payload):
        return payload

    start_year, end_year = _window_years()
    l2_payload = await appeears_store.get_appeears_series(key, start_year, end_year)
    if _is_valid_appeears_payload(l2_payload):
        await cache.set_json(key, l2_payload, ttl_seconds=_redis_ttl_seconds())
        log.info("Warm-loaded AppEEARS satellite series from general_db into Redis under %s", key)
        return l2_payload
    return None


async def get_appeears_status(lat: float, lon: float) -> dict[str, Any]:
    """Return current AppEEARS cache/pending status for `(lat, lon)` without blocking."""
    rlat, rlon, key = appeears_cache_key(lat, lon)
    payload = await get_cached_appeears_series(rlat, rlon)
    if payload is not None:
        return {"status": "ready", "grid_key": key}

    _, _, pending_key = appeears_pending_key(rlat, rlon)
    pending = await cache.get_json(pending_key)
    if isinstance(pending, dict) and pending.get("task_id"):
        if key not in _inflight_keys:
            trigger_background_prefetch(rlat, rlon)
        return {"status": "pending", "grid_key": key}

    if key in _inflight_keys:
        return {"status": "pending", "grid_key": key}

    return {"status": "not_started", "grid_key": key}


def trigger_background_prefetch(lat: float, lon: float) -> bool:
    """Schedule a deduplicated background AppEEARS fetch when credentials are set."""
    if not _has_credentials():
        return False

    rlat, rlon, key = appeears_cache_key(lat, lon)
    if key in _inflight_keys:
        return False

    async def _runner() -> None:
        try:
            await prefetch_appeears_point(rlat, rlon)
        except Exception as exc:  # noqa: BLE001
            log.warning("Background AppEEARS prefetch failed for %s: %r", key, exc)
        finally:
            _inflight_keys.discard(key)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False

    _inflight_keys.add(key)
    task = loop.create_task(_runner())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return True
