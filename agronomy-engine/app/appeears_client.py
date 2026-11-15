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
import re
import time
from datetime import date
from pathlib import Path
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


def _months_for_years(start_year: int, end_year: int) -> list[str]:
    return [f"{yr:04d}-{mo:02d}" for yr in range(start_year, end_year + 1) for mo in range(1, 13)]


def target_36_months(today: date | None = None) -> list[str]:
    """Return the 36 `YYYY-MM` labels matching `nasa_fusion._year_window_36m`."""
    end_year = (today or date.today()).year - 1
    start_year = end_year - 2
    return _months_for_years(start_year, end_year)


def _window_years(months: list[str] | None = None) -> tuple[int, int]:
    seq = months or target_36_months()
    return int(seq[0][:4]), int(seq[-1][:4])


def _is_valid_appeears_payload(payload: Any, expected_months: list[str] | None = None) -> bool:
    if not isinstance(payload, dict):
        return False
    target = expected_months if expected_months is not None else target_36_months()
    series = [payload.get("smap_moisture_pct"), payload.get("ndvi")]
    if not any(isinstance(values, list) and len(values) == len(target) for values in series):
        return False
    return payload.get("months") == target


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


def _csv_product_slot(fname: str) -> str | None:
    """Identify which AppEEARS product CSV slot a filename corresponds to."""
    norm = fname.replace("-", "_")
    if "HLSS30" in norm:
        return "hls"
    if "MOD13Q1" in norm:
        return "modis"
    if "ECO_L4T_ESI" in norm:
        return "eco"
    if "SPL4SMGP" in norm:
        return "smap"
    return None


async def _persist_aggregated_series(
    cache_key: str,
    lat: float,
    lon: float,
    months: list[str],
    aggregated: dict[str, Any],
) -> None:
    """Persist aggregated AppEEARS series to L1 Redis and L2 MongoDB general_db."""
    await cache.set_json(
        cache_key,
        aggregated,
        ttl_seconds=_redis_ttl_seconds(),
    )
    start_year, end_year = _window_years(months)
    await appeears_store.save_appeears_series(cache_key, lat, lon, start_year, end_year, aggregated)
    log.info("Cached AppEEARS satellite series in Redis + general_db under %s", cache_key)


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

    slots: dict[str, str] = {}
    for f in files:
        fname = str(f.get("file_name", ""))
        if not fname.endswith(".csv"):
            continue
        slot = _csv_product_slot(fname)
        if not slot:
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
        slots[slot] = dl.text

    aggregated = aggregate_appeears_csvs(
        slots.get("modis"),
        slots.get("smap"),
        months,
        hls_csv=slots.get("hls"),
        eco_csv=slots.get("eco"),
    )
    if aggregated is None:
        await cache.delete_key(pending_key)
        return None

    await _persist_aggregated_series(cache_key, lat, lon, months, aggregated)
    await cache.delete_key(pending_key)
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


_TASK_NAME_RE = re.compile(r"^terrashift_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(\d{4})_(\d{4})$")
_CSV_PREFIX_RE = re.compile(r"^terrashift[-_](-?\d+(?:[.-]\d+)?)[-_](-?\d+(?:[.-]\d+)?)[-_](\d{4})[-_](\d{4})[-_]")


def _parse_coord_token(token: str) -> float:
    sign = "-" if token.startswith("-") else ""
    body = token.lstrip("-")
    if "." not in body:
        body = body.replace("-", ".", 1)
    return round(float(f"{sign}{body}"), 2)


def _extract_task_grid(task: dict[str, Any]) -> tuple[float, float, int, int] | None:
    """Extract `(lat, lon, start_year, end_year)` from an AppEEARS task summary."""
    name = str(task.get("task_name") or "")
    m = _TASK_NAME_RE.match(name)
    if m:
        return round(float(m.group(1)), 2), round(float(m.group(2)), 2), int(m.group(3)), int(m.group(4))

    params = task.get("params") if isinstance(task.get("params"), dict) else {}
    coords = params.get("coordinates") if isinstance(params.get("coordinates"), list) else []
    dates = params.get("dates") if isinstance(params.get("dates"), list) else []
    if coords and dates and isinstance(coords[0], dict) and isinstance(dates[0], dict):
        try:
            lat = round(float(coords[0]["latitude"]), 2)
            lon = round(float(coords[0]["longitude"]), 2)
            start_year = int(str(dates[0]["startDate"])[-4:])
            end_year = int(str(dates[0]["endDate"])[-4:])
            return lat, lon, start_year, end_year
        except (KeyError, TypeError, ValueError):
            return None
    return None


