"""TerraShift agronomy-engine — FastAPI entry point."""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import cache
from app.config import get_settings
from app.crops import load_crops
from app.layer1_risk import assess_risk
from app.layer2_rot import optimize_rotations
from app.nasa_client import fetch_climate
from app.schemas import PredictRequest, PredictResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agronomy-engine")


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_crops()  # fail fast on a broken lookup file
    yield
    await cache.close()


app = FastAPI(
    title="TerraShift Agronomy Engine",
    version="0.1.0",
    description="Layer 1 (time-series risk) + Layer 2 (genetic rotation optimizer) on NASA POWER data.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "service": "agronomy-engine", "redis": await cache.ping(), "crops": len(load_crops())}


@app.get("/crops", tags=["reference"])
async def crops() -> list[dict]:
    return list(load_crops().values())


@app.post("/predict", response_model=PredictResponse, tags=["engine"])
async def predict(req: PredictRequest) -> PredictResponse:
    t0 = time.perf_counter()
    climate = await fetch_climate(req.centroid.lat, req.centroid.lon)
    risk, ctx = assess_risk(climate, req.current_crop, req.soil_type, req.planting_month)
    strategies, recommended, optimizer = optimize_rotations(
        req.current_crop, req.soil_type, req.priority, ctx, req.planting_month
    )
    log.info("predict %s/%s/%s source=%s in %.0f ms", req.current_crop, req.soil_type, req.priority,
             climate.source, (time.perf_counter() - t0) * 1000)
    return PredictResponse(
        request_id=str(uuid.uuid4()),
        location={"lat": climate.lat, "lon": climate.lon},
        area_ha=req.area_ha,
        inputs={
            "current_crop": req.current_crop,
            "soil_type": req.soil_type,
            "priority": req.priority,
            "planting_month": req.planting_month,
        },
        climate=climate,
        risk=risk,
        strategies=strategies,
        recommended_strategy=recommended,
        optimizer=optimizer,
    )
