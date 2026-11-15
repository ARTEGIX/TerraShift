"""Durable L2 persistence for NASA AppEEARS satellite series in MongoDB `general_db`.

Redis (`appeears:grid:{lat:.2f}:{lon:.2f}`) acts as the hot L1 cache, while
`general_db.appeears_series` acts as the durable L2 store so 36-month satellite
extractions survive Redis restarts and TTL expirations without re-running
30s-5min NASA AppEEARS jobs.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection

from app.config import get_settings

log = logging.getLogger(__name__)

COLLECTION_NAME = "appeears_series"
APPEEARS_L2_TTL_SECONDS = 180 * 86_400  # 180 days

_client: MongoClient | None = None
_client_uri: str = ""
_indexes_ensured = False


def _doc_id(grid_key: str, start_year: int, end_year: int) -> str:
    return f"{grid_key}:{start_year}:{end_year}"


def _get_collection() -> Collection | None:
    """Return the `general_db.appeears_series` collection or None if unconfigured."""
    global _client, _client_uri
    uri = get_settings().resolved_general_uri()
    if not uri:
        return None
    if _client is None or _client_uri != uri:
        if _client is not None:
            try:
                _client.close()
            except Exception:  # noqa: BLE001
                pass
        _client = MongoClient(
            uri,
            serverSelectionTimeoutMS=2_000,
            connectTimeoutMS=2_000,
            socketTimeoutMS=2_000,
        )
        _client_uri = uri
    return _client["general_db"][COLLECTION_NAME]


def _ensure_indexes(coll: Collection) -> None:
    global _indexes_ensured
    if _indexes_ensured:
        return
    coll.create_index(
        [("grid_key", ASCENDING), ("start_year", ASCENDING), ("end_year", ASCENDING)],
        name="idx_appeears_grid_window",
    )
    coll.create_index(
        [("updated_at", ASCENDING)],
        name="idx_appeears_updated_ttl",
        expireAfterSeconds=APPEEARS_L2_TTL_SECONDS,
    )
    _indexes_ensured = True


def _get_sync(grid_key: str, start_year: int, end_year: int) -> dict[str, Any] | None:
    coll = _get_collection()
    if coll is None:
        return None
    doc = coll.find_one({"_id": _doc_id(grid_key, start_year, end_year)}, {"data": 1})
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict):
        return doc["data"]
    return None


def _save_sync(
    grid_key: str,
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    data: dict[str, Any],
) -> bool:
    coll = _get_collection()
    if coll is None:
        return False
    _ensure_indexes(coll)
    coll.replace_one(
        {"_id": _doc_id(grid_key, start_year, end_year)},
        {
            "_id": _doc_id(grid_key, start_year, end_year),
            "grid_key": grid_key,
            "lat": round(float(lat), 2),
            "lon": round(float(lon), 2),
            "start_year": int(start_year),
            "end_year": int(end_year),
            "data": data,
            "updated_at": datetime.now(timezone.utc),
        },
        upsert=True,
    )
    return True


async def get_appeears_series(grid_key: str, start_year: int, end_year: int) -> dict[str, Any] | None:
    """Read an AppEEARS series from `general_db.appeears_series` without blocking the event loop."""
    try:
        return await asyncio.to_thread(_get_sync, grid_key, start_year, end_year)
    except Exception as exc:  # noqa: BLE001
        log.warning("MongoDB L2 AppEEARS read failed (%s): %s", grid_key, exc)
        return None


async def save_appeears_series(
    grid_key: str,
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    data: dict[str, Any],
) -> bool:
    """Persist an AppEEARS series to `general_db.appeears_series` without blocking the event loop."""
    try:
        saved = await asyncio.to_thread(_save_sync, grid_key, lat, lon, start_year, end_year, data)
        if saved:
            log.info("Persisted AppEEARS satellite series in general_db under %s (%d-%d)", grid_key, start_year, end_year)
        return saved
    except Exception as exc:  # noqa: BLE001
        log.warning("MongoDB L2 AppEEARS write failed (%s): %s", grid_key, exc)
        return False


async def close() -> None:
    """Close the shared MongoClient on service shutdown."""
    global _client, _client_uri, _indexes_ensured
    if _client is not None:
        try:
            _client.close()
        except Exception:  # noqa: BLE001
            pass
        _client = None
        _client_uri = ""
        _indexes_ensured = False
