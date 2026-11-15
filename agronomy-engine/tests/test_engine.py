import time

import numpy as np
from fastapi.testclient import TestClient

import seed_atlas
from app.layer1_regression import run_layer1_regression
from app.layer2_evolution import (
    _build_strategy_payload,
    evaluate_population_vectorized,
    run_layer2_evolution,
)
from app.main import app
from app.memory_store import lookup_store
from app.appeears_client import aggregate_appeears_csvs, build_point_task_payload
from app.forecast_client import parse_seasonal_forecast
from app.nasa_fusion import (
    COL_NDVI,
    COL_SMAP_MOISTURE,
    COL_SOLAR,
    COL_T2M_MAX,
    SOIL_PARAMETERS,
    _fetch_power_raw,
    build_cube_from_power,
    build_fallback_cube,
    grid_cache_key,
)
from app.soil_client import classify_soil_type, parse_soilgrids_response
from app.terrain_client import compute_slope_and_ls

PAYLOAD = {
    "polygon": {
        "type": "Polygon",
        "coordinates": [
            [
                [80.3987, 8.3064],
                [80.4087, 8.3064],
                [80.4087, 8.3164],
                [80.3987, 8.3164],
                [80.3987, 8.3064],
            ]
        ],
    },
    "centroid": {"lat": 8.3114, "lon": 80.4037},
    "current_crop": "paddy_rice",
    "soil_type": "soil_clay_loam",
    "region_id": "region_lk_dryzone",
    "priority": "water",
}


def test_seed_atlas_catalogs_and_demo_farm():
    assert len(seed_atlas.CROPS_CATALOG_SEED) == 12
    assert len(seed_atlas.SOIL_PROFILES_SEED) == 3
    assert {s["_id"] for s in seed_atlas.SOIL_PROFILES_SEED} == {
        "soil_sandy_loam",
        "soil_clay_loam",
        "soil_degraded_dry",
    }
    assert {r["_id"] for r in seed_atlas.REGIONAL_SATURATION_SEED} == {
        "region_lk_dryzone",
        "region_us_midwest",
    }
    assert seed_atlas.DEMO_FARM_SEED["_id"] == "farm_demo_01"
    assert seed_atlas.DEMO_FARM_SEED["polygon"]["type"] == "Polygon"


def test_in_memory_lookup_store_matrix():
    assert lookup_store.crop_matrix.shape == (12, 6)
    assert lookup_store.crop_matrix.dtype == np.float64
    assert lookup_store.crop_matrix.flags["C_CONTIGUOUS"]
    assert lookup_store.resolve_crop_id("Paddy Rice") == "paddy_rice"
    assert lookup_store.resolve_soil_profile("clay")["_id"] == "soil_clay_loam"


def test_nasa_fusion_36_month_cube_and_grid_key():
    rlat, rlon, key = grid_cache_key(8.3114, 80.4037)
    assert (rlat, rlon) == (8.31, 80.40)
    assert key == "nasa:grid:8.31:80.40"

    cube = build_fallback_cube(8.3114, 80.4037)
    assert cube.matrix.shape == (36, 6)
    assert cube.matrix.dtype == np.float64
    assert len(cube.months) == 36
    # Verify SMAP root-zone moisture (col 4) and NDVI (col 5) bounds
    assert np.all((cube.matrix[:, 4] >= 10.0) & (cube.matrix[:, 4] <= 100.0))
    assert np.all((cube.matrix[:, 5] >= 0.10) & (cube.matrix[:, 5] <= 0.90))


def test_build_cube_from_power_interpolates_fill_values():
    ym_keys = [f"{y:04d}{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    raw = {
        "properties": {
            "parameter": {
                "T2M_MAX": {k: (32.0 if i != 5 else -999.0) for i, k in enumerate(ym_keys)},
                "PRECTOTCORR": {k: 3.5 for k in ym_keys},
                "ALLSKY_SFC_SW_DWN": {k: 5.4 for k in ym_keys},
                "EVPTRNS": {k: 9.8 for k in ym_keys},
            }
        },
        "parameters": {"EVPTRNS": {"units": "MJ/m^2/day"}},
    }
    cube = build_cube_from_power(raw, 8.31, 80.40, "nasa:grid:8.31:80.40")
    assert cube.matrix.shape == (36, 6)
    assert cube.matrix[5, 0] == 32.0
    assert np.isclose(cube.matrix[0, 2], 5.4 / 3.6)


