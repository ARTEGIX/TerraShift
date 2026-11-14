"""MongoDB Atlas Dual-Database Seeder (`lookup_db` + `general_db`).

Seeds:
1. `lookup_db.crops_catalog`: 12 regional crops backed by FAO GAEZ & USDA AMS Market News
2. `lookup_db.soil_profiles`: 3 soil profiles backed by USDA SSURGO/WSS & FAO soil classes
3. `lookup_db.regional_saturation`: 2 regional saturation profiles backed by CropScape CDL / Sentinel-2
4. `general_db.farms`: Demo farm (`farm_demo_01`) with a GeoJSON `Polygon` + `2dsphere` index
5. `general_db.simulation_runs`: Index on `farm_id` (and `created_at`)

Usage:
    ATLAS_MONGO_URI="mongodb+srv://..." python seed_atlas.py
"""
from __future__ import annotations

import datetime as dt
import os
import sys
from typing import Any

from pymongo import ASCENDING, DESCENDING, GEOSPHERE, MongoClient, ReplaceOne

# ---------------------------------------------------------------------------
# 1. lookup_db.crops_catalog (12 FAO GAEZ / USDA AMS backed crops)
# ---------------------------------------------------------------------------
CROPS_CATALOG_SEED: list[dict[str, Any]] = [
    {
        "_id": "paddy_rice",
        "name": "Paddy Rice",
        "category": "cash_crop",
        "water_demand_mm": 1200.0,
        "drought_tolerance": 0.15,
        "nitrogen_impact_kg_ha": -90.0,
        "root_depth_cm": 30,
        "growth_days": 120,
        "erosion_cover_factor": 0.28,
        "input_cost_usd_ha": 650.0,
        "market_revenue_usd_ha": 1150.0,
        "pest_family": "poaceae",
    },
    {
        "_id": "mung_bean",
        "name": "Mung Bean",
        "category": "legume",
        "water_demand_mm": 350.0,
        "drought_tolerance": 0.72,
        "nitrogen_impact_kg_ha": 42.0,
        "root_depth_cm": 60,
        "growth_days": 70,
        "erosion_cover_factor": 0.18,
        "input_cost_usd_ha": 280.0,
        "market_revenue_usd_ha": 680.0,
        "pest_family": "fabaceae",
    },
    {
        "_id": "cowpea",
        "name": "Cowpea",
        "category": "legume",
        "water_demand_mm": 380.0,
        "drought_tolerance": 0.80,
        "nitrogen_impact_kg_ha": 50.0,
        "root_depth_cm": 90,
        "growth_days": 80,
        "erosion_cover_factor": 0.15,
        "input_cost_usd_ha": 250.0,
        "market_revenue_usd_ha": 620.0,
        "pest_family": "fabaceae",
    },
    {
        "_id": "maize",
        "name": "Maize",
        "category": "cash_crop",
        "water_demand_mm": 550.0,
        "drought_tolerance": 0.42,
        "nitrogen_impact_kg_ha": -110.0,
        "root_depth_cm": 120,
        "growth_days": 110,
        "erosion_cover_factor": 0.35,
        "input_cost_usd_ha": 480.0,
        "market_revenue_usd_ha": 960.0,
        "pest_family": "poaceae",
    },
    {
        "_id": "finger_millet",
        "name": "Finger Millet",
        "category": "drought_tolerant",
        "water_demand_mm": 340.0,
        "drought_tolerance": 0.86,
        "nitrogen_impact_kg_ha": -35.0,
        "root_depth_cm": 75,
        "growth_days": 100,
        "erosion_cover_factor": 0.22,
        "input_cost_usd_ha": 220.0,
        "market_revenue_usd_ha": 560.0,
        "pest_family": "poaceae",
    },
    {
        "_id": "groundnut",
        "name": "Groundnut",
        "category": "legume",
        "water_demand_mm": 480.0,
        "drought_tolerance": 0.65,
        "nitrogen_impact_kg_ha": 58.0,
        "root_depth_cm": 55,
        "growth_days": 110,
        "erosion_cover_factor": 0.20,
        "input_cost_usd_ha": 420.0,
        "market_revenue_usd_ha": 1040.0,
        "pest_family": "fabaceae",
    },
    {
        "_id": "sesame",
        "name": "Sesame",
        "category": "drought_tolerant",
        "water_demand_mm": 300.0,
        "drought_tolerance": 0.90,
        "nitrogen_impact_kg_ha": -30.0,
        "root_depth_cm": 120,
        "growth_days": 90,
        "erosion_cover_factor": 0.25,
        "input_cost_usd_ha": 180.0,
        "market_revenue_usd_ha": 590.0,
        "pest_family": "pedaliaceae",
    },
    {
        "_id": "chilli",
        "name": "Chilli",
        "category": "cash_crop",
        "water_demand_mm": 600.0,
        "drought_tolerance": 0.35,
        "nitrogen_impact_kg_ha": -115.0,
        "root_depth_cm": 60,
        "growth_days": 150,
        "erosion_cover_factor": 0.38,
        "input_cost_usd_ha": 1350.0,
        "market_revenue_usd_ha": 2850.0,
        "pest_family": "solanaceae",
    },
    {
        "_id": "onion",
        "name": "Onion",
        "category": "cash_crop",
        "water_demand_mm": 450.0,
        "drought_tolerance": 0.30,
        "nitrogen_impact_kg_ha": -95.0,
        "root_depth_cm": 30,
        "growth_days": 110,
        "erosion_cover_factor": 0.42,
        "input_cost_usd_ha": 1500.0,
        "market_revenue_usd_ha": 2750.0,
        "pest_family": "amaryllidaceae",
    },
    {
        "_id": "sunn_hemp",
        "name": "Sunn Hemp",
        "category": "cover_crop",
        "water_demand_mm": 280.0,
        "drought_tolerance": 0.78,
        "nitrogen_impact_kg_ha": 110.0,
        "root_depth_cm": 150,
        "growth_days": 60,
        "erosion_cover_factor": 0.08,
        "input_cost_usd_ha": 95.0,
        "market_revenue_usd_ha": 140.0,
        "pest_family": "fabaceae",
    },
    {
        "_id": "chickpea",
        "name": "Chickpea",
        "category": "legume",
        "water_demand_mm": 340.0,
        "drought_tolerance": 0.76,
        "nitrogen_impact_kg_ha": 45.0,
        "root_depth_cm": 100,
        "growth_days": 100,
        "erosion_cover_factor": 0.19,
        "input_cost_usd_ha": 300.0,
        "market_revenue_usd_ha": 760.0,
        "pest_family": "fabaceae",
    },
    {
        "_id": "cassava",
        "name": "Cassava",
        "category": "drought_tolerant",
        "water_demand_mm": 680.0,
        "drought_tolerance": 0.82,
        "nitrogen_impact_kg_ha": -65.0,
        "root_depth_cm": 110,
        "growth_days": 240,
        "erosion_cover_factor": 0.32,
        "input_cost_usd_ha": 440.0,
        "market_revenue_usd_ha": 1180.0,
        "pest_family": "euphorbiaceae",
    },
]

