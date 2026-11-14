import type { AnalysisRecord, CropInfo } from "./types";

export const MOCK_CROPS: CropInfo[] = [
  { id: "paddy_rice", name: "Paddy Rice", category: "cash_crop", family: "poaceae", water_demand_mm: 1200, nitrogen_impact_kg_ha: -90, root_depth_cm: 30, growth_days: 120, avg_input_cost_usd_ha: 650, avg_market_revenue_usd_ha: 1150 },
  { id: "mung_bean", name: "Mung Bean", category: "legume", family: "fabaceae", water_demand_mm: 350, nitrogen_impact_kg_ha: 40, root_depth_cm: 60, growth_days: 70, avg_input_cost_usd_ha: 280, avg_market_revenue_usd_ha: 640 },
  { id: "cowpea", name: "Cowpea", category: "legume", family: "fabaceae", water_demand_mm: 400, nitrogen_impact_kg_ha: 50, root_depth_cm: 90, growth_days: 80, avg_input_cost_usd_ha: 250, avg_market_revenue_usd_ha: 580 },
  { id: "maize", name: "Maize", category: "cash_crop", family: "poaceae", water_demand_mm: 550, nitrogen_impact_kg_ha: -110, root_depth_cm: 120, growth_days: 110, avg_input_cost_usd_ha: 480, avg_market_revenue_usd_ha: 920 },
  { id: "finger_millet", name: "Finger Millet (Kurakkan)", category: "drought_tolerant", family: "poaceae", water_demand_mm: 350, nitrogen_impact_kg_ha: -40, root_depth_cm: 75, growth_days: 100, avg_input_cost_usd_ha: 220, avg_market_revenue_usd_ha: 540 },
  { id: "groundnut", name: "Groundnut", category: "legume", family: "fabaceae", water_demand_mm: 500, nitrogen_impact_kg_ha: 60, root_depth_cm: 50, growth_days: 110, avg_input_cost_usd_ha: 420, avg_market_revenue_usd_ha: 1000 },
  { id: "sesame", name: "Sesame (Gingelly)", category: "drought_tolerant", family: "pedaliaceae", water_demand_mm: 300, nitrogen_impact_kg_ha: -30, root_depth_cm: 120, growth_days: 90, avg_input_cost_usd_ha: 180, avg_market_revenue_usd_ha: 560 },
  { id: "chilli", name: "Chilli", category: "cash_crop", family: "solanaceae", water_demand_mm: 600, nitrogen_impact_kg_ha: -120, root_depth_cm: 60, growth_days: 150, avg_input_cost_usd_ha: 1400, avg_market_revenue_usd_ha: 3100 },
  { id: "onion", name: "Big Onion", category: "cash_crop", family: "amaryllidaceae", water_demand_mm: 450, nitrogen_impact_kg_ha: -100, root_depth_cm: 30, growth_days: 110, avg_input_cost_usd_ha: 1600, avg_market_revenue_usd_ha: 2900 },
  { id: "sunn_hemp", name: "Sunn Hemp (cover crop)", category: "cover_crop", family: "fabaceae", water_demand_mm: 300, nitrogen_impact_kg_ha: 120, root_depth_cm: 150, growth_days: 60, avg_input_cost_usd_ha: 90, avg_market_revenue_usd_ha: 60 },
  { id: "chickpea", name: "Chickpea", category: "legume", family: "fabaceae", water_demand_mm: 350, nitrogen_impact_kg_ha: 45, root_depth_cm: 100, growth_days: 100, avg_input_cost_usd_ha: 300, avg_market_revenue_usd_ha: 720 },
  { id: "cassava", name: "Cassava (Manioc)", category: "drought_tolerant", family: "euphorbiaceae", water_demand_mm: 700, nitrogen_impact_kg_ha: -70, root_depth_cm: 100, growth_days: 270, avg_input_cost_usd_ha: 450, avg_market_revenue_usd_ha: 1150 },
];

