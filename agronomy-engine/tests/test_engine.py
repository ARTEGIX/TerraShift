import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.crops import load_crops, resolve_crop_id
from app.layer1_risk import SeasonalTrendModel, assess_risk
from app.layer2_rot import optimize_rotations
from app.main import app
from app.nasa_client import fallback_climate, parse_power_response

PAYLOAD = {
    "polygon": {
        "type": "Polygon",
        "coordinates": [[[80.63, 7.29], [80.64, 7.29], [80.64, 7.30], [80.63, 7.30], [80.63, 7.29]]],
    },
    "centroid": {"lat": 7.2953, "lon": 80.6351},
    "current_crop": "Paddy Rice",
    "soil_type": "clay",
    "priority": "water",
}


def test_crop_lookup_has_12_valid_entries():
    crops = load_crops()
    assert len(crops) == 12
    cats = {c["category"] for c in crops.values()}
    assert cats <= {"cash_crop", "legume", "cover_crop", "drought_tolerant"}
    assert crops["sunn_hemp"]["nitrogen_impact_kg_ha"] > 0
    assert crops["maize"]["nitrogen_impact_kg_ha"] < 0
    assert resolve_crop_id("Paddy Rice") == "paddy_rice"


def test_seasonal_trend_model_recovers_trend():
    idx = pd.period_range("2020-01", periods=60, freq="M")
    t = np.arange(60)
    y = 10 + 0.5 * t + 5 * np.sin(2 * np.pi * idx.month.to_numpy() / 12)
    m = SeasonalTrendModel().fit(pd.Series(y, index=idx))
    assert abs(m.slope_per_year - 6.0) < 1e-6
    assert m.r2 > 0.99
    assert len(m.forecast(12)) == 12


def test_fallback_is_deterministic():
    a = fallback_climate(7.3, 80.64, 2021, 2025)
    b = fallback_climate(7.3, 80.64, 2021, 2025)
    assert a == b and len(a.monthly) == 60 and a.source == "fallback"


def test_parse_power_response_handles_fill_and_annual():
    raw = {
        "properties": {"parameter": {
            "T2M_MAX": {"202401": 31.0, "202402": -999.0, "202403": 33.0, "202413": 32.0},
            "PRECTOTCORR": {"202401": 2.0, "202402": 1.0, "202403": 3.0, "202413": 2.0},
            "ALLSKY_SFC_SW_DWN": {"202401": 5.0, "202402": 5.5, "202403": 6.0, "202413": 5.5},
            "EVPTRNS": {"202401": 9.8, "202402": 9.8, "202403": 9.8, "202413": 9.8},
        }},
        "parameters": {"EVPTRNS": {"units": "MJ/m^2/day"}},
    }
    data = parse_power_response(raw, 7.3, 80.6, 2024, 2024)
    assert [m.month for m in data.monthly] == ["2024-01", "2024-02", "2024-03"]
    assert data.monthly[1].t2m_max_c == 32.0           # interpolated
    assert data.monthly[0].precip_mm == 62.0           # 2 mm/day × 31
    assert data.monthly[0].evapotranspiration_mm == 124.0  # 9.8/2.45 = 4 mm/day × 31


def test_layers_produce_three_distinct_strategies():
    climate = fallback_climate(7.3, 80.64, 2021, 2025)
    risk, ctx = assess_risk(climate, "paddy_rice", "clay")
    assert 0 <= risk.overall_score <= 100
    assert len(risk.erosion_windows) == 12
    strategies, rec, _ = optimize_rotations("paddy_rice", "clay", "soil", ctx)
    seqs = [tuple(s.crop_id for s in st.seasons) for st in strategies]
    assert [s.id for s in strategies] == ["A", "B", "C"]
    assert seqs[0] == ("paddy_rice",) * 3
    assert len(set(seqs)) == 3
    crops = load_crops()
    assert any(crops[c]["category"] in ("legume", "cover_crop") for c in seqs[1])
    # Baseline fertilizer N should not decrease season over season
    fert = [s.metrics.fertilizer_n_kg_ha for s in strategies[0].seasons]
    assert fert == sorted(fert)
    assert rec in {"A", "B", "C"}


def test_predict_endpoint_offline():
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        r = client.post("/predict", json=PAYLOAD)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["climate"]["source"] == "fallback"
        assert body["location"] == {"lat": 7.3, "lon": 80.64}
        assert len(body["strategies"]) == 3
        assert body["recommended_strategy"] in {"A", "B", "C"}


def test_predict_rejects_unknown_crop():
    with TestClient(app) as client:
        r = client.post("/predict", json={**PAYLOAD, "current_crop": "dragonfruit"})
        assert r.status_code == 422