# ---------------------------------------------------------------------------
# 2. lookup_db.soil_profiles (USDA SSURGO/WSS & FAO soil classes)
# ---------------------------------------------------------------------------
SOIL_PROFILES_SEED: list[dict[str, Any]] = [
    {
        "_id": "soil_sandy_loam",
        "name": "Sandy Loam (FAO Lixisol / USDA Coarse-Loamy)",
        "water_holding_mm_m": 125.0,
        "erosion_k_factor": 0.28,
        "leaching_factor": 0.32,
    },
    {
        "_id": "soil_clay_loam",
        "name": "Clay Loam (FAO Luvisol / USDA Fine-Loamy)",
        "water_holding_mm_m": 185.0,
        "erosion_k_factor": 0.22,
        "leaching_factor": 0.14,
    },
    {
        "_id": "soil_degraded_dry",
        "name": "Degraded Dryland Soil (Low-SOM Crusting Aridisol)",
        "water_holding_mm_m": 85.0,
        "erosion_k_factor": 0.41,
        "leaching_factor": 0.45,
    },
]

# ---------------------------------------------------------------------------
# 3. lookup_db.regional_saturation (CropScape CDL / Sentinel-2 profiles)
# ---------------------------------------------------------------------------
REGIONAL_SATURATION_SEED: list[dict[str, Any]] = [
    {
        "_id": "region_lk_dryzone",
        "name": "Sri Lanka Dry & Intermediate Zone (Mahaweli / Anuradhapura)",
        "oversupplied_crops": ["paddy_rice", "maize", "onion"],
        "dominant_pest_family": "poaceae",
        "bare_field_months": [3, 4, 8, 9],
    },
    {
        "_id": "region_us_midwest",
        "name": "US Midwest Corn Belt (CropScape CDL Reference)",
        "oversupplied_crops": ["maize"],
        "dominant_pest_family": "poaceae",
        "bare_field_months": [11, 12, 1, 2, 3],
    },
]

