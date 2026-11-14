/**
 * Shared frontend TypeScript types mirroring docs/api-contract.md.
 */

export type SoilType = "clay" | "loam" | "sandy" | "silt" | "laterite";
export type Priority = "cost" | "water" | "soil";
export type StrategyId = "A" | "B" | "C";
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
  name: string;
  category: "cash_crop" | "legume" | "cover_crop" | "drought_tolerant";
  family: string;
  water_demand_mm: number;
  nitrogen_impact_kg_ha: number;
  root_depth_cm: number;
  growth_days: number;
  avg_input_cost_usd_ha: number;
  avg_market_revenue_usd_ha: number;
}

export interface ModelDiagnostics {
  method: string;
  slope_per_year: number;
  r2: number;
  residual_std: number;
  n_obs: number;
}

export interface RiskReport {
  overall_score: number;
  soil_moisture_deficit: {
    score: number;
    trend: "improving" | "stable" | "worsening";
    cumulative_deficit_mm_12m: number;
    deficit_months_12m: number;
    forecast: { month: string; value: number; lower: number; upper: number }[];
    model: ModelDiagnostics;
  };
  erosion_windows: { month: string; precip_mm: number; bare_field: boolean; risk_level: RiskLevel }[];
  heat_stress: {
    score: number;
    threshold_c: number;
    months_over_threshold: number;
    peak_t2m_max_c: number;
    model: ModelDiagnostics;
  };
  regional_saturation: {
    score: number;
    neighbor_farms_sampled: number;
    crop_share_pct: number;
    family_share_pct: number;
    herfindahl_index: number;
    oversupply_risk: boolean;
    monoculture_pest_risk: boolean;
    crop_shares: Record<string, number>;
  };
}

export interface SeasonMetrics {
  water_use_mm: number;
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
  name: string;
  description: string;
  seasons: {
    season: number;
    season_label: string;
    crop_id: string;
    crop_name: string;
    category: string;
    metrics: SeasonMetrics;
  }[];
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
  location: Centroid;
  area_ha: number | null;
  inputs: Record<string, unknown>;
  climate: {
    source: "nasa_power" | "fallback";
    lat: number;
    lon: number;
    start_year: number;
    end_year: number;
    cached: boolean;
  };
  risk: RiskReport;
  strategies: Strategy[];
  recommended_strategy: StrategyId;
  optimizer: { method: string; population: number; generations: number; seed: number };
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
