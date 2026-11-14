"""Pydantic request / response models — mirror docs/api-contract.md."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.crops import resolve_crop_id

SoilType = Literal["clay", "loam", "sandy", "silt", "laterite"]
Priority = Literal["cost", "water", "soil"]
Trend = Literal["improving", "stable", "worsening"]
RiskLevel = Literal["low", "medium", "high"]


# ----------------------------------------------------------------- request
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


class PredictRequest(BaseModel):
    polygon: GeoJSONPolygon
    centroid: Centroid
    current_crop: str = Field(..., examples=["paddy_rice"])
    soil_type: SoilType
    priority: Priority
    area_ha: float | None = Field(default=None, gt=0)
    planting_month: int = Field(default=10, ge=1, le=12, description="1-12; default Maha season (Oct)")

    @field_validator("current_crop")
    @classmethod
    def _known_crop(cls, v: str) -> str:
        cid = resolve_crop_id(v)
        if cid is None:
            raise ValueError(f"unknown crop '{v}'. See GET /crops")
        return cid


# ----------------------------------------------------------------- climate
class ClimateMonth(BaseModel):
    month: str  # YYYY-MM
    t2m_max_c: float
    precip_mm: float
    solar_kwh_m2_day: float
    evapotranspiration_mm: float


class ClimateData(BaseModel):
    source: Literal["nasa_power", "fallback"]
    lat: float
    lon: float
    start_year: int
    end_year: int
    cached: bool = False
    monthly: list[ClimateMonth]


# ----------------------------------------------------------------- layer 1
class ModelDiagnostics(BaseModel):
    method: str
    slope_per_year: float
    r2: float
    residual_std: float
    n_obs: int


class ForecastPoint(BaseModel):
    month: str
    value: float
    lower: float
    upper: float


class SoilMoistureDeficit(BaseModel):
    score: float = Field(..., ge=0, le=100)
    trend: Trend
    cumulative_deficit_mm_12m: float
    deficit_months_12m: int
    forecast: list[ForecastPoint]
    model: ModelDiagnostics


class ErosionWindow(BaseModel):
    month: str
    precip_mm: float
    bare_field: bool
    risk_level: RiskLevel


class HeatStress(BaseModel):
    score: float = Field(..., ge=0, le=100)
    threshold_c: float
    months_over_threshold: int
    peak_t2m_max_c: float
    model: ModelDiagnostics


class RegionalSaturation(BaseModel):
    score: float = Field(..., ge=0, le=100)
    neighbor_farms_sampled: int
    crop_share_pct: float
    family_share_pct: float
    herfindahl_index: float
    oversupply_risk: bool
    monoculture_pest_risk: bool
    crop_shares: dict[str, float]


class RiskReport(BaseModel):
    overall_score: float = Field(..., ge=0, le=100)
    soil_moisture_deficit: SoilMoistureDeficit
    erosion_windows: list[ErosionWindow]
    heat_stress: HeatStress
    regional_saturation: RegionalSaturation


# ----------------------------------------------------------------- layer 2
class SeasonMetrics(BaseModel):
    water_use_mm: float
    water_deficit_mm: float
    nitrogen_balance_kg_ha: float
    fertilizer_n_kg_ha: float
    som_pct: float
    input_cost_usd_ha: float
    revenue_usd_ha: float
    net_margin_usd_ha: float
    yield_factor: float


class SeasonPlan(BaseModel):
    season: int
    season_label: str
    crop_id: str
    crop_name: str
    category: str
    metrics: SeasonMetrics


class StrategyTotals(BaseModel):
    water_use_mm: float
    water_deficit_mm: float
    nitrogen_balance_kg_ha: float
    som_delta_pct: float
    input_cost_usd_ha: float
    revenue_usd_ha: float
    net_margin_usd_ha: float
    resilience_score: float = Field(..., ge=0, le=100)
    fitness: float


class Strategy(BaseModel):
    id: Literal["A", "B", "C"]
    name: str
    description: str
    seasons: list[SeasonPlan]
    totals: StrategyTotals
    warnings: list[str] = []


class OptimizerInfo(BaseModel):
    method: str
    population: int
    generations: int
    seed: int


class PredictResponse(BaseModel):
    request_id: str
    location: Centroid
    area_ha: float | None
    inputs: dict
    climate: ClimateData
    risk: RiskReport
    strategies: list[Strategy]
    recommended_strategy: Literal["A", "B", "C"]
    optimizer: OptimizerInfo
