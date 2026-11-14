import type { AnalysisRecord, CropInfo } from "./types";

export const MOCK_CROPS: CropInfo[] = [
  { id: "paddy_rice", name: "Paddy Rice", category: "cash_crop", pest_family: "poaceae", water_demand_mm: 1200, drought_tolerance: 0.15, nitrogen_impact_kg_ha: -90, root_depth_cm: 30, growth_days: 120, erosion_cover_factor: 0.28, input_cost_usd_ha: 650, market_revenue_usd_ha: 1150 },
  { id: "mung_bean", name: "Mung Bean", category: "legume", pest_family: "fabaceae", water_demand_mm: 350, drought_tolerance: 0.72, nitrogen_impact_kg_ha: 42, root_depth_cm: 60, growth_days: 70, erosion_cover_factor: 0.18, input_cost_usd_ha: 280, market_revenue_usd_ha: 680 },
  { id: "cowpea", name: "Cowpea", category: "legume", pest_family: "fabaceae", water_demand_mm: 380, drought_tolerance: 0.80, nitrogen_impact_kg_ha: 50, root_depth_cm: 90, growth_days: 80, erosion_cover_factor: 0.15, input_cost_usd_ha: 250, market_revenue_usd_ha: 620 },
  { id: "maize", name: "Maize", category: "cash_crop", pest_family: "poaceae", water_demand_mm: 550, drought_tolerance: 0.42, nitrogen_impact_kg_ha: -110, root_depth_cm: 120, growth_days: 110, erosion_cover_factor: 0.35, input_cost_usd_ha: 480, market_revenue_usd_ha: 960 },
  { id: "finger_millet", name: "Finger Millet", category: "drought_tolerant", pest_family: "poaceae", water_demand_mm: 340, drought_tolerance: 0.86, nitrogen_impact_kg_ha: -35, root_depth_cm: 75, growth_days: 100, erosion_cover_factor: 0.22, input_cost_usd_ha: 220, market_revenue_usd_ha: 560 },
  { id: "groundnut", name: "Groundnut", category: "legume", pest_family: "fabaceae", water_demand_mm: 480, drought_tolerance: 0.65, nitrogen_impact_kg_ha: 58, root_depth_cm: 55, growth_days: 110, erosion_cover_factor: 0.20, input_cost_usd_ha: 420, market_revenue_usd_ha: 1040 },
  { id: "sesame", name: "Sesame", category: "drought_tolerant", pest_family: "pedaliaceae", water_demand_mm: 300, drought_tolerance: 0.90, nitrogen_impact_kg_ha: -30, root_depth_cm: 120, growth_days: 90, erosion_cover_factor: 0.25, input_cost_usd_ha: 180, market_revenue_usd_ha: 590 },
  { id: "chilli", name: "Chilli", category: "cash_crop", pest_family: "solanaceae", water_demand_mm: 600, drought_tolerance: 0.35, nitrogen_impact_kg_ha: -115, root_depth_cm: 60, growth_days: 150, erosion_cover_factor: 0.38, input_cost_usd_ha: 1350, market_revenue_usd_ha: 2850 },
  { id: "onion", name: "Onion", category: "cash_crop", pest_family: "amaryllidaceae", water_demand_mm: 450, drought_tolerance: 0.30, nitrogen_impact_kg_ha: -95, root_depth_cm: 30, growth_days: 110, erosion_cover_factor: 0.42, input_cost_usd_ha: 1500, market_revenue_usd_ha: 2750 },
  { id: "sunn_hemp", name: "Sunn Hemp", category: "cover_crop", pest_family: "fabaceae", water_demand_mm: 280, drought_tolerance: 0.78, nitrogen_impact_kg_ha: 110, root_depth_cm: 150, growth_days: 60, erosion_cover_factor: 0.08, input_cost_usd_ha: 95, market_revenue_usd_ha: 140 },
  { id: "chickpea", name: "Chickpea", category: "legume", pest_family: "fabaceae", water_demand_mm: 340, drought_tolerance: 0.76, nitrogen_impact_kg_ha: 45, root_depth_cm: 100, growth_days: 100, erosion_cover_factor: 0.19, input_cost_usd_ha: 300, market_revenue_usd_ha: 760 },
  { id: "cassava", name: "Cassava", category: "drought_tolerant", pest_family: "euphorbiaceae", water_demand_mm: 680, drought_tolerance: 0.82, nitrogen_impact_kg_ha: -65, root_depth_cm: 110, growth_days: 240, erosion_cover_factor: 0.32, input_cost_usd_ha: 440, market_revenue_usd_ha: 1180 },
];

