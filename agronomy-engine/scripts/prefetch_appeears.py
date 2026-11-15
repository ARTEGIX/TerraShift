"""CLI helper to pre-warm Redis with real NASA AppEEARS SMAP L4 + MODIS NDVI series.

Usage (from `agronomy-engine/`):
    python scripts/prefetch_appeears.py
    python scripts/prefetch_appeears.py --point 7.87,80.77 --point 8.31,80.40
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import cache  # noqa: E402
from app.appeears_client import prefetch_appeears_point  # noqa: E402
from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("prefetch_appeears")

DEFAULT_POINTS = [(7.87, 80.77), (8.31, 80.40)]


def _parse_point(raw: str) -> tuple[float, float]:
    lat_s, lon_s = raw.split(",", maxsplit=1)
    return float(lat_s.strip()), float(lon_s.strip())


async def _run(points: list[tuple[float, float]]) -> int:
    settings = get_settings()
    if not settings.earthdata_token and not (settings.earthdata_username and settings.earthdata_password):
        log.error("Set EARTHDATA_TOKEN or EARTHDATA_USERNAME/EARTHDATA_PASSWORD in .env before running prefetch.")
        return 1

    try:
        for lat, lon in points:
            log.info("Fetching AppEEARS SMAP + MODIS for (%.2f, %.2f)...", lat, lon)
            res = await prefetch_appeears_point(lat, lon)
            if res is None:
                log.warning("No AppEEARS data returned for (%.2f, %.2f).", lat, lon)
            else:
                log.info(
                    "Stored (%.2f, %.2f): smap=%s, ndvi=%s",
                    lat,
                    lon,
                    bool(res.get("smap_moisture_pct")),
                    bool(res.get("ndvi")),
                )
    finally:
        await cache.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Pre-fetch NASA AppEEARS SMAP + MODIS series into Redis.")
    parser.add_argument(
        "--point",
        action="append",
        dest="points",
        help="Coordinate as 'lat,lon' (repeatable). Defaults to Sri Lanka Dry Zone demo points.",
    )
    args = parser.parse_args()
    points = [_parse_point(p) for p in args.points] if args.points else DEFAULT_POINTS
    return asyncio.run(_run(points))


if __name__ == "__main__":
    raise SystemExit(main())
