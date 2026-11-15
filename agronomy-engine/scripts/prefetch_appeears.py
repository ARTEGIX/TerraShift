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
from app.appeears_client import (  # noqa: E402
    import_appeears_csv_dir,
    prefetch_appeears_point,
    sync_completed_appeears_tasks,
)
from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("prefetch_appeears")

DEFAULT_POINTS = [(7.87, 80.77), (8.31, 80.40)]


def _parse_point(raw: str) -> tuple[float, float]:
    lat_s, lon_s = raw.split(",", maxsplit=1)
    return float(lat_s.strip()), float(lon_s.strip())


async def _run(points: list[tuple[float, float]], sync_completed: bool = False, import_dir: str | None = None) -> int:
    settings = get_settings()
    if not import_dir and not settings.earthdata_token and not (settings.earthdata_username and settings.earthdata_password):
        log.error("Set EARTHDATA_TOKEN or EARTHDATA_USERNAME/EARTHDATA_PASSWORD in .env before running prefetch.")
        return 1

    try:
        if import_dir:
            lat, lon = points[0] if len(points) == 1 else (None, None)
            imported = await import_appeears_csv_dir(import_dir, lat=lat, lon=lon)
            for item in imported:
                log.info("Import %s (%s-%s): %s", item["grid_key"], item.get("start_year"), item.get("end_year"), item["action"])
            return 0

        if sync_completed:
            synced = await sync_completed_appeears_tasks()
            for item in synced:
                log.info(
                    "Sync %s (%s-%s, task=%s): %s",
                    item["grid_key"],
                    item["start_year"],
                    item["end_year"],
                    item["task_id"],
                    item["action"],
                )
            return 0

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
    parser = argparse.ArgumentParser(description="Pre-fetch or import NASA AppEEARS satellite series into Redis + MongoDB.")
    parser.add_argument(
        "--point",
        action="append",
        dest="points",
        help="Coordinate as 'lat,lon' (repeatable). Defaults to Sri Lanka Dry Zone demo points.",
    )
    parser.add_argument(
        "--sync-completed",
        action="store_true",
        help="Download all completed AppEEARS tasks from your Earthdata account into Redis + general_db.",
    )
    parser.add_argument(
        "--import-dir",
        help="Import locally downloaded AppEEARS *-results.csv files from a directory into Redis + general_db.",
    )
    args = parser.parse_args()
    points = [_parse_point(p) for p in args.points] if args.points else ([] if args.import_dir else DEFAULT_POINTS)
    return asyncio.run(_run(points, sync_completed=args.sync_completed, import_dir=args.import_dir))


if __name__ == "__main__":
    raise SystemExit(main())