def test_build_cube_from_power_with_optional_t2m_min_and_rh2m():
    ym_keys = [f"{y:04d}{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    raw = {
        "properties": {
            "parameter": {
                "T2M_MAX": {k: 32.0 for k in ym_keys},
                "T2M_MIN": {k: 23.5 for k in ym_keys},
                "RH2M": {k: 78.0 for k in ym_keys},
                "PRECTOTCORR": {k: 3.5 for k in ym_keys},
                "ALLSKY_SFC_SW_DWN": {k: 18.0 for k in ym_keys},
                "EVPTRNS": {k: 9.8 for k in ym_keys},
            }
        },
        "parameters": {
            "ALLSKY_SFC_SW_DWN": {"units": "MJ/m^2/day"},
            "EVPTRNS": {"units": "MJ/m^2/day"},
        },
    }
    cube = build_cube_from_power(raw, 8.31, 80.40, "nasa:grid:8.31:80.40")
    records = cube.to_monthly_records()
    assert np.isclose(cube.matrix[0, 2], 5.0)
    assert records[0]["t2m_min_c"] == 23.5
    assert records[0]["rh2m_pct"] == 78.0


def test_build_cube_from_power_uses_gwetroot_and_fetch_requests_soil_parameters(monkeypatch):
    import asyncio

    from app import nasa_fusion

    captured_params: dict[str, object] = {}

    class FakeResp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"properties": {"parameter": {}}}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, _url, params=None):
            captured_params.update(params or {})
            return FakeResp()

    monkeypatch.setattr(nasa_fusion.httpx, "AsyncClient", FakeClient)
    asyncio.run(_fetch_power_raw(8.31, 80.40, 2023, 2025))
    requested = str(captured_params.get("parameters", "")).split(",")
    for param in SOIL_PARAMETERS:
        assert param in requested

    ym_keys = [f"{y:04d}{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    raw = {
        "properties": {
            "parameter": {
                "T2M_MAX": {k: 32.0 for k in ym_keys},
                "PRECTOTCORR": {k: 3.5 for k in ym_keys},
                "ALLSKY_SFC_SW_DWN": {k: 18.0 for k in ym_keys},
                "EVPTRNS": {k: 9.8 for k in ym_keys},
                "GWETROOT": {k: (0.63 if i != 4 else -999.0) for i, k in enumerate(ym_keys)},
                "GWETTOP": {k: 0.42 for k in ym_keys},
            }
        },
        "parameters": {
            "ALLSKY_SFC_SW_DWN": {"units": "MJ/m^2/day"},
            "EVPTRNS": {"units": "MJ/m^2/day"},
        },
    }
    cube = build_cube_from_power(raw, 8.31, 80.40, "nasa:grid:8.31:80.40")
    assert np.allclose(cube.matrix[:, COL_SMAP_MOISTURE], 63.0)
    assert cube.extra_series is not None
    assert np.allclose(cube.extra_series["gwetroot_pct"], 63.0)
    assert np.allclose(cube.extra_series["gwettop_pct"], 42.0)