export const MOCK_ANALYSIS: AnalysisRecord = {
  id: "demo",
  createdAt: "2026-11-14T06:00:00.000Z",
  prediction: {
    request_id: "demo-request-001",
    location: { lat: 7.3, lon: 80.64 },
    area_ha: 2.4,
    inputs: { current_crop: "paddy_rice", soil_type: "clay", priority: "water", planting_month: 10 },
    climate: { source: "fallback", lat: 7.3, lon: 80.64, start_year: 2021, end_year: 2025, cached: false },
    risk: {
      overall_score: 26.7,
      soil_moisture_deficit: {
        score: 34.7,
        trend: "stable",
        cumulative_deficit_mm_12m: 210.4,
        deficit_months_12m: 5,
        forecast: [
          { month: "2026-01", value: 42.1, lower: -10.2, upper: 94.4 },
          { month: "2026-02", value: -18.5, lower: -70.0, upper: 33.0 },
          { month: "2026-03", value: -35.0, lower: -88.1, upper: 18.1 },
        ],
        model: { method: "OLS seasonal-trend regression + AR(1) residuals", slope_per_year: -1.42, r2: 0.78, residual_std: 28.4, n_obs: 60 },
      },
      erosion_windows: [
        { month: "2026-01", precip_mm: 190.2, bare_field: false, risk_level: "low" },
        { month: "2026-04", precip_mm: 245.0, bare_field: true, risk_level: "high" },
        { month: "2026-10", precip_mm: 260.4, bare_field: false, risk_level: "low" },
      ],
      heat_stress: {
        score: 1.3,
        threshold_c: 35,
        months_over_threshold: 0,
        peak_t2m_max_c: 33.9,
        model: { method: "OLS seasonal-trend regression + AR(1) residuals", slope_per_year: 0.04, r2: 0.84, residual_std: 0.41, n_obs: 60 },
      },
      regional_saturation: {
        score: 71.1,
        neighbor_farms_sampled: 45,
        crop_share_pct: 42.0,
        family_share_pct: 56.0,
        herfindahl_index: 0.241,
        oversupply_risk: true,
        monoculture_pest_risk: true,
        crop_shares: { paddy_rice: 0.42, maize: 0.14, mung_bean: 0.08, chilli: 0.08 },
      },
    },
    strategies: [
      {
        id: "A",
        name: "Baseline",
        description: "Continue the current crop every season with conventional inputs.",
        seasons: [
          { season: 1, season_label: "Maha 2026", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", metrics: { water_use_mm: 995, water_deficit_mm: 205, nitrogen_balance_kg_ha: -90, fertilizer_n_kg_ha: 90, som_pct: 2.35, input_cost_usd_ha: 795, revenue_usd_ha: 860, net_margin_usd_ha: 65, yield_factor: 0.89 } },
          { season: 2, season_label: "Yala 2026", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", metrics: { water_use_mm: 996, water_deficit_mm: 215, nitrogen_balance_kg_ha: -180, fertilizer_n_kg_ha: 99, som_pct: 2.24, input_cost_usd_ha: 847, revenue_usd_ha: 868, net_margin_usd_ha: 21, yield_factor: 0.82 } },
          { season: 3, season_label: "Maha 2027", crop_id: "paddy_rice", crop_name: "Paddy Rice", category: "cash_crop", metrics: { water_use_mm: 996, water_deficit_mm: 219, nitrogen_balance_kg_ha: -270, fertilizer_n_kg_ha: 108, som_pct: 2.08, input_cost_usd_ha: 842, revenue_usd_ha: 860, net_margin_usd_ha: 18, yield_factor: 0.76 } },
        ],
        totals: { water_use_mm: 2986.7, water_deficit_mm: 639.4, nitrogen_balance_kg_ha: -270, som_delta_pct: -0.32, input_cost_usd_ha: 2484.85, revenue_usd_ha: 2588.71, net_margin_usd_ha: 103.86, resilience_score: 19.9, fitness: -0.41 },
        warnings: ["Continuous cropping: soil N is mined each season, so fertilizer spend climbs.", "Repeated poaceae family raises pest & disease pressure."],
      },
      {
        id: "B",
        name: "Soil & Water Resilience",
        description: "Rebuild organic matter, fix nitrogen biologically and cut irrigation demand.",
        seasons: [
          { season: 1, season_label: "Maha 2026", crop_id: "sunn_hemp", crop_name: "Sunn Hemp (cover crop)", category: "cover_crop", metrics: { water_use_mm: 300, water_deficit_mm: 0, nitrogen_balance_kg_ha: 120, fertilizer_n_kg_ha: 0, som_pct: 2.51, input_cost_usd_ha: 90, revenue_usd_ha: 60, net_margin_usd_ha: -30, yield_factor: 1.04 } },
          { season: 2, season_label: "Yala 2026", crop_id: "sesame", crop_name: "Sesame (Gingelly)", category: "drought_tolerant", metrics: { water_use_mm: 309.5, water_deficit_mm: 0, nitrogen_balance_kg_ha: 90, fertilizer_n_kg_ha: 0, som_pct: 2.5, input_cost_usd_ha: 180, revenue_usd_ha: 503, net_margin_usd_ha: 323, yield_factor: 0.9 } },
          { season: 3, season_label: "Maha 2027", crop_id: "chickpea", crop_name: "Chickpea", category: "legume", metrics: { water_use_mm: 350, water_deficit_mm: 0, nitrogen_balance_kg_ha: 135, fertilizer_n_kg_ha: 0, som_pct: 2.51, input_cost_usd_ha: 300, revenue_usd_ha: 740, net_margin_usd_ha: 440, yield_factor: 1.03 } },
        ],
        totals: { water_use_mm: 959.5, water_deficit_mm: 0, nitrogen_balance_kg_ha: 135, som_delta_pct: 0.11, input_cost_usd_ha: 570, revenue_usd_ha: 1302.88, net_margin_usd_ha: 732.88, resilience_score: 86.7, fitness: 0.72 },
        warnings: [],
      },
      {
        id: "C",
        name: "Cost & Market Optimized",
        description: "Maximise net margin using biological N savings while avoiding crops the region already oversupplies.",
        seasons: [
          { season: 1, season_label: "Maha 2026", crop_id: "sunn_hemp", crop_name: "Sunn Hemp (cover crop)", category: "cover_crop", metrics: { water_use_mm: 300, water_deficit_mm: 0, nitrogen_balance_kg_ha: 120, fertilizer_n_kg_ha: 0, som_pct: 2.51, input_cost_usd_ha: 90, revenue_usd_ha: 60, net_margin_usd_ha: -30, yield_factor: 1.04 } },
          { season: 2, season_label: "Yala 2026", crop_id: "chilli", crop_name: "Chilli", category: "cash_crop", metrics: { water_use_mm: 530, water_deficit_mm: 73.6, nitrogen_balance_kg_ha: 0, fertilizer_n_kg_ha: 36, som_pct: 2.45, input_cost_usd_ha: 1463, revenue_usd_ha: 3042, net_margin_usd_ha: 1579, yield_factor: 0.98 } },
          { season: 3, season_label: "Maha 2027", crop_id: "chickpea", crop_name: "Chickpea", category: "legume", metrics: { water_use_mm: 350, water_deficit_mm: 0, nitrogen_balance_kg_ha: 45, fertilizer_n_kg_ha: 0, som_pct: 2.46, input_cost_usd_ha: 300, revenue_usd_ha: 740, net_margin_usd_ha: 440, yield_factor: 1.03 } },
        ],
        totals: { water_use_mm: 1180, water_deficit_mm: 73.6, nitrogen_balance_kg_ha: 45, som_delta_pct: 0.06, input_cost_usd_ha: 1853, revenue_usd_ha: 3842.24, net_margin_usd_ha: 1989.24, resilience_score: 72.6, fitness: 0.68 },
        warnings: [],
      },
    ],
    recommended_strategy: "B",
    optimizer: { method: "Genetic algorithm (tournament selection, one-point crossover, per-gene mutation, elitism)", population: 60, generations: 40, seed: 42 },
  },
  explanation: {
    source: "template",
    summary: "Overall climate & market risk for this field is 27/100 — mainly because 42% of nearby farms grow the same crop. We recommend Strategy B (Soil & Water Resilience): Sunn Hemp (cover crop) → Sesame (Gingelly) → Chickpea.",
    per_strategy: [
      { id: "A", headline: "Baseline: Paddy Rice → Paddy Rice → Paddy Rice", why: "Keeps your current crop. Over 3 seasons: net margin $104/ha, soil organic matter change -0.32%, nitrogen balance -270 kg/ha.", risks: ["Continuous cropping: soil N is mined each season, so fertilizer spend climbs."], first_steps: ["Get a soil test before next season", "Budget for rising fertilizer costs"] },
      { id: "B", headline: "Soil & Water Resilience: Sunn Hemp → Sesame → Chickpea", why: "Compared with today: +$629/ha margin, -2027 mm water, soil organic matter +0.11%, resilience 87/100.", risks: [], first_steps: ["Source Sunn Hemp seed before Maha 2026", "Talk to your local agrarian service centre about the rotation"] },
      { id: "C", headline: "Cost & Market Optimized: Sunn Hemp → Chilli → Chickpea", why: "Compared with today: +$1,885/ha margin, -1807 mm water, soil organic matter +0.06%, resilience 73/100.", risks: [], first_steps: ["Source Sunn Hemp seed before Maha 2026", "Arrange drip/supplemental irrigation for Yala Chilli"] },
    ],
    caveats: ["Based on modelled monsoon climate data.", "Prices and yields are regional averages — confirm with local markets."],
  },
};