# ---------------------------------------------------------------------------
# 4. general_db.farms (Demo Farm Document)
# ---------------------------------------------------------------------------
DEMO_FARM_SEED: dict[str, Any] = {
    "_id": "farm_demo_01",
    "name": "Mahaweli Block-4 Demo Paddy Field",
    "region_id": "region_lk_dryzone",
    "soil_type": "soil_clay_loam",
    "current_crop": "paddy_rice",
    "default_priority": "water",
    "area_ha": 2.45,
    "centroid": {"lat": 8.3114, "lon": 80.4037},
    "polygon": {
        "type": "Polygon",
        "coordinates": [
            [
                [80.3987, 8.3064],
                [80.4087, 8.3064],
                [80.4087, 8.3164],
                [80.3987, 8.3164],
                [80.3987, 8.3064],
            ]
        ],
    },
    "updated_at": dt.datetime(2026, 11, 14, tzinfo=dt.timezone.utc),
}


def resolve_base_uri(explicit_uri: str | None = None) -> str:
    uri = explicit_uri or os.getenv("ATLAS_MONGO_URI") or os.getenv("LOOKUP_MONGO_URI") or ""
    if not uri or "<username>" in uri:
        raise RuntimeError(
            "ATLAS_MONGO_URI is not configured. Set ATLAS_MONGO_URI in .env before running seed_atlas.py."
        )
    # Strip any trailing /database?... so we can address both lookup_db and general_db cleanly
    if "mongodb.net/" in uri:
        prefix, _, rest = uri.partition("mongodb.net/")
        query = f"?{rest.split('?', 1)[1]}" if "?" in rest else "?retryWrites=true&w=majority"
        return f"{prefix}mongodb.net/{query}"
    return uri


def seed_atlas(atlas_uri: str | None = None) -> dict[str, int]:
    uri = resolve_base_uri(atlas_uri)
    client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=10_000)

    lookup_db = client["lookup_db"]
    general_db = client["general_db"]

    lookup_db["crops_catalog"].bulk_write(
        [ReplaceOne({"_id": doc["_id"]}, doc, upsert=True) for doc in CROPS_CATALOG_SEED]
    )
    lookup_db["soil_profiles"].bulk_write(
        [ReplaceOne({"_id": doc["_id"]}, doc, upsert=True) for doc in SOIL_PROFILES_SEED]
    )
    lookup_db["regional_saturation"].bulk_write(
        [ReplaceOne({"_id": doc["_id"]}, doc, upsert=True) for doc in REGIONAL_SATURATION_SEED]
    )

    general_db["farms"].replace_one({"_id": DEMO_FARM_SEED["_id"]}, DEMO_FARM_SEED, upsert=True)
    general_db["farms"].create_index([("polygon", GEOSPHERE)], name="idx_farms_polygon_2dsphere")
    general_db["simulation_runs"].create_index(
        [("farm_id", ASCENDING), ("created_at", DESCENDING)],
        name="idx_simulation_runs_farm_id",
    )

    counts = {
        "lookup_db.crops_catalog": lookup_db["crops_catalog"].count_documents({}),
        "lookup_db.soil_profiles": lookup_db["soil_profiles"].count_documents({}),
        "lookup_db.regional_saturation": lookup_db["regional_saturation"].count_documents({}),
        "general_db.farms": general_db["farms"].count_documents({}),
    }
    client.close()
    return counts


if __name__ == "__main__":
    try:
        summary = seed_atlas()
        print("✅ MongoDB Atlas dual-database seed complete:", summary)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ seed_atlas failed: {exc}", file=sys.stderr)
        sys.exit(1)
