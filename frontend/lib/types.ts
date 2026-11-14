/**
 * Shared frontend TypeScript types mirroring docs/api-contract.md.
 */

export type SoilType = "soil_clay_loam" | "soil_sandy_loam" | "soil_degraded_dry";
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

export interface CropInfo {
  id: string;
  _id?: string;
  name: string;
  category: "cash_crop" | "legume" | "cover_crop" | "drought_tolerant";
  pest_family?: string;
  water_demand_mm: number;
  drought_tolerance?: number;
  nitrogen_impact_kg_ha: number;
  root_depth_cm: number;
  growth_days: number;
  erosion_cover_factor?: number;
  input_cost_usd_ha?: number;
  market_revenue_usd_ha?: number;
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
  water_budget_mm?: number;
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
    pest_family?: string;
    metrics: SeasonMetrics;
  }[];
  objectives?: {
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
  execution_ms?: number;
  location: Centroid;
  area_ha: number | null;
  inputs: Record<string, unknown>;
  climate: {
    source: "nasa_power" | "fallback";
    grid_key?: string;
    lat: number;
    lon: number;
    cached: boolean;
    months_count?: number;
  };
  risk: RiskReport;
  strategies: Strategy[];
  recommended_strategy: StrategyId;
  optimizer: {
    method: string;
    population: number;
    generations: number;
    seed: number;
    lookup_source?: string;
    in_memory_compute_ms?: number;
  };
}

export interface Explanation {
  source: "gemini" | "template";
  model?: string;
  summary: string;
  per_strategy: { id: StrategyId; headline: string; why: string; risks: string[]; first_steps: string[] }[];
  caveats: string[];
}

export interface AnalysisRecord {
  id: string;
  farm_id?: string | null;
  prediction: PredictResponse;
  explanation: Explanation;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: "farmer" | "advisor" | "admin";
}