async def sync_completed_appeears_tasks() -> list[dict[str, Any]]:
    """Download all completed TerraShift AppEEARS tasks into Redis L1 + MongoDB L2."""
    if not _has_credentials():
        return []

    settings = get_settings()
    base = settings.appeears_base_url.rstrip("/")
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        headers = await _auth_headers(client, base)
        resp = await client.get(f"{base}/task", headers=headers)
        if resp.status_code in {401, 403} and settings.earthdata_username and settings.earthdata_password:
            headers = await _auth_headers(client, base, force_refresh=True)
            resp = await client.get(f"{base}/task", headers=headers)
        resp.raise_for_status()
        tasks = resp.json()
        if not isinstance(tasks, list):
            return []

        # Deduplicate completed tasks by (rlat, rlon, start_year, end_year), keeping the newest
        latest_by_cell: dict[tuple[float, float, int, int], dict[str, Any]] = {}
        for t in tasks:
            if not isinstance(t, dict) or t.get("status") != "done":
                continue
            grid = _extract_task_grid(t)
            if grid is None:
                continue
            stamp = str(t.get("completed") or t.get("created") or "")
            prev = latest_by_cell.get(grid)
            if prev is None or stamp > str(prev.get("completed") or prev.get("created") or ""):
                latest_by_cell[grid] = t

        for (rlat, rlon, start_year, end_year), task in sorted(latest_by_cell.items()):
            task_id = str(task["task_id"])
            _, _, key = appeears_cache_key(rlat, rlon)
            _, _, pending_key = appeears_pending_key(rlat, rlon)
            months = _months_for_years(start_year, end_year)

            l1 = await cache.get_json(key)
            if _is_valid_appeears_payload(l1, months):
                # Ensure L2 MongoDB also has it
                if not _is_valid_appeears_payload(await appeears_store.get_appeears_series(key, start_year, end_year), months):
                    await appeears_store.save_appeears_series(key, rlat, rlon, start_year, end_year, l1)
                results.append({"grid_key": key, "lat": rlat, "lon": rlon, "start_year": start_year, "end_year": end_year, "task_id": task_id, "action": "already_cached"})
                continue

            l2 = await appeears_store.get_appeears_series(key, start_year, end_year)
            if _is_valid_appeears_payload(l2, months):
                await cache.set_json(key, l2, ttl_seconds=_redis_ttl_seconds())
                results.append({"grid_key": key, "lat": rlat, "lon": rlon, "start_year": start_year, "end_year": end_year, "task_id": task_id, "action": "already_cached"})
                continue

            agg = await _download_and_cache_bundle(client, base, headers, task_id, rlat, rlon, key, pending_key, months)
            results.append({
                "grid_key": key,
                "lat": rlat,
                "lon": rlon,
                "start_year": start_year,
                "end_year": end_year,
                "task_id": task_id,
                "action": "imported" if agg is not None else "empty",
            })

    return results


def _infer_coords_from_csv(csv_text: str) -> tuple[float, float] | None:
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        try:
            lat = float(row.get("Latitude") or row.get("latitude") or "")
            lon = float(row.get("Longitude") or row.get("longitude") or "")
            return round(lat, 2), round(lon, 2)
        except ValueError:
            continue
    return None


async def import_appeears_csv_dir(
    directory: str,
    lat: float | None = None,
    lon: float | None = None,
) -> list[dict[str, Any]]:
    """Import locally downloaded AppEEARS `*-results.csv` files into Redis L1 + MongoDB L2."""
    root = Path(directory)
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {directory}")

    csv_files = sorted(root.rglob("*-results.csv")) or sorted(root.rglob("*.csv"))
    groups: dict[str, dict[str, Any]] = {}

    for path in csv_files:
        slot = _csv_product_slot(path.name)
        if not slot:
            continue
        m = _CSV_PREFIX_RE.match(path.name)
        if m:
            parsed_lat = _parse_coord_token(m.group(1))
            parsed_lon = _parse_coord_token(m.group(2))
            start_year, end_year = int(m.group(3)), int(m.group(4))
            g_lat = round(lat, 2) if lat is not None else parsed_lat
            g_lon = round(lon, 2) if lon is not None else parsed_lon
            group_key = f"{g_lat:.2f}:{g_lon:.2f}:{start_year}:{end_year}"
        else:
            g_lat = round(lat, 2) if lat is not None else None
            g_lon = round(lon, 2) if lon is not None else None
            start_year, end_year = _window_years()
            group_key = f"custom:{start_year}:{end_year}"

        entry = groups.setdefault(group_key, {"lat": g_lat, "lon": g_lon, "start_year": start_year, "end_year": end_year, "slots": {}})
        entry["slots"][slot] = path.read_text(encoding="utf-8", errors="replace")

    results: list[dict[str, Any]] = []
    for entry in groups.values():
        slots: dict[str, str] = entry["slots"]
        g_lat, g_lon = entry["lat"], entry["lon"]
        if g_lat is None or g_lon is None:
            for txt in slots.values():
                inferred = _infer_coords_from_csv(txt)
                if inferred:
                    g_lat, g_lon = inferred
                    break
        if g_lat is None or g_lon is None:
            continue

        rlat, rlon, key = appeears_cache_key(g_lat, g_lon)
        months = _months_for_years(entry["start_year"], entry["end_year"])
        agg = aggregate_appeears_csvs(
            slots.get("modis"),
            slots.get("smap"),
            months,
            hls_csv=slots.get("hls"),
            eco_csv=slots.get("eco"),
        )
        if agg is None:
            results.append({"grid_key": key, "lat": rlat, "lon": rlon, "action": "empty"})
            continue

        await _persist_aggregated_series(key, rlat, rlon, months, agg)
        _, _, pending_key = appeears_pending_key(rlat, rlon)
        await cache.delete_key(pending_key)
        results.append({"grid_key": key, "lat": rlat, "lon": rlon, "start_year": entry["start_year"], "end_year": entry["end_year"], "action": "imported"})

    return results
