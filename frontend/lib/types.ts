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

export interface ClimateMonth {
  month: string; // YYYY-MM
  t2m_max_c: number;
  precip_mm: number;
  solar_kwh_m2_day: number;
  evapotranspiration_mm: number;
  smap_rootzone_pct?: number;
  ndvi?: number;
}

export interface PredictResponse {
  request_id: string;
  execution_ms?: number;
  location: Centroid;
  area_ha: number | null;
  inputs: Record<string, unknown>;
  climate: {
    source: "nasa_power" | "nasa_power+appeears" | "fallback";
    grid_key?: string;
    lat: number;
    lon: number;
    cached: boolean;
    months_count?: number;
    /** 36 months of NASA POWER + SMAP + NDVI (contract v0.2.0). */
    monthly?: ClimateMonth[];
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

/** `region_lk_dryzone` | `region_us_midwest` (lookup_db.regional_saturation) */
export type RegionId = string;

/** Farm document from general_db.farms (main-service v0.2.0, snake_case). */
export interface Farm {
  _id: string;
  name: string;
  region_id: RegionId;
  soil_type: string;
  current_crop: string;
  default_priority: Priority;
  planting_month?: number;
  area_ha: number;
  centroid: Centroid;
  polygon: Polygon;
  reports_count?: number;
  projects_count?: number;
  created_at?: string;
  updated_at?: string;
}

/** Linked report summary returned by GET /api/farms/:id. */
export interface FarmReportSummary {
  id: string;
  _id: string;
  recommended_strategy: StrategyId;
  climate_source: "nasa_power" | "nasa_power+appeears" | "fallback";
  created_at: string;
  current_crop?: string;
  projects_count: number;
}

export interface FarmDetailResponse {
  farm: Farm;
  reports: FarmReportSummary[];
}

export interface ProjectSeason {
  season_number?: number;
  season: number;
  season_label: string;
  crop_id: string;
  crop_name: string;
  target_water_mm?: number;
  input_cost_usd_ha?: number;
  metrics: SeasonMetrics;
}

export interface Project {
  id: string;
  _id?: string;
  name: string;
  farm_id: string;
  report_id: string;
  selected_strategy: StrategyId;
  seasons: ProjectSeason[];
  totals: Strategy["totals"];
  objectives: { f_soil: number; f_water: number; f_cost: number };
  warnings: string[];
  recalculation_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectDetailResponse {
  project: Project;
  farm: Pick<Farm, "_id" | "name" | "soil_type" | "current_crop" | "area_ha" | "centroid" | "polygon" | "planting_month"> & { id?: string } | null;
  report: {
    id: string;
    _id: string;
    recommended_strategy: StrategyId;
    climate_source: "nasa_power" | "nasa_power+appeears" | "fallback";
    created_at: string;
  } | null;
}

/** Row from GET /api/simulation-runs. */
export interface AnalysisSummary {
  _id: string;
  farm_id?: string | null;
  recommended_strategy: StrategyId;
  climate_source: "nasa_power" | "nasa_power+appeears" | "fallback";
  created_at: string;
  request?: { current_crop?: string; priority?: Priority };
}

/** "A_BASELINE" → "A". Uses `short_id` when the engine sends it. */
export const letterOf = (s: { id: StrategyId; short_id?: "A" | "B" | "C" } | StrategyId): "A" | "B" | "C" =>
  typeof s === "string" ? (s.charAt(0) as "A" | "B" | "C") : (s.short_id ?? (s.id.charAt(0) as "A" | "B" | "C"));
