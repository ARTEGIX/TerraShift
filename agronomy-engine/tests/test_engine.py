import time

import numpy as np
from fastapi.testclient import TestClient

import seed_atlas
from app.layer1_regression import run_layer1_regression
from app.layer2_evolution import run_layer2_evolution
from app.main import app
from app.memory_store import lookup_store
from app.nasa_fusion import build_cube_from_power, build_fallback_cube, grid_cache_key

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
