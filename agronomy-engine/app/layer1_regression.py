"""Layer 1: In-Memory Regression Engine (`layer1_regression.py`).

Runs fast Ridge / polynomial regression (`scikit-learn` + `numpy.polyfit`) on the fused
36-month NumPy array (`FusedClimateCube.matrix`) in RAM to project:
  1. Next 3 seasons' available water budget (`season_water_budgets_mm`)
  2. October root-zone soil moisture anomaly (`october_moisture_anomaly_pct`)
  3. Bare-field erosion risk (`bare_field_erosion_risk` + monthly windows)
  4. Regional neighbor-farm oversupply penalties & monoculture pest risk
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.linear_model import Ridge

from app.memory_store import InMemoryLookupStore, lookup_store
from app.nasa_fusion import (
    COL_ET,
    COL_NDVI,
    COL_PRECIP,
    COL_SMAP_MOISTURE,
    COL_SOLAR,
    COL_T2M_MAX,
    FusedClimateCube,
)


@dataclass
class Layer1RegressionOutput:
    """In-memory regression output consumed by Layer 2's vectorized Genetic Algorithm."""

    overall_risk_score: float
    season_water_budgets_mm: np.ndarray          # shape (3,), float64 — Season 1, 2, 3 available water (mm)
    season_labels: list[str]                     # ["Season 1 (Maha)", "Season 2 (Yala)", "Season 3 (Maha)"]
    october_moisture_anomaly_pct: float          # projected Oct root-zone soil moisture anomaly (%)
    moisture_trend_slope_per_yr: float           # mm/month per year slope from np.polyfit
    moisture_r2: float
    heat_stress_score: float
    peak_t2m_max_c: float
    months_over_35c: int
    bare_field_erosion_score: float
    bare_field_months: list[int]
    erosion_windows: list[dict[str, Any]]
    soil_profile: dict[str, Any]
    region_profile: dict[str, Any]
    oversupply_penalty_vector: np.ndarray        # shape (N_crops,), float64 penalty (0.0 or 0.22)
    dominant_pest_family_code: int               # integer family id in `lookup_store.pest_family_vocab`
    mean_vpd_kpa: float | None = None
    frost_months: int = 0
    terrain_ls_factor: float = 1.0
    terrain_slope_pct: float = 0.0
    seasonal_forecast_precip_mm: float | None = None
    seasonal_forecast_tmax_c: float | None = None
    mean_ecostress_esi: float | None = None
    season_tmax_c: np.ndarray = field(default_factory=lambda: np.full(3, 31.5, dtype=np.float64))
    season_solar_kwh: np.ndarray = field(default_factory=lambda: np.full(3, 5.2, dtype=np.float64))
    field_vigor_multiplier: float = 1.0

    def to_summary_dict(self, current_crop_id: str) -> dict[str, Any]:
        oversupplied = list(self.region_profile.get("oversupplied_crops", []))
        crop_is_oversupplied = current_crop_id in oversupplied
        return {
            "overall_score": round(self.overall_risk_score, 1),
            "season_water_budgets_mm": [round(float(x), 1) for x in self.season_water_budgets_mm],
            "season_tmax_c": [round(float(x), 2) for x in self.season_tmax_c],
            "season_solar_kwh": [round(float(x), 2) for x in self.season_solar_kwh],
            "field_vigor_multiplier": round(self.field_vigor_multiplier, 4),
            "october_moisture_anomaly_pct": round(self.october_moisture_anomaly_pct, 2),
            "soil_moisture_deficit": {
                "score": round(min(100.0, max(0.0, 50.0 - self.october_moisture_anomaly_pct * 2.2)), 1),
                "trend": (
                    "worsening"
                    if self.moisture_trend_slope_per_yr < -1.5
                    else "improving"
                    if self.moisture_trend_slope_per_yr > 1.5
                    else "stable"
                ),
                "october_moisture_anomaly_pct": round(self.october_moisture_anomaly_pct, 2),
                "slope_mm_per_year": round(self.moisture_trend_slope_per_yr, 2),
                "r2": round(self.moisture_r2, 3),
            },
            "bare_field_erosion": {
                "score": round(self.bare_field_erosion_score, 1),
                "soil_k_factor": float(self.soil_profile["erosion_k_factor"]),
                "terrain_ls_factor": self.terrain_ls_factor,
                "terrain_slope_pct": self.terrain_slope_pct,
                "bare_field_months": self.bare_field_months,
                "windows": self.erosion_windows,
            },
            "heat_stress": {
                "score": round(self.heat_stress_score, 1),
                "peak_t2m_max_c": round(self.peak_t2m_max_c, 2),
                "months_over_35c": self.months_over_35c,
                **({"mean_vpd_kpa": self.mean_vpd_kpa} if self.mean_vpd_kpa is not None else {}),
                **({"frost_months": self.frost_months} if self.frost_months else {}),
            },
            "regional_saturation": {
                "region_id": self.region_profile["_id"],
                "region_name": self.region_profile.get("name", self.region_profile["_id"]),
                "oversupplied_crops": oversupplied,
                "dominant_pest_family": self.region_profile.get("dominant_pest_family", "poaceae"),
                "current_crop_oversupplied": crop_is_oversupplied,
                "oversupply_penalty_pct": 22.0 if crop_is_oversupplied else 0.0,
            },
        }


