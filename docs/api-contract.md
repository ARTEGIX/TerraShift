# TerraShift API Contract (`v0.2.0`)

Single source of truth for payloads exchanged between `frontend`, `main-service`, and `agronomy-engine` under the **MongoDB Atlas Dual-Database (`lookup_db` + `general_db`) + In-Memory NumPy/Redis Pipeline**.

---

## 1. Enumerations & IDs

- **`SoilType` (`lookup_db.soil_profiles`)**: `"soil_sandy_loam" | "soil_clay_loam" | "soil_degraded_dry"` (also accepts `"sandy" | "clay" | "loam" | "silt" | "laterite"`)
- **`RegionId` (`lookup_db.regional_saturation`)**: `"region_lk_dryzone" | "region_us_midwest"`
- **`Priority`**: `"cost" | "water" | "soil"`
- **`StrategyId`**: `"A_BASELINE" | "B_SOIL_WATER_RESILIENCE" | "C_COST_MARKET_OPTIMIZED"`

---

## 2. `agronomy-engine` (`:8000` / `/engine/*`)

### `GET /health`
Returns engine readiness, Redis connectivity, and `lookup_store` status (`source`, `crops_count: 12`, `matrix_shape: [12, 6]`).

### `POST /internal/reload-lookup`
Reloads `crops_catalog`, `soil_profiles`, and `regional_saturation` from MongoDB Atlas `lookup_db` into RAM and rebuilds the `12 × 6` `np.float64` matrix (`lookup_store.crop_matrix`).

### `GET /crops` · `GET /soils` · `GET /regions`
Returns the in-memory dictionaries loaded from `lookup_db`.

### `POST /predict`
Runs:
1. **Step 0 (`app/nasa_fusion.py`)**: 36-month NASA POWER (`T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`, `EVPTRNS`) + SMAP root-zone moisture + MODIS/Sentinel-2 NDVI array (`shape=(36, 6)`), cached in Redis under `nasa:grid:{lat:.2f}:{lon:.2f}` for 24h.
2. **Layer 1 (`app/layer1_regression.py`)**: In-memory Ridge / polynomial regression projecting `season_water_budgets_mm`, `october_moisture_anomaly_pct`, `bare_field_erosion`, and regional oversupply penalties.
3. **Layer 2 (`app/layer2_evolution.py`)**: Vectorized NumPy multi-objective Genetic Algorithm (`pop_size=50`, `n_gen=30`) evaluating $F_{\text{soil}}$, $F_{\text{water}}$, and $F_{\text{cost}}$ directly against `lookup_store.crop_matrix` to output `A_BASELINE`, `B_SOIL_WATER_RESILIENCE`, and `C_COST_MARKET_OPTIMIZED`.

### `POST /predict/project-recalculate`
Evaluates a user-defined 3-season plan with optional per-season water or cost overrides without running the GA search:
- **Body (`ProjectRecalcRequest`)**:
  - `centroid`: `{ lat: number, lon: number }`
  - `soil_type`: `string`
  - `current_crop`: `string`
  - `region_id?`: `string`
  - `priority`: `"cost" | "water" | "soil"`
  - `planting_month?`: `number` (1..12, default `10`)
  - `area_ha?`: `number`
  - `seasons`: array of 3 objects: `[{ crop_id: string, target_water_mm?: number, input_cost_usd_ha?: number }]`
- **Output (`ProjectRecalcResponse`)**:
  - `seasons`: array of 3 evaluated seasons with `season_number`, `crop_id`, `crop_name`, `metrics`
  - `objectives`: `{ f_soil: number, f_water: number, f_cost: number }`
  - `totals`: summary totals (`water_use_mm`, `water_deficit_mm`, `nitrogen_balance_kg_ha`, `som_delta_pct`, `input_cost_usd_ha`, `revenue_usd_ha`, `net_margin_usd_ha`, `resilience_score`, `fitness`)
  - `warnings`: array of agronomic advisory strings

---

## 3. `main-service` (`/api/*`, connected to `general_db`)

### Farms (`general_db.farms`)
- **`GET /api/farms`** → `{ farms: (IFarm & { reports_count: number, projects_count: number })[] }`
- **`POST /api/farms`** → `{ farm: IFarm }`
  - Body: `{ _id?, name, polygon, centroid?, region_id?, soil_type, current_crop, default_priority, planting_month? }`
- **`GET /api/farms/:id`** → `{ farm: IFarm & { reports_count: number, projects_count: number }, reports: Array<{ id, recommended_strategy, climate_source, created_at, current_crop, projects_count }> }`
- **`PATCH /api/farms/:id`** → `{ farm: IFarm }`
  - Body (`FarmPatch`): editable fields (`name?`, `polygon?`, `centroid?`, `region_id?`, `soil_type?`, `current_crop?`, `default_priority?`, `planting_month?`)
  - **Cascade Rule:** Updates editable fields, recalculates `area_ha` and `centroid` if polygon is updated, and **cascade-deletes** all linked `SimulationRun` and `Project` records.
- **`DELETE /api/farms/:id`** → `204`
  - **Cascade Rule:** Cascade-deletes all linked `SimulationRun` and `Project` records, then deletes the `Farm`.

### Simulation Runs (`general_db.simulation_runs`)
- **`POST /api/analyze`** (also aliased at `POST /api/simulation-runs` & `POST /api/analyses`)
  - Body: `{ farm_id: "farm_demo_01", priority?: "water", planting_month?: number }` **or** `{ polygon, centroid?, current_crop, soil_type, region_id?, priority, planting_month?: number }`
  - Calls `http://agronomy-engine:8000/predict` → passes deterministic JSON output to `llmExplainer.ts` (Gemini with template fallback) → saves to `general_db.simulation_runs` → returns `{ id, farm_id, prediction, explanation, createdAt }`.
- **`GET /api/simulation-runs`** (`?farm_id=farm_demo_01`) → list saved runs
- **`GET /api/simulation-runs/:id`** → fetch full saved simulation run
- **`DELETE /api/simulation-runs/:id`** (also aliased at `DELETE /api/analyses/:id`) → `204`
  - **Cascade Rule:** Cascade-deletes all linked `Project` records for that `report_id`, then deletes the `SimulationRun`.

### Projects (`general_db.projects`)
- **`POST /api/projects`** → `{ project: IProject }`
  - Body: `{ report_id: string, selected_strategy: "A_BASELINE" | "B_SOIL_WATER_RESILIENCE" | "C_COST_MARKET_OPTIMIZED", name: string }`
  - Creates a 3-season project by snapshotting the selected strategy plan from `SimulationRun`.
- **`GET /api/projects`** (`?farm_id=`, `?report_id=`) → `{ projects: IProject[] }`
- **`GET /api/projects/:id`** → `{ project: IProject }`
- **`PATCH /api/projects/:id`** → `{ project: IProject }`
  - Body: `{ name?: string, seasons?: [{ crop_id: string, target_water_mm?: number, input_cost_usd_ha?: number }] }`
  - Updates project metadata or season parameters without recalculating metrics.
- **`POST /api/projects/:id/recalculate`** → `{ project: IProject }`
  - Body: `{ seasons: [{ crop_id: string, target_water_mm?: number, input_cost_usd_ha?: number }] }`
  - Sends updated 3-season parameters to `agronomy-engine` `POST /predict/project-recalculate`, increments `recalculation_count`, persists updated metrics and totals, and returns the updated project.
- **`DELETE /api/projects/:id`** → `204`
  - Deletes the specified project document.
