"""Crop lookup table loader + helpers."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "crop_lookup.json"

Crop = dict[str, Any]


@lru_cache
def load_crops() -> dict[str, Crop]:
    with DATA_PATH.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    return {c["id"]: c for c in payload["crops"]}


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def resolve_crop_id(value: str) -> str | None:
    """Accept an id ('paddy_rice') or a display name ('Paddy Rice')."""
    crops = load_crops()
    slug = _slug(value)
    if slug in crops:
        return slug
    for cid, crop in crops.items():
        if _slug(crop["name"]).startswith(slug) or slug in _slug(crop["name"]):
            return cid
    return None


def get_crop(crop_id: str) -> Crop:
    return load_crops()[crop_id]