def _seasonal_design_matrix(t_idx: np.ndarray, month_numbers: np.ndarray) -> np.ndarray:
    """Harmonic + linear time features for fast in-memory Ridge regression."""
    angle1 = 2.0 * np.pi * month_numbers / 12.0
    angle2 = 4.0 * np.pi * month_numbers / 12.0
    return np.column_stack(
        [
            t_idx / 36.0,
            np.sin(angle1),
            np.cos(angle1),
            np.sin(angle2),
            np.cos(angle2),
        ]
    )


def _enrich_soil_with_soilgrids(
    soil: dict[str, Any],
    soilgrids: dict[str, Any] | None,
) -> dict[str, Any]:
    """Refine static soil profile factors using live ISRIC SoilGrids telemetry when available."""
    enriched = dict(soil)
    if not soilgrids:
        return enriched

    clay = soilgrids.get("clay_pct")
    sand = soilgrids.get("sand_pct")
    silt = soilgrids.get("silt_pct")
    soc = soilgrids.get("soc_g_kg")
    ph = soilgrids.get("ph")

    if sand is not None and clay is not None:
        enriched["leaching_factor"] = round(float(np.clip(0.15 + 0.006 * sand - 0.003 * clay, 0.15, 0.75)), 3)
        soc_for_whc = float(soc) if soc is not None else 15.0
        som_for_whc = soc_for_whc * 0.1724
        whc = 110.0 + 1.45 * float(clay) - 0.65 * float(sand) + 6.5 * min(som_for_whc, 6.0)
        enriched["water_holding_mm_m"] = round(float(np.clip(whc, 70.0, 220.0)), 1)
    if silt is not None:
        soc_val = float(soc) if soc is not None else 15.0
        enriched["erosion_k_factor"] = round(
            float(np.clip(0.18 + 0.004 * silt - 0.0025 * min(soc_val, 50.0), 0.12, 0.55)), 3
        )
    if ph is not None:
        enriched["ph"] = float(ph)
    if soc is not None:
        enriched["soc_g_kg"] = float(soc)
        enriched["som_pct"] = round(float(soc) * 0.1724, 3)
    return enriched


def _compute_vpd_and_frost(cube: FusedClimateCube) -> tuple[float | None, int]:
    """Compute mean Vapor Pressure Deficit (kPa) and frost month count from T2M_MIN/RH2M."""
    extra = cube.extra_series or {}
    raw_tmin = extra.get("t2m_min_c")
    raw_rh = extra.get("rh2m_pct")

    frost_months = 0
    tmin_arr: np.ndarray | None = None
    if isinstance(raw_tmin, list) and len(raw_tmin) == cube.matrix.shape[0]:
        tmin_arr = np.asarray(raw_tmin, dtype=np.float64)
        frost_months = int(np.sum(tmin_arr < 4.0))

    mean_vpd_kpa: float | None = None
    if isinstance(raw_rh, list) and len(raw_rh) == cube.matrix.shape[0]:
        rh_arr = np.clip(np.asarray(raw_rh, dtype=np.float64), 5.0, 100.0)
        tmax_arr = cube.matrix[:, COL_T2M_MAX]
        t_mean = 0.5 * (tmax_arr + tmin_arr) if tmin_arr is not None else (tmax_arr - 4.0)
        es = 0.6108 * np.exp((17.27 * t_mean) / (t_mean + 237.3))
        vpd = es * (1.0 - rh_arr / 100.0)
        mean_vpd_kpa = round(float(np.mean(vpd)), 3)

    return mean_vpd_kpa, frost_months


