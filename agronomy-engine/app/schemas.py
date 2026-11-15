"""Pydantic request / response models for agronomy-engine."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.memory_store import lookup_store

Priority = Literal["cost", "water", "soil"]
StrategyCode = Literal["A_BASELINE", "B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"]


class GeoJSONPolygon(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[tuple[float, float]]] = Field(
        ..., description="GeoJSON rings of [lon, lat] pairs; first ring is the outer boundary"
    )

    @field_validator("coordinates")
    @classmethod
    def _valid_ring(cls, v: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
        if not v or len(v[0]) < 4:
            raise ValueError("outer ring needs at least 4 positions (closed polygon)")
        return v


class Centroid(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class RegionEnsureRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    polygon: GeoJSONPolygon | None = None
    force_refresh: bool = False


class PredictRequest(BaseModel):
    polygon: GeoJSONPolygon
    centroid: Centroid
    current_crop: str = Field(..., examples=["paddy_rice"])
    soil_type: str = Field(default="soil_clay_loam", examples=["soil_clay_loam", "soil_sandy_loam", "soil_degraded_dry"])
    region_id: str | None = Field(default=None, examples=["region_lk_dryzone", "region_us_midwest"])
    priority: Priority = "water"
    area_ha: float | None = Field(default=None, gt=0)
    planting_month: int = Field(default=10, ge=1, le=12)

    @field_validator("current_crop")
    @classmethod
    def _known_crop(cls, v: str) -> str:
        cid = lookup_store.resolve_crop_id(v)
        if cid is None:
            raise ValueError(f"unknown crop '{v}'. See GET /crops")
        return cid


class PredictResponse(BaseModel):
    request_id: str
    execution_ms: float
    location: Centroid
    area_ha: float | None
    inputs: dict[str, Any]
    climate: dict[str, Any]
    risk: dict[str, Any]
    strategies: list[dict[str, Any]]
    recommended_strategy: StrategyCode
    optimizer: dict[str, Any]


class SeasonOverride(BaseModel):
    crop_id: str = Field(..., examples=["paddy_rice"])
    target_water_mm: float | None = Field(default=None, gt=0, description="Override crop water demand (mm)")
    input_cost_usd_ha: float | None = Field(default=None, ge=0, description="Override input cost (USD/ha)")

    @field_validator("crop_id")
    @classmethod
    def _known_crop(cls, v: str) -> str:
        cid = lookup_store.resolve_crop_id(v)
        if cid is None:
            raise ValueError(f"unknown crop '{v}'. See GET /crops")
        return cid


class ProjectRecalcRequest(BaseModel):
    centroid: Centroid
    soil_type: str = Field(default="soil_clay_loam")
    current_crop: str = Field(..., examples=["paddy_rice"])
    region_id: str | None = Field(default=None)
    priority: Priority = "water"
    planting_month: int = Field(default=10, ge=1, le=12)
    area_ha: float | None = Field(default=None, gt=0)
    seasons: list[SeasonOverride] = Field(..., min_length=3, max_length=3)

    @field_validator("current_crop")
    @classmethod
    def _known_current_crop(cls, v: str) -> str:
        cid = lookup_store.resolve_crop_id(v)
        if cid is None:
            raise ValueError(f"unknown crop '{v}'. See GET /crops")
        return cid


class ProjectRecalcResponse(BaseModel):
    seasons: list[dict[str, Any]]
    objectives: dict[str, float]
    totals: dict[str, float]
    warnings: list[str]