export const MOCK_ANALYSIS: AnalysisRecord = {
  id: "demo",
  farm_id: "farm_demo_01",
  createdAt: "2026-11-14T08:00:00.000Z",
  prediction: {
    request_id: "demo-request-001",
    execution_ms: 4.8,
    location: { lat: 8.31, lon: 80.4 },
    area_ha: 2.45,
    inputs: { current_crop: "paddy_rice", soil_type: "soil_clay_loam", region_id: "region_lk_dryzone", priority: "water", planting_month: 10 },
    climate: { source: "fallback", grid_key: "nasa:grid:8.31:80.40", lat: 8.31, lon: 80.4, cached: false, months_count: 36 },
    risk: {
      overall_score: 48.2,
      season_water_budgets_mm: [740.5, 420.2, 725.0],
      october_moisture_anomaly_pct: -6.4,
      soil_moisture_deficit: {
        score: 64.1,
        trend: "worsening",
        october_moisture_anomaly_pct: -6.4,
        slope_mm_per_year: -3.2,
        r2: 0.81,
      },
      bare_field_erosion: {
        score: 36.4,
        soil_k_factor: 0.22,
        bare_field_months: [3, 4, 8, 9],
        windows: [
          { month_num: 10, projected_precip_mm: 240.0, bare_field: false, risk_level: "low" },
          { month_num: 4, projected_precip_mm: 215.0, bare_field: true, risk_level: "high" },
        ],
      },
      heat_stress: {
        score: 28.5,
        peak_t2m_max_c: 34.4,
        months_over_35c: 0,
      },
      regional_saturation: {
        region_id: "region_lk_dryzone",
        region_name: "Sri Lanka Dry & Intermediate Zone (Mahaweli / Anuradhapura)",
        oversupplied_crops: ["paddy_rice", "maize", "onion"],
        dominant_pest_family: "poaceae",
        current_crop_oversupplied: true,
        oversupply_penalty_pct: 22.0,
      },
    },
    strategies: [
      {
        id: "A_BASELINE",
        short_id: "A",
        name: "Strategy A: Baseline (Current Practice)",
        description: "Continues your current crop across all 3 seasons with conventional synthetic inputs.",
        seasons: [
          { season: 1, season_label: "Season 1 (Maha)", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", pest_family: "poaceae", metrics: { water_use_mm: 1200, water_budget_mm: 740.5, water_deficit_mm: 459.5, nitrogen_balance_kg_ha: -90, fertilizer_n_kg_ha: 90, som_pct: 2.05, input_cost_usd_ha: 771.5, revenue_usd_ha: 618.0, net_margin_usd_ha: -153.5, yield_factor: 0.689 } },
          { season: 2, season_label: "Season 2 (Yala)", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", pest_family: "poaceae", metrics: { water_use_mm: 1200, water_budget_mm: 420.2, water_deficit_mm: 779.8, nitrogen_balance_kg_ha: -180, fertilizer_n_kg_ha: 99, som_pct: 1.97, input_cost_usd_ha: 794.3, revenue_usd_ha: 368.8, net_margin_usd_ha: -425.5, yield_factor: 0.411 } },
          { season: 3, season_label: "Season 3 (Maha)", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", pest_family: "poaceae", metrics: { water_use_mm: 1200, water_budget_mm: 725.0, water_deficit_mm: 475.0, nitrogen_balance_kg_ha: -270, fertilizer_n_kg_ha: 99, som_pct: 1.89, input_cost_usd_ha: 805.7, revenue_usd_ha: 506.0, net_margin_usd_ha: -299.7, yield_factor: 0.564 } },
        ],
        objectives: { f_soil: 0.14, f_water: 0.34, f_cost: 0.0 },
        totals: { water_use_mm: 3600, water_deficit_mm: 1714.3, nitrogen_balance_kg_ha: -270, som_delta_pct: -0.21, input_cost_usd_ha: 2371.5, revenue_usd_ha: 1492.8, net_margin_usd_ha: -878.7, resilience_score: 23.0, fitness: 0.168 },
        warnings: [
          "Continuous monocropping depletes soil nitrogen and raises synthetic fertilizer spend each season.",
          "Paddy Rice is flagged as regionally oversupplied (-22% price risk).",
        ],
      },
      {
        id: "B_SOIL_WATER_RESILIENCE",
        short_id: "B",
        name: "Strategy B: Soil & Water Resilience",
        description: "Maximizes biological nitrogen fixation, erosion cover, pest family breaks, and drought tolerance.",
        seasons: [
          { season: 1, season_label: "Season 1 (Maha)", crop_id: "sunn_hemp", crop_name: "Sunn Hemp", category: "cover_crop", pest_family: "fabaceae", metrics: { water_use_mm: 280, water_budget_mm: 740.5, water_deficit_mm: 0, nitrogen_balance_kg_ha: 110, fertilizer_n_kg_ha: 0, som_pct: 2.24, input_cost_usd_ha: 95, revenue_usd_ha: 144.2, net_margin_usd_ha: 49.2, yield_factor: 1.03 } },
          { season: 2, season_label: "Season 2 (Yala)", crop_id: "sesame", crop_name: "Sesame", category: "drought_tolerant", pest_family: "pedaliaceae", metrics: { water_use_mm: 300, water_budget_mm: 420.2, water_deficit_mm: 0, nitrogen_balance_kg_ha: 80, fertilizer_n_kg_ha: 0, som_pct: 2.19, input_cost_usd_ha: 180, revenue_usd_ha: 607.7, net_margin_usd_ha: 427.7, yield_factor: 1.03 } },
          { season: 3, season_label: "Season 3 (Maha)", crop_id: "cowpea", crop_name: "Cowpea", category: "legume", pest_family: "fabaceae", metrics: { water_use_mm: 380, water_budget_mm: 725.0, water_deficit_mm: 0, nitrogen_balance_kg_ha: 130, fertilizer_n_kg_ha: 0, som_pct: 2.25, input_cost_usd_ha: 250, revenue_usd_ha: 638.6, net_margin_usd_ha: 388.6, yield_factor: 1.03 } },
        ],
        objectives: { f_soil: 0.84, f_water: 0.93, f_cost: 0.31 },
        totals: { water_use_mm: 960, water_deficit_mm: 0, nitrogen_balance_kg_ha: 130, som_delta_pct: 0.15, input_cost_usd_ha: 525, revenue_usd_ha: 1390.5, net_margin_usd_ha: 865.5, resilience_score: 88.1, fitness: 0.712 },
        warnings: [],
      },
      {
        id: "C_COST_MARKET_OPTIMIZED",
        short_id: "C",
        name: "Strategy C: Cost & Market Optimized",
        description: "Balances biological nitrogen fertilizer savings with high-margin crops that avoid regional oversupply.",
        seasons: [
          { season: 1, season_label: "Season 1 (Maha)", crop_id: "groundnut", crop_name: "Groundnut", category: "legume", pest_family: "fabaceae", metrics: { water_use_mm: 480, water_budget_mm: 740.5, water_deficit_mm: 0, nitrogen_balance_kg_ha: 58, fertilizer_n_kg_ha: 0, som_pct: 2.16, input_cost_usd_ha: 420, revenue_usd_ha: 1071.2, net_margin_usd_ha: 651.2, yield_factor: 1.03 } },
          { season: 2, season_label: "Season 2 (Yala)", crop_id: "sesame", crop_name: "Sesame", category: "drought_tolerant", pest_family: "pedaliaceae", metrics: { water_use_mm: 300, water_budget_mm: 420.2, water_deficit_mm: 0, nitrogen_balance_kg_ha: 28, fertilizer_n_kg_ha: 0, som_pct: 2.11, input_cost_usd_ha: 180, revenue_usd_ha: 607.7, net_margin_usd_ha: 427.7, yield_factor: 1.03 } },
          { season: 3, season_label: "Season 3 (Maha)", crop_id: "chilli", crop_name: "Chilli", category: "cash_crop", pest_family: "solanaceae", metrics: { water_use_mm: 600, water_budget_mm: 725.0, water_deficit_mm: 0, nitrogen_balance_kg_ha: -87, fertilizer_n_kg_ha: 107.3, som_pct: 2.06, input_cost_usd_ha: 1518.9, revenue_usd_ha: 2935.5, net_margin_usd_ha: 1416.6, yield_factor: 1.03 } },
        ],
        objectives: { f_soil: 0.56, f_water: 0.88, f_cost: 0.79 },
        totals: { water_use_mm: 1380, water_deficit_mm: 0, nitrogen_balance_kg_ha: -87, som_delta_pct: -0.04, input_cost_usd_ha: 2118.9, revenue_usd_ha: 4614.4, net_margin_usd_ha: 2495.5, resilience_score: 70.4, fitness: 0.741 },
        warnings: [],
      },
    ],
    recommended_strategy: "B_SOIL_WATER_RESILIENCE",
    optimizer: {
      method: "Vectorized NumPy Multi-Objective Genetic Algorithm (in-memory crop_matrix)",
      population: 50,
      generations: 30,
      seed: 42,
      lookup_source: "local_seed_fallback",
      in_memory_compute_ms: 4.2,
    },
  },
  explanation: {
    source: "template",
    summary:
      "Field risk score is 48/100 driven by declining root-zone soil moisture trend, bare-field erosion risk (36/100), and regional oversupply of paddy_rice (-22% price penalty). Recommended: Strategy B: Soil & Water Resilience (Sunn Hemp → Sesame → Cowpea), delivering $866/ha net margin and 88/100 resilience.",
    per_strategy: [
      { id: "A_BASELINE", headline: "Strategy A: Baseline: Paddy Rice → Paddy Rice → Paddy Rice", why: "Continues current practice. 3-season net margin -$879/ha, nitrogen balance -270 kg/ha, SOM Δ -0.21%.", risks: ["Continuous monocropping depletes soil nitrogen and raises synthetic fertilizer spend each season."], first_steps: ["Test soil nitrogen before Maha planting", "Budget for +8%/season urea cost inflation"] },
      { id: "B_SOIL_WATER_RESILIENCE", headline: "Strategy B: Soil & Water Resilience: Sunn Hemp → Sesame → Cowpea", why: "Vs. baseline: +$1,744/ha net margin, -2,640 mm water demand, N balance +130 kg/ha, resilience 88/100.", risks: [], first_steps: ["Secure Sunn Hemp seed ahead of Season 1 (Maha)", "Incorporate legume/cover-crop residue to capture biological nitrogen credit"] },
      { id: "C_COST_MARKET_OPTIMIZED", headline: "Strategy C: Cost & Market Optimized: Groundnut → Sesame → Chilli", why: "Vs. baseline: +$3,374/ha net margin, -2,220 mm water demand, N balance -87 kg/ha, resilience 70/100.", risks: [], first_steps: ["Secure Groundnut seed ahead of Season 1 (Maha)", "Use legume nitrogen carryover to cut synthetic fertilizer on Season 3 Chilli"] },
    ],
    caveats: [
      "Harmonized 36-month NASA POWER + SMAP + NDVI cube (nasa:grid:8.31:80.40).",
      "Market revenues and input costs are regional reference averages (FAO GAEZ / USDA AMS).",
    ],
  },
};