def run_layer1_regression(
    cube: FusedClimateCube,
    soil_type: str,
    current_crop: str,
    region_id: str | None = None,
    planting_month: int = 10,
    store: InMemoryLookupStore = lookup_store,
    soilgrids: dict[str, Any] | None = None,
    terrain: dict[str, Any] | None = None,
    seasonal_forecast: dict[str, Any] | None = None,
) -> Layer1RegressionOutput:
    """Project 3-season water budgets, Oct soil moisture anomaly, erosion risk & regional penalties."""
    mat = cube.matrix
    n = mat.shape[0]
    t = np.arange(n, dtype=np.float64)
    months = cube.month_numbers

    region = store.resolve_region_profile(region_id, cube.lat, cube.lon)
    regional_store = store.for_region(region["_id"], ensure_crop_id=current_crop)
    soil = _enrich_soil_with_soilgrids(
        regional_store.resolve_soil_profile(soil_type, region_id=region["_id"]),
        soilgrids,
    )
    mean_vpd_kpa, frost_months = _compute_vpd_and_frost(cube)
    ls_factor = float((terrain or {}).get("ls_factor", 1.0))
    slope_pct = float((terrain or {}).get("slope_pct", 0.0))
    fc_precip_mm = (seasonal_forecast or {}).get("season1_precip_mm")
    fc_tmax_c = (seasonal_forecast or {}).get("season1_mean_tmax_c")
    raw_esi = (cube.extra_series or {}).get("ecostress_esi")
    mean_esi = round(float(np.mean(raw_esi)), 3) if isinstance(raw_esi, list) and raw_esi else None

    precip = mat[:, COL_PRECIP]
    et = mat[:, COL_ET]
    solar = mat[:, COL_SOLAR]
    t2m = mat[:, COL_T2M_MAX]
    smap = mat[:, COL_SMAP_MOISTURE]
    ndvi = mat[:, COL_NDVI]
    water_balance = precip - 0.65 * et

    # 1. Ridge regression on monthly effective water, solar, temperature & SMAP to project next 18 months (3 x 6m seasons)
    X_train = _seasonal_design_matrix(t, months)
    future_t = np.arange(n, n + 18, dtype=np.float64)
    future_months = np.array([((planting_month - 1 + k) % 12) + 1 for k in range(18)], dtype=np.int32)
    X_future = _seasonal_design_matrix(future_t, future_months)

    ridge_precip = Ridge(alpha=1.0).fit(X_train, precip)
    ridge_et = Ridge(alpha=1.0).fit(X_train, et)
    ridge_solar = Ridge(alpha=1.0).fit(X_train, solar)
    ridge_t2m = Ridge(alpha=1.0).fit(X_train, t2m)
    ridge_smap = Ridge(alpha=1.0).fit(X_train, smap)

    pred_precip = np.clip(ridge_precip.predict(X_future), 5.0, None)
    pred_et = np.clip(ridge_et.predict(X_future), 20.0, None)
    pred_solar = np.clip(ridge_solar.predict(X_future), 2.5, 9.5)
    pred_t2m = ridge_t2m.predict(X_future).copy()
    if fc_tmax_c is not None:
        pred_t2m[:6] = 0.65 * pred_t2m[:6] + 0.35 * float(fc_tmax_c)
    pred_smap = np.clip(ridge_smap.predict(X_future), 10.0, 100.0)

    pred_wb = ridge_precip.predict(X_train) - 0.65 * ridge_et.predict(X_train)
    ss_tot = float(np.sum((water_balance - water_balance.mean()) ** 2)) or 1.0
    r2 = float(np.clip(1.0 - np.sum((water_balance - pred_wb) ** 2) / ss_tot, 0.0, 1.0))

    # Linear trend via numpy.polyfit on water balance (mm/month change per year)
    slope_per_month, _ = np.polyfit(t, water_balance, 1)
    moisture_slope_yr = float(slope_per_month * 12.0)

    # Available water budget, max temp & solar irradiance per 6-month season
    whc_factor = float(soil["water_holding_mm_m"]) / 140.0
    retention = 1.0 - 0.45 * float(soil["leaching_factor"])
    season_budgets = np.zeros(3, dtype=np.float64)
    season_tmax_c = np.zeros(3, dtype=np.float64)
    season_solar_kwh = np.zeros(3, dtype=np.float64)
    season_labels: list[str] = []

    vpd_evap_mult = 1.0 + max(0.0, ((mean_vpd_kpa or 0.0) - 1.6) * 0.12)
    esi_water_mult = 0.90 if (mean_esi is not None and mean_esi < 0.45) else 1.0
    for s in range(3):
        sl = slice(s * 6, (s + 1) * 6)
        ridge_rain = float(np.sum(pred_precip[sl]))
        if s == 0 and fc_precip_mm is not None:
            ridge_rain = 0.65 * ridge_rain + 0.35 * float(fc_precip_mm)
        eff_rain = ridge_rain * retention
        start_moisture_frac = float(pred_smap[s * 6]) / 100.0
        soil_reserve = float(soil["water_holding_mm_m"]) * start_moisture_frac
        evap_loss = float(np.sum(pred_et[sl]) * 0.22 * vpd_evap_mult)
        season_budgets[s] = max(
            140.0,
            (eff_rain + soil_reserve - evap_loss) * (0.85 + 0.15 * whc_factor) * (esi_water_mult if s == 0 else 1.0),
        )
        season_tmax_c[s] = float(np.mean(pred_t2m[sl]))
        season_solar_kwh[s] = float(np.mean(pred_solar[sl]))
        first_m = int(future_months[s * 6])
        label_name = "Maha" if first_m in (9, 10, 11, 12, 1, 2) else "Yala"
        season_labels.append(f"Season {s + 1} ({label_name})")

    # 2. Planting-month root-zone soil moisture anomaly (%) via np.polyfit over historical planting months + SMAP series
    target_month = int(np.clip(planting_month, 1, 12))
    pm_mask = months == target_month
    pm_values = smap[pm_mask] if np.any(pm_mask) else smap[-3:]
    pm_x = np.arange(pm_values.size, dtype=np.float64)
    if pm_values.size >= 2:
        pm_slope, pm_intercept = np.polyfit(pm_x, pm_values, 1)
        projected_pm = float(pm_slope * pm_values.size + pm_intercept)
    else:
        projected_pm = float(pm_values[-1])
    baseline_pm = float(np.mean(smap))
    oct_anomaly_pct = float(((projected_pm - baseline_pm) / max(10.0, baseline_pm)) * 100.0)

    # 3. Bare-field erosion risk & NDVI field vigor calibration (MODIS/HLS NDVI + crop rotation calendar)
    regional_bare = {int(m) for m in region.get("bare_field_months", [3, 4, 8, 9])}
    crop_doc = regional_store.crops_by_id.get(current_crop) or store.crops_by_id.get(current_crop, {})
    harvest_span_m = max(2, min(5, int(round(float(crop_doc.get("growth_days", 110)) / 30.0))))
    post_harvest_month = ((planting_month - 1 + harvest_span_m) % 12) + 1

    sat_bare: set[int] = set()
    sat_covered: set[int] = set()
    for m_cal in range(1, 13):
        m_mask = months == m_cal
        if np.any(m_mask):
            m_ndvi = float(np.mean(ndvi[m_mask]))
            if m_ndvi < 0.28:
                sat_bare.add(m_cal)
            elif m_ndvi >= 0.65:
                sat_covered.add(m_cal)
            elif m_cal == post_harvest_month and m_ndvi < 0.34:
                sat_bare.add(m_cal)

    bare_months = sorted((regional_bare - sat_covered) | sat_bare) or sorted(regional_bare)
    ndvi_p90 = float(np.percentile(ndvi, 90))
    field_vigor_mult = round(float(np.clip(0.75 + 0.40 * ((ndvi_p90 - 0.30) / 0.45), 0.75, 1.15)), 4)

    k_factor = float(soil["erosion_k_factor"])
    erosion_windows: list[dict[str, Any]] = []
    erosion_scores: list[float] = []

    for i in range(12):
        m_num = int(future_months[i])
        rain_m = float(pred_precip[i])
        is_bare = m_num in bare_months
        ndvi_hist = float(np.mean(ndvi[months == m_num])) if np.any(months == m_num) else 0.45
        exposure = (1.25 - ndvi_hist) if is_bare else 0.45
        index_val = rain_m * k_factor * ls_factor * exposure
        level = "high" if (is_bare and index_val > 42.0) else "medium" if index_val > 24.0 else "low"
        erosion_scores.append(min(100.0, index_val * 1.45))
        erosion_windows.append(
            {
                "month_num": m_num,
                "projected_precip_mm": round(rain_m, 1),
                "bare_field": is_bare,
                "risk_level": level,
            }
        )
    bare_erosion_score = float(np.clip(np.mean(erosion_scores), 0.0, 100.0))

    # 4. Heat stress risk from regressed T2M_MAX + VPD/frost telemetry
    over_35 = int(np.sum(pred_t2m[:12] > 35.0))
    peak_tmax = float(np.max(pred_t2m[:12]))
    vpd_penalty = max(0.0, ((mean_vpd_kpa or 0.0) - 1.6) * 10.0)
    heat_score = float(np.clip((peak_tmax - 31.0) * 11.0 + over_35 * 6.5 + vpd_penalty + frost_months * 3.0, 0.0, 100.0))

    # 5. Regional neighbor-farm saturation penalties
    oversupply_mask = regional_store.oversupplied_mask(region["_id"], cube.lat)
    oversupply_penalty_vector = oversupply_mask * 0.22  # 22% revenue discount when regionally oversupplied
    dom_family = str(region.get("dominant_pest_family", "poaceae"))
    dom_family_code = regional_store.pest_family_vocab.get(dom_family, -1)

    moisture_risk = float(np.clip(50.0 - oct_anomaly_pct * 2.2 - moisture_slope_yr * 1.8, 0.0, 100.0))
    saturation_risk = 75.0 if current_crop in region.get("oversupplied_crops", []) else 35.0
    overall_score = float(
        np.clip(
            0.35 * moisture_risk + 0.25 * bare_erosion_score + 0.20 * heat_score + 0.20 * saturation_risk,
            0.0,
            100.0,
        )
    )

    return Layer1RegressionOutput(
        overall_risk_score=overall_score,
        season_water_budgets_mm=season_budgets,
        season_labels=season_labels,
        october_moisture_anomaly_pct=oct_anomaly_pct,
        moisture_trend_slope_per_yr=moisture_slope_yr,
        moisture_r2=r2,
        heat_stress_score=heat_score,
        peak_t2m_max_c=peak_tmax,
        months_over_35c=over_35,
        bare_field_erosion_score=bare_erosion_score,
        bare_field_months=bare_months,
        erosion_windows=erosion_windows,
        soil_profile=soil,
        region_profile=region,
        oversupply_penalty_vector=oversupply_penalty_vector,
        dominant_pest_family_code=dom_family_code,
        mean_vpd_kpa=mean_vpd_kpa,
        frost_months=frost_months,
        terrain_ls_factor=ls_factor,
        terrain_slope_pct=slope_pct,
        seasonal_forecast_precip_mm=float(fc_precip_mm) if fc_precip_mm is not None else None,
        seasonal_forecast_tmax_c=float(fc_tmax_c) if fc_tmax_c is not None else None,
        mean_ecostress_esi=mean_esi,
        season_tmax_c=season_tmax_c,
        season_solar_kwh=season_solar_kwh,
        field_vigor_multiplier=field_vigor_mult,
    )
