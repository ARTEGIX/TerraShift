/**
 * Shared API contract types — mirror of docs/api-contract.md and
 * agronomy-engine/app/schemas.py.
 */

export type SoilType =
  | "soil_sandy_loam"
  | "soil_clay_loam"
  | "soil_degraded_dry"
  | "clay"
  | "loam"
  | "sandy"
  | "silt"
  | "laterite";

export type Priority = "cost" | "water" | "soil";
export type StrategyId = "A_BASELINE" | "B_SOIL_WATER_RESILIENCE" | "C_COST_MARKET_OPTIMIZED";
export type RiskLevel = "low" | "medium" | "high";

export interface Polygon {
  type: "Polygon";
  coordinates: [number, number][][]; // [lon, lat]
}

export interface Centroid {
  lat: number;
  lon: number;
}

export interface PredictRequest {
  polygon: Polygon;
  centroid: Centroid;
  current_crop: string;
  soil_type: string;
  region_id?: string;
  priority: Priority;
  area_ha?: number;
  planting_month?: number;
}

export interface ClimateMonth {
  month: string;
  t2m_max_c: number;
  precip_mm: number;
  solar_kwh_m2_day: number;
  evapotranspiration_mm: number;
  smap_rootzone_pct: number;
  ndvi: number;
}

export interface RiskReport {
  overall_score: number;
  season_water_budgets_mm: number[];
  october_moisture_anomaly_pct: number;
  soil_moisture_deficit: {
    score: number;
    trend: "improving" | "stable" | "worsening";
    october_moisture_anomaly_pct: number;
    slope_mm_per_year: number;
    r2: number;
  };
  bare_field_erosion: {
    score: number;
    soil_k_factor: number;
    bare_field_months: number[];
    windows: { month_num: number; projected_precip_mm: number; bare_field: boolean; risk_level: RiskLevel }[];
  };
  heat_stress: {
    score: number;
    peak_t2m_max_c: number;
    months_over_35c: number;
  };
  regional_saturation: {
    region_id: string;
    region_name: string;
    oversupplied_crops: string[];
    dominant_pest_family: string;
    current_crop_oversupplied: boolean;
    oversupply_penalty_pct: number;
  };
}

export interface SeasonMetrics {
  water_use_mm: number;
  water_budget_mm: number;
  water_deficit_mm: number;
  nitrogen_balance_kg_ha: number;
  fertilizer_n_kg_ha: number;
  som_pct: number;
  input_cost_usd_ha: number;
  revenue_usd_ha: number;
  net_margin_usd_ha: number;
  yield_factor: number;
}

export interface Strategy {
  id: StrategyId;
  short_id?: "A" | "B" | "C";
  name: string;
  description: string;
  seasons: {
    season: number;
    season_label: string;
    crop_id: string;
    crop_name: string;
    category: string;
    pest_family: string;
    metrics: SeasonMetrics;
  }[];
  objectives: {
    f_soil: number;
    f_water: number;
    f_cost: number;
  };
  totals: {
    water_use_mm: number;
    water_deficit_mm: number;
    nitrogen_balance_kg_ha: number;
    som_delta_pct: number;
    input_cost_usd_ha: number;
    revenue_usd_ha: number;
    net_margin_usd_ha: number;
    resilience_score: number;
    fitness: number;
  };
  warnings: string[];
}

export interface PredictResponse {
  request_id: string;
  execution_ms: number;
  location: Centroid;
  area_ha: number | null;
  inputs: Record<string, unknown>;
  climate: {
    source: "nasa_power" | "fallback";
    grid_key: string;
    lat: number;
    lon: number;
    cached: boolean;
    months_count: number;
    monthly: ClimateMonth[];
  };
  risk: RiskReport;
  strategies: Strategy[];
  recommended_strategy: StrategyId;
  optimizer: {
    method: string;
    population: number;
    generations: number;
    seed: number;
    lookup_source: string;
    in_memory_compute_ms: number;
  };
}

export interface Explanation {
  source: "gemini" | "template";
  model?: string;
  summary: string;
  per_strategy: { id: StrategyId; headline: string; why: string; risks: string[]; first_steps: string[] }[];
  caveats: string[];
}

export interface ProjectSeason {
  season_number: number;
  season?: number;
  season_label?: string;
  crop_id: string;
  crop_name?: string;
  target_water_mm?: number;
  input_cost_usd_ha?: number;
  metrics: SeasonMetrics;
}

export interface IProject {
  _id: string;
  owner?: string;
  name: string;
  farm_id: string;
  report_id: string;
  selected_strategy: StrategyId;
  seasons: ProjectSeason[];
  totals: Record<string, number>;
  objectives: { f_soil: number; f_water: number; f_cost: number };
  warnings: string[];
  recalculation_count: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface ProjectRecalcSeasonInput {
  crop_id: string;
  target_water_mm?: number;
  input_cost_usd_ha?: number;
}

export interface ProjectRecalcRequest {
  centroid: Centroid;
  soil_type: string;
  current_crop: string;
  region_id?: string;
  priority: Priority;
  planting_month?: number;
  area_ha?: number;
  seasons: ProjectRecalcSeasonInput[];
}

export interface ProjectRecalcResponse {
  seasons: {
    season_number: number;
    season?: number;
    season_label?: string;
    crop_id: string;
    crop_name: string;
    metrics: SeasonMetrics;
  }[];
  objectives: { f_soil: number; f_water: number; f_cost: number };
  totals: Record<string, number>;
  warnings: string[];
}
