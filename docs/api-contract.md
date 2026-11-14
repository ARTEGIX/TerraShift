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

---

## 3. `main-service` (`/api/*`, connected to `general_db`)

### Farms (`general_db.farms`)
- **`GET /api/farms`** → `{ farms: IFarm[] }` (includes seeded `farm_demo_01` with `2dsphere` index)
- **`POST /api/farms`** → `{ _id?, name, polygon, centroid?, region_id?, soil_type, current_crop, default_priority }`
- **`GET /api/farms/:id`** → `{ farm: IFarm }`
- **`DELETE /api/farms/:id`** → `204`

### Simulation Runs (`general_db.simulation_runs`)
- **`POST /api/analyze`** (also aliased at `POST /api/simulation-runs` & `POST /api/analyses`)
  - Body: `{ farm_id: "farm_demo_01", priority?: "water" }` **or** `{ polygon, centroid?, current_crop, soil_type, region_id?, priority }`
  - Calls `http://agronomy-engine:8000/predict` → passes deterministic JSON output to `llmExplainer.ts` (Gemini with template fallback) → saves to `general_db.simulation_runs` → returns `{ id, farm_id, prediction, explanation, createdAt }`.
- **`GET /api/simulation-runs`** (`?farm_id=farm_demo_01`) → list saved runs
- **`GET /api/simulation-runs/:id`** → fetch full saved simulation run
