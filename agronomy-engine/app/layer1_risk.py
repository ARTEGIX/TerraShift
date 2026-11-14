"""Layer 1 — Environmental & Regional Vulnerability Engine.

Core model: a **seasonal-trend regression with AR(1) errors** fitted per climate signal

    y_t = β0 + β1·t + Σ_m γ_m·D_m(t) + ε_t,      ε_t = φ·ε_{t-1} + η_t

* ``β1``  — long-term trend (reported per year)
* ``γ_m`` — month-of-year seasonal effects (11 dummies, January = baseline)
* ``φ``   — lag-1 autocorrelation of residuals, used to carry recent anomalies forward

Fitted by OLS with numpy. The fitted models forecast the next ``FORECAST_HORIZON``
months, from which we derive:

1. Soil-moisture deficit trend   (water balance = precip − ET)
2. Bare-field erosion windows    (forecast rainfall × soil erodibility × crop calendar)
3. Heat-stress risk              (forecast T-max vs crop heat tolerance)
4. Regional saturation           (simulated neighbour farms → oversupply / monoculture pest risk)

Owner: Layer-1 / risk modelling. Keep the public signature of ``assess_risk`` stable —
``main.py`` and ``layer2_rot.py`` depend on it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.crops import get_crop, load_crops
from app.schemas import (
    ClimateData,
    ErosionWindow,
    ForecastPoint,
    HeatStress,
    ModelDiagnostics,
    RegionalSaturation,
    RiskReport,
    SoilMoistureDeficit,
)

FORECAST_HORIZON = 30  # months — enough to cover 3 six-month seasons from any planting month
RISK_WINDOW = 12       # months of forecast used for the headline risk scores

SOIL_ERODIBILITY = {"clay": 0.8, "loam": 1.0, "sandy": 1.2, "silt": 1.3, "laterite": 1.1}

# Indicative regional land-use mix (Sri Lanka dry/intermediate zone) used as the Dirichlet prior
REGIONAL_PRIOR = {
    "paddy_rice": 0.38, "maize": 0.12, "onion": 0.07, "chilli": 0.07, "groundnut": 0.06,
    "cassava": 0.06, "mung_bean": 0.05, "cowpea": 0.05, "finger_millet": 0.05,
    "sesame": 0.04, "sunn_hemp": 0.03, "chickpea": 0.02,
}
OVERSUPPLY_SHARE = 0.30
MONOCULTURE_FAMILY_SHARE = 0.50


# =========================================================== time-series model
@dataclass
class SeasonalTrendModel:
    """OLS trend + month-of-year dummies, with AR(1) residual correction."""

    beta: np.ndarray = field(default_factory=lambda: np.zeros(13))
    phi: float = 0.0
    sigma: float = 0.0
    r2: float = 0.0
    n_obs: int = 0
    last_resid: float = 0.0
    last_t: int = 0
    last_period: pd.Period | None = None

    @staticmethod
    def _design(t: np.ndarray, months: np.ndarray) -> np.ndarray:
        X = np.zeros((t.size, 13))
        X[:, 0] = 1.0
        X[:, 1] = t
        for m in range(2, 13):  # January is the baseline month
            X[:, m] = (months == m).astype(float)
        return X

    def fit(self, series: pd.Series) -> "SeasonalTrendModel":
        """``series`` must have a monthly ``PeriodIndex``."""
        y = series.to_numpy(dtype=float)
        t = np.arange(y.size, dtype=float)
        months = series.index.month.to_numpy()
        X = self._design(t, months)
        self.beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        resid = y - X @ self.beta

        ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
        self.r2 = max(0.0, 1.0 - float(np.sum(resid**2)) / ss_tot)
        if resid.size > 2 and np.std(resid[:-1]) > 1e-9:
            self.phi = float(np.clip(np.corrcoef(resid[:-1], resid[1:])[0, 1], -0.95, 0.95))
        innovations = resid[1:] - self.phi * resid[:-1] if resid.size > 1 else resid
        self.sigma = float(np.std(innovations, ddof=1)) if innovations.size > 1 else 0.0
        self.n_obs = int(y.size)
        self.last_resid = float(resid[-1])
        self.last_t = int(t[-1])
        self.last_period = series.index[-1]
        return self

    @property
    def slope_per_year(self) -> float:
        return float(self.beta[1] * 12)

    def forecast(self, horizon: int) -> pd.DataFrame:
        assert self.last_period is not None, "fit() first"
        periods = pd.period_range(self.last_period + 1, periods=horizon, freq="M")
        h = np.arange(1, horizon + 1)
        X = self._design(self.last_t + h.astype(float), periods.month.to_numpy())
        mean = X @ self.beta + (self.phi**h) * self.last_resid
        if abs(self.phi) < 1:
            spread = self.sigma * np.sqrt((1 - self.phi ** (2 * h)) / (1 - self.phi**2))
        else:
            spread = self.sigma * np.sqrt(h)
        return pd.DataFrame(
            {"mean": mean, "lower": mean - 1.96 * spread, "upper": mean + 1.96 * spread},
            index=periods,
        )

    def diagnostics(self) -> ModelDiagnostics:
        return ModelDiagnostics(
            method="OLS seasonal-trend regression + AR(1) residuals",
            slope_per_year=round(self.slope_per_year, 3),
            r2=round(self.r2, 3),
            residual_std=round(self.sigma, 3),
            n_obs=self.n_obs,
        )


# =========================================================== context for Layer 2
@dataclass
class Layer1Context:
    """Forecast arrays handed to the rotation optimizer."""

    periods: pd.PeriodIndex
    precip_mm: np.ndarray
    et_mm: np.ndarray
    t2m_max_c: np.ndarray
    crop_shares: dict[str, float]


# =========================================================== helpers
def climate_frame(climate: ClimateData) -> pd.DataFrame:
    df = pd.DataFrame([m.model_dump() for m in climate.monthly])
    df.index = pd.PeriodIndex(df.pop("month"), freq="M")
    df["water_balance_mm"] = df["precip_mm"] - df["evapotranspiration_mm"]
    return df.sort_index()


def _stable_seed(lat: float, lon: float, salt: int = 0) -> int:
    return (int(round((lat + 90) * 100)) * 73_856_093 ^ int(round((lon + 180) * 100)) * 19_349_663 ^ salt) % (2**32)


def occupied_months(planting_month: int, growth_days: int, cycles_per_year: int = 2) -> set[int]:
    """Calendar months (1-12) with a standing crop, assuming the crop is re-sown every 12/cycles months."""
    months: set[int] = set()
    span = max(1, math.ceil(growth_days / 30))
    for c in range(cycles_per_year):
        start = (planting_month - 1 + c * (12 // cycles_per_year)) % 12
        for k in range(min(span, 12)):
            months.add((start + k) % 12 + 1)
    return months


def _clip100(x: float) -> float:
    return float(round(min(100.0, max(0.0, x)), 1))


# =========================================================== sub-assessments
def _soil_moisture(df: pd.DataFrame) -> tuple[SoilMoistureDeficit, SeasonalTrendModel]:
    model = SeasonalTrendModel().fit(df["water_balance_mm"])
    fc = model.forecast(FORECAST_HORIZON)
    window = fc["mean"].iloc[:RISK_WINDOW]
    deficits = window[window < 0]
    cumulative = float(-deficits.sum())

    slope = model.slope_per_year  # mm/month change per year
    trend = "worsening" if slope < -2 else "improving" if slope > 2 else "stable"

    score = 70 * min(1.0, cumulative / 600) + 30 * min(1.0, max(0.0, -slope) / 15)
    return (
        SoilMoistureDeficit(
            score=_clip100(score),
            trend=trend,
            cumulative_deficit_mm_12m=round(cumulative, 1),
            deficit_months_12m=int(deficits.size),
            forecast=[
                ForecastPoint(month=str(p), value=round(r["mean"], 1), lower=round(r["lower"], 1), upper=round(r["upper"], 1))
                for p, r in fc.iloc[:RISK_WINDOW].iterrows()
            ],
            model=model.diagnostics(),
        ),
        model,
    )


def _erosion(precip_fc: pd.Series, crop_id: str, soil_type: str, planting_month: int) -> list[ErosionWindow]:
    crop = get_crop(crop_id)
    covered = occupied_months(planting_month, crop["growth_days"])
    k = SOIL_ERODIBILITY.get(soil_type, 1.0)
    out: list[ErosionWindow] = []
    for period, rain in precip_fc.iloc[:RISK_WINDOW].items():
        bare = period.month not in covered
        erosive = max(0.0, float(rain)) * k
        if bare:
            level = "high" if erosive > 200 else "medium" if erosive > 100 else "low"
        else:
            level = "medium" if erosive > 350 else "low"
        out.append(ErosionWindow(month=str(period), precip_mm=round(float(rain), 1), bare_field=bare, risk_level=level))
    return out


def _heat(df: pd.DataFrame, crop_id: str) -> tuple[HeatStress, pd.Series]:
    crop = get_crop(crop_id)
    model = SeasonalTrendModel().fit(df["t2m_max_c"])
    fc = model.forecast(FORECAST_HORIZON)["mean"]
    window = fc.iloc[:RISK_WINDOW]
    threshold = float(crop.get("heat_tolerance_c", 35))
    exceed = (window - threshold).clip(lower=0)
    score = 12 * float(exceed.sum()) + 4 * int((exceed > 0).sum()) + 20 * min(1.0, max(0.0, model.slope_per_year) / 0.5)
    return (
        HeatStress(
            score=_clip100(score),
            threshold_c=threshold,
            months_over_threshold=int((exceed > 0).sum()),
            peak_t2m_max_c=round(float(window.max()), 2),
            model=model.diagnostics(),
        ),
        fc,
    )


def simulate_neighbors(lat: float, lon: float, current_crop: str) -> RegionalSaturation:
    """Deterministic pseudo-survey of nearby farms (placeholder until real land-use data is wired in)."""
    rng = np.random.default_rng(_stable_seed(lat, lon, salt=17))
    crops = load_crops()
    ids = [c for c in REGIONAL_PRIOR if c in crops]
    alpha = np.array([REGIONAL_PRIOR[c] for c in ids]) * 40
    local_mix = rng.dirichlet(alpha)
    n_farms = int(30 + rng.integers(0, 31))
    picks = rng.choice(len(ids), size=n_farms, p=local_mix)
    counts = np.bincount(picks, minlength=len(ids)).astype(float)
    counts[ids.index(current_crop)] += 1  # include the user's own farm
    shares = counts / counts.sum()
    share_map = {cid: round(float(s), 4) for cid, s in zip(ids, shares)}

    family = crops[current_crop]["family"]
    family_share = sum(s for cid, s in share_map.items() if crops[cid]["family"] == family)
    crop_share = share_map[current_crop]
    hhi = float(np.sum(shares**2))
    hhi_norm = (hhi - 1 / len(ids)) / (1 - 1 / len(ids))

    score = 100 * (0.5 * min(1.0, crop_share / 0.5) + 0.3 * min(1.0, family_share / 0.7) + 0.2 * hhi_norm)
    return RegionalSaturation(
        score=_clip100(score),
        neighbor_farms_sampled=n_farms,
        crop_share_pct=round(crop_share * 100, 1),
        family_share_pct=round(family_share * 100, 1),
        herfindahl_index=round(hhi, 3),
        oversupply_risk=crop_share > OVERSUPPLY_SHARE,
        monoculture_pest_risk=family_share > MONOCULTURE_FAMILY_SHARE,
        crop_shares=share_map,
    )


# =========================================================== public entry point
def assess_risk(
    climate: ClimateData,
    current_crop: str,
    soil_type: str,
    planting_month: int = 10,
) -> tuple[RiskReport, Layer1Context]:
    df = climate_frame(climate)

    moisture, _ = _soil_moisture(df)
    precip_model = SeasonalTrendModel().fit(df["precip_mm"])
    et_model = SeasonalTrendModel().fit(df["evapotranspiration_mm"])
    precip_fc = precip_model.forecast(FORECAST_HORIZON)["mean"].clip(lower=0)
    et_fc = et_model.forecast(FORECAST_HORIZON)["mean"].clip(lower=0)

    erosion = _erosion(precip_fc, current_crop, soil_type, planting_month)
    heat, tmax_fc = _heat(df, current_crop)
    saturation = simulate_neighbors(climate.lat, climate.lon, current_crop)

    erosion_score = 100 * sum({"low": 0, "medium": 0.5, "high": 1}[w.risk_level] for w in erosion) / max(1, len(erosion))
    overall = 0.35 * moisture.score + 0.20 * erosion_score + 0.25 * heat.score + 0.20 * saturation.score

    report = RiskReport(
        overall_score=_clip100(overall),
        soil_moisture_deficit=moisture,
        erosion_windows=erosion,
        heat_stress=heat,
        regional_saturation=saturation,
    )
    ctx = Layer1Context(
        periods=precip_fc.index,
        precip_mm=precip_fc.to_numpy(),
        et_mm=et_fc.to_numpy(),
        t2m_max_c=tmax_fc.to_numpy(),
        crop_shares=saturation.crop_shares,
    )
    return report, ctx
