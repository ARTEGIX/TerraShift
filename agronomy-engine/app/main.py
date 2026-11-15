"""TerraShift agronomy-engine — FastAPI entry point.

Startup (`lifespan`):
  Pre-fetches `crops_catalog`, `soil_profiles`, and `regional_saturation` from MongoDB
  Atlas `lookup_db` into `lookup_store` (including the contiguous 2D `np.float64` matrix
  `lookup_store.crop_matrix`), or falls back deterministically to the built-in seed data.

Pipeline (`POST /predict`):
  Step 0 (`nasa_fusion.py`)       -> 36-month NASA POWER + SMAP + NDVI NumPy array (Redis 24h cache)
  Layer 1 (`layer1_regression.py`) -> In-memory Ridge / polyfit regression
  Layer 2 (`layer2_evolution.py`)  -> In-memory vectorized NumPy Genetic Algorithm (`pop=50`, `gen=30`)
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import appeears_client, appeears_store, cache
from app.config import get_settings
from app.forecast_client import fetch_seasonal_forecast
from app.layer1_regression import run_layer1_regression
from app.layer2_evolution import _build_strategy_payload, run_layer2_evolution
from app.memory_store import lookup_store
from app.nasa_fusion import fetch_fused_climate
from app.soil_client import fetch_soilgrids_profile
from app.terrain_client import fetch_terrain_profile
from app.schemas import Centroid, PredictRequest, PredictResponse, ProjectRecalcRequest, ProjectRecalcResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agronomy-engine")


@asynccontextmanager
async def lifespan(_: FastAPI):
    lookup_store.reload_from_atlas()
    yield
    await appeears_store.close()
    await cache.close()


app = FastAPI(
    title="TerraShift Agronomy Engine",
    version="0.2.0",
    description=(
        "Dual-DB In-Memory NumPy/Redis Pipeline: NASA POWER + SMAP + NDVI Fusion -> "
        "Layer 1 Ridge/Polyfit Regression -> Layer 2 Vectorized Multi-Objective Genetic Algorithm."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "agronomy-engine",
        "redis": await cache.ping(),
        "lookup_store": lookup_store.status(),
    }


@app.post("/internal/reload-lookup", tags=["internal"])
async def reload_lookup() -> dict[str, Any]:
    """Refresh in-memory lookup dictionaries & 2D NumPy crop matrix from MongoDB Atlas `lookup_db`."""
    status = lookup_store.reload_from_atlas()
    return {"reloaded": True, "lookup_store": status}


@app.get("/crops", tags=["reference"])
async def crops() -> list[dict[str, Any]]:
    return list(lookup_store.crops_by_id.values())


@app.get("/soils", tags=["reference"])
async def soils() -> list[dict[str, Any]]:
    return list(lookup_store.soil_profiles.values())


@app.get("/regions", tags=["reference"])
async def regions() -> list[dict[str, Any]]:
    return list(lookup_store.regional_saturation.values())


@app.post("/prefetch", tags=["engine"])
async def prefetch_satellite(coord: Centroid) -> dict[str, Any]:
    """Start non-blocking background AppEEARS satellite prefetch for a coordinate."""
    status = await appeears_client.get_appeears_status(coord.lat, coord.lon)
    if status["status"] == "ready":
        return status
    started = appeears_client.trigger_background_prefetch(coord.lat, coord.lon)
    return {
        "status": "pending" if (started or status["status"] == "pending") else "skipped",
        "grid_key": status["grid_key"],
    }


@app.get("/prefetch/status", tags=["engine"])
async def prefetch_satellite_status(lat: float, lon: float) -> dict[str, Any]:
    """Check whether AppEEARS satellite data is ready or still pending for a coordinate."""
    return await appeears_client.get_appeears_status(lat, lon)


@app.post("/predict", response_model=PredictResponse, tags=["engine"])
async def predict(req: PredictRequest) -> PredictResponse:
    t0 = time.perf_counter()

    # Step 0: Spatial-Temporal Data Fusion (~1km Redis Grid Cache + 36m NumPy array)
    outer_ring = req.polygon.coordinates[0] if req.polygon.coordinates else None
    cube, soilgrids, terrain, seasonal_forecast = await asyncio.gather(
        fetch_fused_climate(req.centroid.lat, req.centroid.lon),
        fetch_soilgrids_profile(req.centroid.lat, req.centroid.lon),
        fetch_terrain_profile(req.centroid.lat, req.centroid.lon, outer_ring),
        fetch_seasonal_forecast(req.centroid.lat, req.centroid.lon),
    )

    # Layer 1: In-Memory Regression Engine
    t_compute = time.perf_counter()
    effective_soil_type = (
        soilgrids["inferred_soil_type"]
        if soilgrids and "soil_type" not in req.model_fields_set
        else req.soil_type
    )
    layer1 = run_layer1_regression(
        cube=cube,
        soil_type=effective_soil_type,
        current_crop=req.current_crop,
        region_id=req.region_id,
        planting_month=req.planting_month,
        store=lookup_store,
        soilgrids=soilgrids,
        terrain=terrain,
        seasonal_forecast=seasonal_forecast,
    )

    # Layer 2: In-Memory Multi-Objective Evolutionary Algorithm (pop=50, gen=30)
    strategies, recommended, optimizer_meta = run_layer2_evolution(
        current_crop_id=req.current_crop,
        priority=req.priority,
        layer1=layer1,
        store=lookup_store,
    )
    compute_ms = round((time.perf_counter() - t_compute) * 1000.0, 2)
    total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    optimizer_meta["in_memory_compute_ms"] = compute_ms

    log.info(
        "predict crop=%s soil=%s prio=%s source=%s compute=%.2fms total=%.2fms",
        req.current_crop,
        layer1.soil_profile["_id"],
        req.priority,
        cube.source,
        compute_ms,
        total_ms,
    )

    return PredictResponse(
        request_id=str(uuid.uuid4()),
        execution_ms=total_ms,
        location={"lat": cube.lat, "lon": cube.lon},
        area_ha=req.area_ha,
        inputs={
            "current_crop": req.current_crop,
            "soil_type": layer1.soil_profile["_id"],
            "region_id": layer1.region_profile["_id"],
            "priority": req.priority,
            "planting_month": req.planting_month,
            **({"soilgrids": soilgrids} if soilgrids else {}),
            **({"terrain": terrain} if terrain else {}),
            **({"seasonal_forecast": seasonal_forecast} if seasonal_forecast else {}),
        },
        climate={
            "source": cube.source,
            "grid_key": cube.grid_key,
            "lat": cube.lat,
            "lon": cube.lon,
            "cached": cube.cached,
            "months_count": len(cube.months),
            "monthly": cube.to_monthly_records(),
        },
        risk=layer1.to_summary_dict(req.current_crop),
        strategies=strategies,
        recommended_strategy=recommended,
        optimizer=optimizer_meta,
    )


@app.post("/predict/project-recalculate", response_model=ProjectRecalcResponse, tags=["engine"])
async def project_recalculate(req: ProjectRecalcRequest) -> ProjectRecalcResponse:
    """Evaluate a fixed 3-season crop plan with optional per-season water/cost overrides.

    Runs fetch_fused_climate + run_layer1_regression then calls _build_strategy_payload
    with the fixed crop sequence (skipping GA search), applying user overrides per season.
    """
    # Step 0: Climate fusion + cached SoilGrids, terrain & seasonal forecast telemetry
    cube, soilgrids, terrain, seasonal_forecast = await asyncio.gather(
        fetch_fused_climate(req.centroid.lat, req.centroid.lon),
        fetch_soilgrids_profile(req.centroid.lat, req.centroid.lon),
        fetch_terrain_profile(req.centroid.lat, req.centroid.lon, None),
        fetch_seasonal_forecast(req.centroid.lat, req.centroid.lon),
    )

    effective_soil_type = (
        soilgrids["inferred_soil_type"]
        if soilgrids and "soil_type" not in req.model_fields_set
        else req.soil_type
    )

    # Layer 1: In-Memory Regression Engine
    layer1 = run_layer1_regression(
        cube=cube,
        soil_type=effective_soil_type,
        current_crop=req.current_crop,
        region_id=req.region_id,
        planting_month=req.planting_month,
        store=lookup_store,
        soilgrids=soilgrids,
        terrain=terrain,
        seasonal_forecast=seasonal_forecast,
    )

    # Resolve crop indices for the fixed 3-season sequence
    seq_list = [
        lookup_store.crop_index.get(lookup_store.resolve_crop_id(s.crop_id) or s.crop_id, 0)
        for s in req.seasons
    ]
    seq: tuple[int, int, int] = (seq_list[0], seq_list[1], seq_list[2])

    # Build season_overrides list from request
    overrides = [
        {
            "target_water_mm": s.target_water_mm,
            "input_cost_usd_ha": s.input_cost_usd_ha,
        }
        for s in req.seasons
    ]

    # Evaluate the fixed plan via _build_strategy_payload (no GA search)
    payload = _build_strategy_payload(
        strategy_id="PROJECT_PLAN",
        name="Project Plan",
        description="User-defined 3-season project plan with optional overrides.",
        seq=seq,
        layer1=layer1,
        store=lookup_store,
        season_overrides=overrides,
    )

    seasons_out = [
        {
            "season_number": s["season"],
            "season": s["season"],
            "season_label": s.get("season_label"),
            "crop_id": s["crop_id"],
            "crop_name": s["crop_name"],
            "metrics": s["metrics"],
        }
        for s in payload["seasons"]
    ]

    return ProjectRecalcResponse(
        seasons=seasons_out,
        objectives=payload["objectives"],
        totals=payload["totals"],
        warnings=payload["warnings"],
    )