def test_soilgrids_parser_and_classifier():
    raw = {
        "properties": {
            "layers": [
                {"name": "clay", "unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 323}}]},
                {"name": "sand", "unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 424}}]},
                {"name": "silt", "unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 253}}]},
                {"name": "phh2o", "unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 57}}]},
                {"name": "soc", "unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 478}}]},
            ]
        }
    }
    parsed = parse_soilgrids_response(raw, 7.87, 80.77)
    assert parsed is not None
    assert parsed["clay_pct"] == 32.3
    assert parsed["ph"] == 5.7
    assert parsed["inferred_soil_type"] == "soil_clay_loam"
    assert classify_soil_type(10.0, 70.0, 5.0) == "soil_degraded_dry"
    assert classify_soil_type(15.0, 60.0, 15.0) == "soil_sandy_loam"


def test_appeears_payload_aggregation_and_power_override():
    payload = build_point_task_payload(7.87, 80.77, 2023, 2025)
    assert payload["task_type"] == "point"
    assert len(payload["params"]["layers"]) == 4

    months = [f"{y:04d}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    modis_csv = "ID,Latitude,Longitude,Date,MOD13Q1_061__250m_16_days_NDVI\n"
    modis_csv += "\n".join(f"id,7.87,80.77,{m}-01,0.62" for i, m in enumerate(months) if i != 10)
    smap_csv = "ID,Latitude,Longitude,Date,SPL4SMGP_008_Geophysical_Data_sm_rootzone_pctl\n"
    smap_csv += "\n".join(f"id,7.87,80.77,{m}-01,44.5" for m in months)

    agg = aggregate_appeears_csvs(modis_csv, smap_csv, months)
    assert agg is not None
    assert len(agg["ndvi"]) == 36
    assert agg["ndvi"][10] == 0.62
    assert agg["smap_moisture_pct"][0] == 44.5

    ym_keys = [m.replace("-", "") for m in months]
    raw = {
        "properties": {
            "parameter": {
                "T2M_MAX": {k: 31.0 for k in ym_keys},
                "PRECTOTCORR": {k: 4.0 for k in ym_keys},
                "ALLSKY_SFC_SW_DWN": {k: 18.0 for k in ym_keys},
                "EVPTRNS": {k: 9.8 for k in ym_keys},
            }
        },
        "parameters": {"EVPTRNS": {"units": "MJ/m^2/day"}},
    }
    cube = build_cube_from_power(raw, 7.87, 80.77, "nasa:grid:7.87:80.77", appeears_override=agg)
    assert cube.source == "nasa_power+appeears"
    assert np.isclose(cube.matrix[0, 4], 44.5)
    assert np.isclose(cube.matrix[0, 5], 0.62)


def test_layer1_and_layer2_consume_soilgrids_and_vpd():
    ym_keys = [f"{y:04d}{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    raw = {
        "properties": {
            "parameter": {
                "T2M_MAX": {k: 36.0 for k in ym_keys},
                "T2M_MIN": {k: 24.0 for k in ym_keys},
                "RH2M": {k: 40.0 for k in ym_keys},
                "PRECTOTCORR": {k: 3.0 for k in ym_keys},
                "ALLSKY_SFC_SW_DWN": {k: 18.0 for k in ym_keys},
                "EVPTRNS": {k: 9.8 for k in ym_keys},
            }
        },
        "parameters": {"ALLSKY_SFC_SW_DWN": {"units": "MJ/m^2/day"}, "EVPTRNS": {"units": "MJ/m^2/day"}},
    }
    cube = build_cube_from_power(raw, 7.87, 80.77, "nasa:grid:7.87:80.77")
    soilgrids = {"clay_pct": 18.0, "sand_pct": 62.0, "silt_pct": 20.0, "ph": 5.2, "soc_g_kg": 10.0}

    l1_base = run_layer1_regression(cube=cube, soil_type="soil_clay_loam", current_crop="paddy_rice")
    l1_sg = run_layer1_regression(
        cube=cube, soil_type="soil_clay_loam", current_crop="paddy_rice", soilgrids=soilgrids
    )

    assert l1_sg.mean_vpd_kpa is not None and l1_sg.mean_vpd_kpa > 1.6
    assert l1_sg.soil_profile["ph"] == 5.2
    assert l1_sg.soil_profile["leaching_factor"] != l1_base.soil_profile["leaching_factor"]
    strategies, _, _ = run_layer2_evolution("paddy_rice", "soil", l1_sg)
    assert len(strategies) == 3


def test_layer1_uses_regressed_smap_reserve_and_planting_month_anomaly():
    cube_high = build_fallback_cube(7.87, 80.77)
    cube_high.matrix[:, COL_SMAP_MOISTURE] = 85.0

    cube_low = build_fallback_cube(7.87, 80.77)
    cube_low.matrix[:, COL_SMAP_MOISTURE] = 25.0

    l1_high = run_layer1_regression(cube=cube_high, soil_type="soil_clay_loam", current_crop="paddy_rice")
    l1_low = run_layer1_regression(cube=cube_low, soil_type="soil_clay_loam", current_crop="paddy_rice")
    assert np.all(l1_high.season_water_budgets_mm > l1_low.season_water_budgets_mm)

    cube_pm = build_fallback_cube(7.87, 80.77)
    cube_pm.matrix[:, COL_SMAP_MOISTURE] = 50.0
    cube_pm.matrix[cube_pm.month_numbers == 4, COL_SMAP_MOISTURE] = np.array([60.0, 45.0, 30.0])
    cube_pm.matrix[cube_pm.month_numbers == 10, COL_SMAP_MOISTURE] = np.array([40.0, 55.0, 70.0])

    l1_apr = run_layer1_regression(
        cube=cube_pm, soil_type="soil_clay_loam", current_crop="paddy_rice", planting_month=4
    )
    l1_oct = run_layer1_regression(
        cube=cube_pm, soil_type="soil_clay_loam", current_crop="paddy_rice", planting_month=10
    )
    assert l1_apr.october_moisture_anomaly_pct < 0.0
    assert l1_oct.october_moisture_anomaly_pct > 0.0


def test_layer2_thermal_solar_ndvi_vigor_and_soilgrids_whc_som():
    # Improvement 3: Seasonal heat stress, VPD, solar irradiance & ECOSTRESS ESI in Layer 2 scoring
    cube_cool = build_fallback_cube(7.87, 80.77)
    cube_cool.matrix[:, COL_T2M_MAX] = 30.0
    cube_cool.matrix[:, COL_SOLAR] = 5.0

    cube_hot = build_fallback_cube(7.87, 80.77)
    cube_hot.matrix[:, COL_T2M_MAX] = 38.5
    cube_hot.matrix[:, COL_SOLAR] = 6.8
    cube_hot.extra_series = {
        "t2m_min_c": [25.0] * 36,
        "rh2m_pct": [35.0] * 36,
        "ecostress_esi": [0.32] * 36,
    }

    l1_cool = run_layer1_regression(cube=cube_cool, soil_type="soil_clay_loam", current_crop="paddy_rice")
    l1_hot = run_layer1_regression(cube=cube_hot, soil_type="soil_clay_loam", current_crop="paddy_rice")
    assert l1_hot.season_tmax_c.shape == (3,)
    assert l1_hot.season_solar_kwh.shape == (3,)
    assert np.all(l1_hot.season_tmax_c > 37.0)
    assert np.all(l1_hot.season_solar_kwh > 6.0)

    onion_idx = lookup_store.crop_index["onion"]
    sesame_idx = lookup_store.crop_index["sesame"]
    pop_test = np.array([[onion_idx, onion_idx, onion_idx], [sesame_idx, sesame_idx, sesame_idx]], dtype=np.int32)

    _, fw_cool, fc_cool = evaluate_population_vectorized(pop_test, l1_cool, lookup_store)
    _, fw_hot, fc_hot = evaluate_population_vectorized(pop_test, l1_hot, lookup_store)
    # Heat-sensitive onion drops sharply under >35°C + high VPD + low ESI, while C4/heat-tolerant sesame benefits from high solar
    assert fc_hot[0] < fc_cool[0]
    assert fw_hot[0] < fw_cool[0]
    assert fw_hot[1] >= fw_cool[1]

    # Improvement 4: Dynamic bare-field months from MODIS/HLS NDVI (<0.28) + field vigor multiplier from p90 NDVI
    cube_deg = build_fallback_cube(7.87, 80.77)
    cube_deg.matrix[:, COL_NDVI] = 0.32
    cube_deg.matrix[cube_deg.month_numbers == 6, COL_NDVI] = 0.21  # June bare soil detected from satellite

    cube_vig = build_fallback_cube(7.87, 80.77)
    cube_vig.matrix[:, COL_NDVI] = 0.76

    l1_deg = run_layer1_regression(cube=cube_deg, soil_type="soil_clay_loam", current_crop="paddy_rice")
    l1_vig = run_layer1_regression(cube=cube_vig, soil_type="soil_clay_loam", current_crop="paddy_rice")
    assert 6 in l1_deg.bare_field_months
    assert l1_vig.field_vigor_multiplier > l1_deg.field_vigor_multiplier

    strat_deg = _build_strategy_payload(
        "A_BASELINE", "Baseline", "Desc", (sesame_idx, sesame_idx, sesame_idx), l1_deg, lookup_store
    )
    strat_vig = _build_strategy_payload(
        "A_BASELINE", "Baseline", "Desc", (sesame_idx, sesame_idx, sesame_idx), l1_vig, lookup_store
    )
    assert strat_vig["totals"]["revenue_usd_ha"] > strat_deg["totals"]["revenue_usd_ha"]

    # Improvement 5: Pedotransfer water_holding_mm_m & initial SOM % from SoilGrids soc_g_kg
    sg_rich = {"clay_pct": 38.0, "sand_pct": 22.0, "silt_pct": 40.0, "ph": 6.4, "soc_g_kg": 25.0}
    sg_sandy = {"clay_pct": 10.0, "sand_pct": 75.0, "silt_pct": 15.0, "ph": 6.0, "soc_g_kg": 6.0}
    l1_rich = run_layer1_regression(
        cube=cube_cool, soil_type="soil_clay_loam", current_crop="paddy_rice", soilgrids=sg_rich
    )
    l1_sandy = run_layer1_regression(
        cube=cube_cool, soil_type="soil_clay_loam", current_crop="paddy_rice", soilgrids=sg_sandy
    )
    assert l1_rich.soil_profile["water_holding_mm_m"] > l1_sandy.soil_profile["water_holding_mm_m"]
    assert np.isclose(l1_rich.soil_profile["som_pct"], 25.0 * 0.1724, atol=1e-2)

    strat_rich = _build_strategy_payload(
        "A_BASELINE", "Baseline", "Desc", (sesame_idx, sesame_idx, sesame_idx), l1_rich, lookup_store
    )
    # Initial SOM = 25.0 * 0.1724 = 4.31%, minus 0.05 in season 1 -> ~4.26%
    assert np.isclose(strat_rich["seasons"][0]["metrics"]["som_pct"], 25.0 * 0.1724 - 0.05, atol=1e-2)

    # Improvement 6: Blend seasonal forecast season1_mean_tmax_c into Season 1 pred_t2m
    l1_fc_hot = run_layer1_regression(
        cube=cube_cool,
        soil_type="soil_clay_loam",
        current_crop="paddy_rice",
        seasonal_forecast={"season1_precip_mm": 400.0, "season1_mean_tmax_c": 39.0},
    )
    assert l1_fc_hot.seasonal_forecast_tmax_c == 39.0
    assert l1_fc_hot.season_tmax_c[0] > l1_cool.season_tmax_c[0]


def test_terrain_seasonal_forecast_and_hls_ecostress():
    terrain = compute_slope_and_ls(
        [(7.87, 80.77), (7.875, 80.775), (7.865, 80.765)],
        [120.0, 185.0, 118.0],
    )
    assert terrain["slope_pct"] > 5.0
    assert terrain["ls_factor"] > 1.2

    fc = parse_seasonal_forecast(
        {"daily": {"precipitation_sum": [2.0] * 180, "temperature_2m_max": [33.5] * 180}}
    )
    assert fc is not None
    assert fc["season1_precip_mm"] == 360.0

    months = [f"{y:04d}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    hls_csv = "ID,Latitude,Longitude,Date,HLSS30_VI_020_NDVI\n" + "\n".join(
        f"id,7.87,80.77,{m}-01,0.71" for m in months
    )
    eco_csv = "ID,Latitude,Longitude,Date,ECO_L4T_ESI_002_ESI\n" + "\n".join(
        f"id,7.87,80.77,{m}-01,0.38" for m in months
    )
    agg = aggregate_appeears_csvs(None, None, months, hls_csv=hls_csv, eco_csv=eco_csv)
    assert agg is not None
    assert agg["source"] == "appeears_hls_eco_smap"
    assert agg["ndvi"][0] == 0.71
    assert agg["ecostress_esi"][0] == 0.38

    cube = build_fallback_cube(7.87, 80.77)
    cube.extra_series = {"ecostress_esi": agg["ecostress_esi"]}
    l1 = run_layer1_regression(
        cube=cube,
        soil_type="soil_clay_loam",
        current_crop="paddy_rice",
        terrain=terrain,
        seasonal_forecast=fc,
    )
    assert l1.terrain_ls_factor == terrain["ls_factor"]
    assert l1.seasonal_forecast_precip_mm == 360.0
    assert l1.mean_ecostress_esi == 0.38


def test_in_memory_layer1_and_layer2_pipeline_under_200ms():
    cube = build_fallback_cube(8.3114, 80.4037)

    t0 = time.perf_counter()
    layer1 = run_layer1_regression(
        cube=cube,
        soil_type="soil_clay_loam",
        current_crop="paddy_rice",
        region_id="region_lk_dryzone",
    )
    strategies, recommended, meta = run_layer2_evolution(
        current_crop_id="paddy_rice",
        priority="water",
        layer1=layer1,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    assert elapsed_ms < 200.0, f"Expected < 200ms, took {elapsed_ms:.2f}ms"
    assert layer1.season_water_budgets_mm.shape == (3,)
    assert [s["id"] for s in strategies] == [
        "A_BASELINE",
        "B_SOIL_WATER_RESILIENCE",
        "C_COST_MARKET_OPTIMIZED",
    ]
    assert recommended in {"B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"}
    assert meta["population"] == 50
    assert meta["generations"] == 30


def test_predict_and_reload_endpoints():
    with TestClient(app) as client:
        h = client.get("/health")
        assert h.status_code == 200
        assert h.json()["lookup_store"]["crops_count"] == 12

        reload_resp = client.post("/internal/reload-lookup")
        assert reload_resp.status_code == 200
        assert reload_resp.json()["reloaded"] is True

        r = client.post("/predict", json=PAYLOAD)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["climate"]["grid_key"] == "nasa:grid:8.31:80.40"
        assert [s["id"] for s in body["strategies"]] == [
            "A_BASELINE",
            "B_SOIL_WATER_RESILIENCE",
            "C_COST_MARKET_OPTIMIZED",
        ]
        assert body["optimizer"]["in_memory_compute_ms"] < 200.0


def test_project_recalculate_endpoint():
    with TestClient(app) as client:
        recalc_payload = {
            "centroid": {"lat": 8.3114, "lon": 80.4037},
            "soil_type": "soil_clay_loam",
            "current_crop": "paddy_rice",
            "region_id": "region_lk_dryzone",
            "priority": "water",
            "planting_month": 10,
            "area_ha": 2.45,
            "seasons": [
                {"crop_id": "paddy_rice", "target_water_mm": 600.0, "input_cost_usd_ha": 350.0},
                {"crop_id": "mung_bean"},
                {"crop_id": "cowpea"},
            ],
        }
        resp = client.post("/predict/project-recalculate", json=recalc_payload)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert len(data["seasons"]) == 3
        assert data["seasons"][0]["crop_id"] == "paddy_rice"
        assert data["seasons"][0]["season_number"] == 1
        assert data["seasons"][0]["metrics"]["water_use_mm"] == 600.0

        assert "objectives" in data
        assert "f_soil" in data["objectives"]
        assert "f_water" in data["objectives"]
        assert "f_cost" in data["objectives"]

        assert "totals" in data
        assert "net_margin_usd_ha" in data["totals"]
        assert "water_use_mm" in data["totals"]
        assert "nitrogen_balance_kg_ha" in data["totals"]

        assert "warnings" in data


def test_appeears_pending_task_resumption_and_finalization(monkeypatch):
    import asyncio
    from app import appeears_client, appeears_store, cache

    fake_redis: dict[str, object] = {}

    async def fake_get(k: str):
        return fake_redis.get(k)

    async def fake_set(k: str, v: object, ttl_seconds: int | None = None):
        fake_redis[k] = v

    async def fake_del(k: str):
        fake_redis.pop(k, None)

    async def fake_l2_get(*_a, **_k):
        return None

    async def fake_l2_save(*_a, **_k):
        return True

    monkeypatch.setattr(cache, "get_json", fake_get)
    monkeypatch.setattr(cache, "set_json", fake_set)
    monkeypatch.setattr(cache, "delete_key", fake_del)
    monkeypatch.setattr(appeears_store, "get_appeears_series", fake_l2_get)
    monkeypatch.setattr(appeears_store, "save_appeears_series", fake_l2_save)
    monkeypatch.setattr(appeears_client, "_has_credentials", lambda: True)
    monkeypatch.setattr(appeears_client, "_get_appeears_token", lambda *_a, **_k: asyncio.sleep(0, result="tok"))

    # Simulate a pending task created in an earlier year window (2022-2024)
    old_months = [f"{y:04d}-{m:02d}" for y in (2022, 2023, 2024) for m in range(1, 13)]
    modis_csv = "ID,Latitude,Longitude,Date,MOD13Q1_061__250m_16_days_NDVI\n" + "\n".join(
        f"id,8.31,80.40,{m}-01,0.55" for m in old_months
    )
    eco_csv = "ID,Latitude,Longitude,Date,ECO_L4T_ESI_002_ESI\n" + "\n".join(
        f"id,8.31,80.40,{m}-01,0.72" for m in old_months
    )
    post_calls = 0
    get_calls = 0

    class FakeResp:
        def __init__(self, status_code: int, payload=None, text: str = ""):
            self.status_code = status_code
            self._payload = payload
            self.text = text

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **_kwargs):
            nonlocal post_calls
            post_calls += 1
            return FakeResp(200, {"task_id": "task-123"})

        async def get(self, url, **_kwargs):
            nonlocal get_calls
            get_calls += 1
            if url.endswith("/task/task-123"):
                return FakeResp(200, {"status": "done"})
            if url.endswith("/bundle/task-123"):
                return FakeResp(
                    200,
                    {
                        "files": [
                            {"file_id": "f1", "file_name": "terrashift-MOD13Q1-061-results.csv"},
                            {"file_id": "f2", "file_name": "terrashift-ECO-L4T-ESI-002-results.csv"},
                        ]
                    },
                )
            if url.endswith("/bundle/task-123/f1"):
                return FakeResp(200, text=modis_csv)
            if url.endswith("/bundle/task-123/f2"):
                return FakeResp(200, text=eco_csv)
            return FakeResp(404)

    monkeypatch.setattr(appeears_client.httpx, "AsyncClient", FakeClient)

    # Pre-populate pending task in Redis with old_months
    _, _, pending_key = appeears_client.appeears_pending_key(8.31, 80.40)
    fake_redis[pending_key] = {"task_id": "task-123", "months": old_months}

    # Hot /predict path should remain non-blocking (no HTTP calls)
    assert asyncio.run(appeears_client.get_cached_appeears_series(8.31, 80.40)) is None
    assert get_calls == 0
    assert post_calls == 0

    # Background prefetch resumes task-123 with old_months and does NOT POST a duplicate task
    res = asyncio.run(appeears_client.prefetch_appeears_point(8.31, 80.40, poll_interval_s=0.01, timeout_s=1.0))
    assert res is not None
    assert post_calls == 0
    assert res["months"] == old_months
    assert pending_key not in fake_redis
    _, _, cache_key = appeears_client.appeears_cache_key(8.31, 80.40)
    assert cache_key in fake_redis
    assert res["ndvi"][0] == 0.55
    assert res["ecostress_esi"][0] == 0.72

    # Stale 2022-2024 cached series must not satisfy current target_36_months()
    assert asyncio.run(appeears_client.get_cached_appeears_series(8.31, 80.40)) is None


def test_appeears_l1_redis_and_l2_general_db_fallback_and_write(monkeypatch):
    import asyncio

    from app import appeears_client, appeears_store, cache

    fake_redis: dict[str, object] = {}
    fake_l2: dict[tuple[str, int, int], dict[str, object]] = {}

    async def fake_get_json(k):
        return fake_redis.get(k)

    async def fake_set_json(k, v, ttl_seconds=None):
        fake_redis[k] = v

    async def fake_del(k):
        fake_redis.pop(k, None)

    async def fake_l2_get(grid_key, start_year, end_year):
        return fake_l2.get((grid_key, start_year, end_year))

    async def fake_l2_save(grid_key, lat, lon, start_year, end_year, data):
        fake_l2[(grid_key, start_year, end_year)] = data
        return True

    monkeypatch.setattr(cache, "get_json", fake_get_json)
    monkeypatch.setattr(cache, "set_json", fake_set_json)
    monkeypatch.setattr(cache, "delete_key", fake_del)
    monkeypatch.setattr(appeears_store, "get_appeears_series", fake_l2_get)
    monkeypatch.setattr(appeears_store, "save_appeears_series", fake_l2_save)

    months = appeears_client.target_36_months()
    start_year, end_year = int(months[0][:4]), int(months[-1][:4])
    _, _, cache_key = appeears_client.appeears_cache_key(7.87, 80.77)

    # Seed only L2 (simulating Redis restart / TTL expiry)
    l2_payload = {
        "source": "appeears_smap_modis",
        "months": months,
        "ndvi": [0.48] * 36,
        "smap_moisture_pct": [52.0] * 36,
    }
    fake_l2[(cache_key, start_year, end_year)] = l2_payload

    assert cache_key not in fake_redis
    status = asyncio.run(appeears_client.get_appeears_status(7.87, 80.77))
    assert status == {"status": "ready", "grid_key": cache_key}
    # L2 hit should warm L1 Redis
    assert fake_redis[cache_key] == l2_payload

    # Clear L1 again and verify get_cached_appeears_series also warms L1 from L2
    fake_redis.clear()
    series = asyncio.run(appeears_client.get_cached_appeears_series(7.87, 80.77))
    assert series == l2_payload
    assert fake_redis[cache_key] == l2_payload


def test_appeears_sync_completed_tasks(monkeypatch):
    import asyncio

    from app import appeears_client, appeears_store, cache

    fake_redis: dict[str, object] = {}
    fake_l2: dict[tuple[str, int, int], dict[str, object]] = {}

    async def fake_get_json(k):
        return fake_redis.get(k)

    async def fake_set_json(k, v, ttl_seconds=None):
        fake_redis[k] = v

    async def fake_del(k):
        fake_redis.pop(k, None)

    async def fake_l2_get(grid_key, start_year, end_year):
        return fake_l2.get((grid_key, start_year, end_year))

    async def fake_l2_save(grid_key, lat, lon, start_year, end_year, data):
        fake_l2[(grid_key, start_year, end_year)] = data
        return True

    monkeypatch.setattr(cache, "get_json", fake_get_json)
    monkeypatch.setattr(cache, "set_json", fake_set_json)
    monkeypatch.setattr(cache, "delete_key", fake_del)
    monkeypatch.setattr(appeears_store, "get_appeears_series", fake_l2_get)
    monkeypatch.setattr(appeears_store, "save_appeears_series", fake_l2_save)
    monkeypatch.setattr(appeears_client, "_has_credentials", lambda: True)
    monkeypatch.setattr(appeears_client, "_get_appeears_token", lambda *_a, **_k: asyncio.sleep(0, result="tok"))

    months = [f"{y:04d}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]
    modis_csv = "ID,Latitude,Longitude,Date,MOD13Q1_061__250m_16_days_NDVI\n" + "\n".join(
        f"id,7.25,79.86,{m}-01,0.61" for m in months
    )
    bundle_downloads = 0

    class FakeResp:
        def __init__(self, status_code: int, payload=None, text: str = ""):
            self.status_code = status_code
            self._payload = payload
            self.text = text

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, **_kwargs):
            nonlocal bundle_downloads
            if url.endswith("/task"):
                return FakeResp(
                    200,
                    [
                        {
                            "task_id": "old-t",
                            "task_name": "terrashift_7.25_79.86_2023_2025",
                            "status": "done",
                            "created": "2026-11-14T20:00:00",
                        },
                        {
                            "task_id": "new-t",
                            "task_name": "terrashift_7.25_79.86_2023_2025",
                            "status": "done",
                            "created": "2026-11-15T00:09:35",
                        },
                        {
                            "task_id": "pending-t",
                            "task_name": "terrashift_7.10_79.99_2023_2025",
                            "status": "pending",
                            "created": "2026-11-15T11:00:00",
                        },
                    ],
                )
            if url.endswith("/bundle/new-t"):
                bundle_downloads += 1
                return FakeResp(200, {"files": [{"file_id": "f1", "file_name": "terrashift-MOD13Q1-061-results.csv"}]})
            if url.endswith("/bundle/new-t/f1"):
                return FakeResp(200, text=modis_csv)
            return FakeResp(404)

    monkeypatch.setattr(appeears_client.httpx, "AsyncClient", FakeClient)

    synced = asyncio.run(appeears_client.sync_completed_appeears_tasks())
    assert len(synced) == 1
    assert synced[0]["task_id"] == "new-t"
    assert synced[0]["action"] == "imported"
    assert bundle_downloads == 1
    assert ("appeears:grid:7.25:79.86", 2023, 2025) in fake_l2
    assert "appeears:grid:7.25:79.86" in fake_redis


def test_appeears_import_csv_dir_groups_task_name_and_hyphen_prefixes(monkeypatch, tmp_path):
    import asyncio

    from app import appeears_client, appeears_store, cache

    fake_redis: dict[str, object] = {}
    fake_l2: dict[tuple[str, int, int], dict[str, object]] = {}

    async def fake_set_json(k, v, ttl_seconds=None):
        fake_redis[k] = v

    async def fake_del(k):
        fake_redis.pop(k, None)

    async def fake_l2_save(grid_key, lat, lon, start_year, end_year, data):
        fake_l2[(grid_key, start_year, end_year)] = data
        return True

    monkeypatch.setattr(cache, "set_json", fake_set_json)
    monkeypatch.setattr(cache, "delete_key", fake_del)
    monkeypatch.setattr(appeears_store, "save_appeears_series", fake_l2_save)

    m_22_24 = [f"{y:04d}-{m:02d}" for y in (2022, 2023, 2024) for m in range(1, 13)]
    m_23_25 = [f"{y:04d}-{m:02d}" for y in (2023, 2024, 2025) for m in range(1, 13)]

    (tmp_path / "terrashift_8.31_80.40_2022_2024-MOD13Q1-061-results.csv").write_text(
        "ID,Latitude,Longitude,Date,MOD13Q1_061__250m_16_days_NDVI\n"
        + "\n".join(f"id,8.31,80.40,{m}-01,0.51" for m in m_22_24)
    )
    (tmp_path / "terrashift-7-25-79-86-2023-2025-MOD13Q1-061-results.csv").write_text(
        "ID,Latitude,Longitude,Date,MOD13Q1_061__250m_16_days_NDVI\n"
        + "\n".join(f"id,7.25,79.86,{m}-01,0.68" for m in m_23_25)
    )

    imported = asyncio.run(appeears_client.import_appeears_csv_dir(str(tmp_path)))
    assert len(imported) == 2
    by_grid = {item["grid_key"]: item for item in imported}
    assert by_grid["appeears:grid:8.31:80.40"]["start_year"] == 2022
    assert by_grid["appeears:grid:8.31:80.40"]["end_year"] == 2024
    assert by_grid["appeears:grid:7.25:79.86"]["start_year"] == 2023
    assert by_grid["appeears:grid:7.25:79.86"]["end_year"] == 2025
    assert ("appeears:grid:8.31:80.40", 2022, 2024) in fake_l2
    assert ("appeears:grid:7.25:79.86", 2023, 2025) in fake_l2
    assert fake_l2[("appeears:grid:8.31:80.40", 2022, 2024)]["ndvi"][0] == 0.51
    assert fake_l2[("appeears:grid:7.25:79.86", 2023, 2025)]["ndvi"][0] == 0.68
