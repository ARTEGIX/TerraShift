# TerraShift API Contract (`v0.1.0`)

Single source of truth for payloads exchanged between `frontend`, `main-service`, and `agronomy-engine`.
Any change to this file requires Lead review so all 6 team members stay in sync.

---

## 1. Enumerations

- **`SoilType`**: `"clay" | "loam" | "sandy" | "silt" | "laterite"`
- **`Priority`**: `"cost" | "water" | "soil"`
- **`CropCategory`**: `"cash_crop" | "legume" | "cover_crop" | "drought_tolerant"`
- **`StrategyId`**: `"A" | "B" | "C"`
- **`RiskLevel`**: `"low" | "medium" | "high"`
- **`Trend`**: `"improving" | "stable" | "worsening"`

---

## 2. `agronomy-engine` (`:8000` / `/engine/*`)

### `GET /crops`
Returns the 12-crop lookup array from [`crop_lookup.json`](../agronomy-engine/data/crop_lookup.json).

### `POST /predict`

#### Request Body (`PredictRequest`)
```json
{
  "polygon": {
    "type": "Polygon",
    "coordinates": [[[80.63, 7.29], [80.64, 7.29], [80.64, 7.30], [80.63, 7.30], [80.63, 7.29]]]
  },
  "centroid": { "lat": 7.295, "lon": 80.635 },
  "current_crop": "paddy_rice",
  "soil_type": "clay",
  "priority": "water",
  "area_ha": 2.4,
  "planting_month": 10
}
```

#### Response Body (`PredictResponse`)
```json
{
  "request_id": "e4d909c2-...",
  "location": { "lat": 7.3, "lon": 80.64 },
  "area_ha": 2.4,
  "inputs": {
    "current_crop": "paddy_rice",
    "soil_type": "clay",
    "priority": "water",
    "planting_month": 10
  },
  "climate": {
    "source": "nasa_power",
    "lat": 7.3,
    "lon": 80.64,
    "start_year": 2021,
    "end_year": 2025,
    "cached": false,
    "monthly": [
      {
        "month": "2021-01",
        "t2m_max_c": 30.8,
        "precip_mm": 182.4,
        "solar_kwh_m2_day": 5.1,
        "evapotranspiration_mm": 88.2
      }
    ]
  },
  "risk": {
    "overall_score": 26.7,
    "soil_moisture_deficit": {
      "score": 34.7,
      "trend": "stable",
      "cumulative_deficit_mm_12m": 210.4,
      "deficit_months_12m": 5,
      "forecast": [{ "month": "2026-01", "value": 45.2, "lower": -12.0, "upper": 102.4 }],
      "model": {
        "method": "OLS seasonal-trend regression + AR(1) residuals",
        "slope_per_year": -1.42,
        "r2": 0.78,
        "residual_std": 28.4,
        "n_obs": 60
      }
    },
    "erosion_windows": [
      { "month": "2026-01", "precip_mm": 190.2, "bare_field": false, "risk_level": "low" }
    ],
    "heat_stress": {
      "score": 1.3,
      "threshold_c": 35.0,
      "months_over_threshold": 0,
      "peak_t2m_max_c": 33.9,
      "model": {
        "method": "OLS seasonal-trend regression + AR(1) residuals",
        "slope_per_year": 0.04,
        "r2": 0.84,
        "residual_std": 0.41,
        "n_obs": 60
      }
    },
    "regional_saturation": {
      "score": 71.1,
      "neighbor_farms_sampled": 45,
      "crop_share_pct": 42.0,
      "family_share_pct": 56.0,
      "herfindahl_index": 0.241,
      "oversupply_risk": true,
      "monoculture_pest_risk": true,
      "crop_shares": { "paddy_rice": 0.42, "maize": 0.14 }
    }
  },
  "strategies": [
    {
      "id": "A",
      "name": "Baseline",
      "description": "Continue the current crop every season with conventional inputs.",
      "seasons": [
        {
          "season": 1,
          "season_label": "Maha 2026",
          "crop_id": "paddy_rice",
          "crop_name": "Paddy Rice",
          "category": "cash_crop",
          "metrics": {
            "water_use_mm": 995.0,
            "water_deficit_mm": 205.0,
            "nitrogen_balance_kg_ha": -90.0,
            "fertilizer_n_kg_ha": 90.0,
            "som_pct": 2.35,
            "input_cost_usd_ha": 795.4,
            "revenue_usd_ha": 860.0,
            "net_margin_usd_ha": 64.6,
            "yield_factor": 0.89
          }
        }
      ],
      "totals": {
        "water_use_mm": 2986.7,
        "water_deficit_mm": 639.4,
        "nitrogen_balance_kg_ha": -270.0,
        "som_delta_pct": -0.32,
        "input_cost_usd_ha": 2484.85,
        "revenue_usd_ha": 2588.71,
        "net_margin_usd_ha": 103.86,
        "resilience_score": 19.9,
        "fitness": -0.412
      },
      "warnings": ["Continuous cropping: soil N is mined each season, so fertilizer spend climbs."]
    }
  ],
  "recommended_strategy": "B",
  "optimizer": {
    "method": "Genetic algorithm (tournament selection, one-point crossover, per-gene mutation, elitism)",
    "population": 60,
    "generations": 40,
    "seed": 42001337
  }
}
```

---

## 3. `main-service` (`/api/*`)

### Authentication (`/api/auth`)
- **`POST /api/auth/register`** → `{ name, email, password }` ⇒ `201 { token, user: { id, name, email, role, createdAt } }`
- **`POST /api/auth/login`** → `{ email, password }` ⇒ `200 { token, user }`
- **`GET /api/auth/me`** (Header `Authorization: Bearer <token>`) ⇒ `200 { user }`
- **`POST /api/auth/logout`** (Header `Authorization: Bearer <token>`) ⇒ `204`

### Farms (`/api/farms`, Bearer JWT required)
- **`GET /api/farms`** ⇒ `200 { farms: Farm[] }`
- **`POST /api/farms`** → `{ name, polygon, centroid?, soil_type, current_crop, default_priority? }` ⇒ `201 { farm }`
- **`GET /api/farms/:id`** ⇒ `200 { farm }`
- **`DELETE /api/farms/:id`** ⇒ `204`

### Analyses (`/api/analyses`, Bearer JWT required)
- **`POST /api/analyses`**
  - Either `{ farm_id, priority?, planting_month? }` or `{ polygon, centroid?, current_crop, soil_type, priority, planting_month? }`
  - Returns `201 { id, prediction: PredictResponse, explanation: Explanation, createdAt }`
- **`GET /api/analyses`** ⇒ `200 { analyses: AnalysisSummary[] }`
- **`GET /api/analyses/:id`** ⇒ `200 { id, farm?, prediction, explanation, createdAt }`
