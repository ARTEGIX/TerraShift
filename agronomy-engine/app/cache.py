"""Thin, failure-tolerant Redis JSON cache.

If Redis is unreachable every call degrades to a no-op so the engine keeps working.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import redis.asyncio as aioredis

from app.config import get_settings

log = logging.getLogger(__name__)

_client: aioredis.Redis | None = None


def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            get_settings().redis_url,
            decode_responses=True,
            socket_connect_timeout=1.5,
            socket_timeout=1.5,
        )
    return _client


async def get_json(key: str) -> Any | None:
    try:
        raw = await get_client().get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:  # noqa: BLE001
        log.warning("cache get failed (%s): %s", key, exc)
        return None


async def set_json(key: str, value: Any, ttl_seconds: int | None = None) -> None:
    try:
        ttl = ttl_seconds or get_settings().cache_ttl_seconds
        await get_client().set(key, json.dumps(value), ex=ttl)
    except Exception as exc:  # noqa: BLE001
        log.warning("cache set failed (%s): %s", key, exc)


async def ping() -> bool:
    try:
        return bool(await get_client().ping())
    except Exception:  # noqa: BLE001
        return False


async def close() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:  # noqa: BLE001
            pass
        _client = None
