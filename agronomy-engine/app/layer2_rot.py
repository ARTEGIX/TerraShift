"""Layer 2 — Multi-Season Rotation Optimizer (Genetic Algorithm).

Chromosome = 3 genes, one crop per season (Maha / Yala / Maha …).
A deterministic agronomic simulator scores each chromosome season-by-season, carrying
soil state forward (residual nitrogen pool, soil organic matter, pest pressure from
repeated botanical families) and using Layer 1's climate forecasts for water and heat.

Strategies
----------
A  Baseline                  — current crop × 3 (no optimisation) → shows degradation & rising N cost
B  Soil & Water Resilience   — GA with weights on SOM, N-fixation, low water deficit, drought tolerance
C  Cost & Market Optimized   — GA with weights on net margin, biological N savings, oversupply avoidance

The user's ``priority`` (cost | water | soil) up-weights the matching objective in all GA runs
and decides the recommended strategy.

Owner: Layer-2 / rotation. Keep ``optimize_rotations`` signature stable.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from app.config import get_settings
from app.crops import get_crop, load_crops
from app.layer1_risk import Layer1Context
from app.schemas import OptimizerInfo, SeasonMetrics, SeasonPlan, Strategy, StrategyTotals

N_SEASONS = 3
SEASON_MONTHS = 6
EFFECTIVE_RAIN = 0.70          # fraction of rainfall usable by the crop
IRRIGABLE_FRACTION = 0.60      # share of a water deficit a typical smallholder can irrigate
IRRIGATION_COST_PER_MM = 0.12  # USD / mm / ha (pumping, canal fees)
N_PRICE_USD_PER_KG = 1.30      # urea-N, USD per kg N
FERTILIZER_INFLATION = 0.08    # per season
LEGUME_RESIDUAL_CREDIT = 0.70  # share of fixed N available to the next crop

INITIAL_SOM_PCT = {"clay": 2.4, "loam": 2.0, "sandy": 0.9, "silt": 1.8, "laterite": 1.2}

# Soil suitability multipliers on yield (default 1.0)
SOIL_SUITABILITY: dict[str, dict[str, float]] = {
    "clay": {"paddy_rice": 1.10, "groundnut": 0.75, "cassava": 0.80, "onion": 0.85, "sesame": 0.85},
    "sandy": {"paddy_rice": 0.70, "groundnut": 1.10, "sesame": 1.05, "cassava": 1.05, "cowpea": 1.05, "onion": 0.95},
    "silt": {"paddy_rice": 1.05, "onion": 1.05, "chilli": 1.05},
    "laterite": {"paddy_rice": 0.85, "cassava": 1.05, "finger_millet": 1.05, "cowpea": 1.0, "chilli": 0.9},
    "loam": {},
}

STRATEGY_META = {
    "A": ("Baseline", "Continue the current crop every season with conventional inputs."),
    "B": ("Soil & Water Resilience", "Rebuild organic matter, fix nitrogen biologically and cut irrigation demand."),
    "C": ("Cost & Market Optimized", "Maximise net margin using biological N savings while avoiding crops the region already oversupplies."),
}

# Objective weights per strategy: margin, water, soil, resilience, market
BASE_WEIGHTS = {
    "B": {"margin": 0.25, "water": 0.30, "soil": 0.30, "resilience": 0.15, "market": 0.00},
    "C": {"margin": 0.55, "water": 0.10, "soil": 0.15, "resilience": 0.10, "market": 0.10},
    "REC": {"margin": 0.34, "water": 0.33, "soil": 0.33, "resilience": 0.00, "market": 0.00},
}
PRIORITY_TO_OBJECTIVE = {"cost": "margin", "water": "water", "soil": "soil"}


# ====================================================================== simulator
@dataclass
class SimResult:
    seasons: list[SeasonPlan] = field(default_factory=list)
    totals: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    avg_market_share: float = 0.0


def season_windows(ctx: Layer1Context, planting_month: int) -> list[tuple[int, int, str]]:
    months = ctx.periods.month.to_numpy()
    start = int(np.argmax(months == planting_month))
    out = []
    for k in range(N_SEASONS):
        s = start + k * SEASON_MONTHS
        p = ctx.periods[min(s, len(ctx.periods) - 1)]
        label = "Maha" if p.month in (9, 10, 11, 12, 1, 2) else "Yala"
        out.append((s, s + SEASON_MONTHS, f"{label} {p.year}"))
    return out


def simulate(sequence: list[str], ctx: Layer1Context, soil_type: str, planting_month: int) -> SimResult:
    res = SimResult()
    windows = season_windows(ctx, planting_month)
    som0 = INITIAL_SOM_PCT.get(soil_type, 1.8)
    som = som0
    n_pool = 0.0           # residual plant-available N carried between seasons (kg/ha)
    n_balance = 0.0        # cumulative biological N balance (kg/ha)
    prev_family, prev_crop = None, None
    family_run, crop_run = 0, 0
    totals = dict(water_use_mm=0.0, water_deficit_mm=0.0, input_cost_usd_ha=0.0, revenue_usd_ha=0.0, fert=0.0)
    drought_tol, families, shares = [], set(), []
    need_total = 0.0

    for k, crop_id in enumerate(sequence):
        crop = get_crop(crop_id)
        s, e, label = windows[k]
        prorate = min(1.0, 180 / crop["growth_days"])
        grow_months = min(SEASON_MONTHS, max(1, math.ceil(crop["growth_days"] / 30)))

        rain = float(ctx.precip_mm[s:e].sum())
        tmax = ctx.t2m_max_c[s : s + grow_months]
        heat_excess = float(np.clip(tmax - crop["heat_tolerance_c"], 0, None).sum())

        # --- water
        need = crop["water_demand_mm"] * prorate * (1 + 0.03 * max(0.0, float(tmax.mean()) - 32))
        deficit = max(0.0, need - EFFECTIVE_RAIN * rain)
        irrigated = IRRIGABLE_FRACTION * deficit
        unmet = deficit - irrigated
        water_use = min(need, EFFECTIVE_RAIN * rain) + irrigated
        water_factor = 1 - (1 - crop["drought_tolerance"]) * 0.6 * (unmet / need if need else 0)

        # --- pests / repetition
        family_run = family_run + 1 if crop["family"] == prev_family else 0
        crop_run = crop_run + 1 if crop_id == prev_crop else 0
        pest_factor = 0.88**family_run

        # --- nitrogen
        impact = crop["nitrogen_impact_kg_ha"] * prorate
        n_balance += impact
        fert = 0.0
        if impact < 0:
            demand = -impact * (1 + 0.10 * crop_run)       # mineralisation declines under monoculture
            from_pool = min(n_pool, demand)
            n_pool -= from_pool
            fert = demand - from_pool
        else:
            n_pool += impact * LEGUME_RESIDUAL_CREDIT
        fert_cost = fert * N_PRICE_USD_PER_KG * (1 + FERTILIZER_INFLATION) ** k

        # --- soil organic matter
        cat = crop["category"]
        d_som = {"cover_crop": 0.15, "legume": 0.06, "drought_tolerant": 0.02 if crop["root_depth_cm"] >= 100 else 0.0, "cash_crop": -0.05}[cat]
        d_som -= 0.03 * family_run
        bare_months = max(0, SEASON_MONTHS - grow_months)
        d_som -= 0.01 * bare_months * min(1.5, rain / 600)
        som = max(0.3, som + d_som)

        # --- yield & economics
        suit = SOIL_SUITABILITY.get(soil_type, {}).get(crop_id, 1.0)
        som_factor = float(np.clip(0.85 + 0.075 * som, 0.85, 1.10))
        heat_factor = max(0.6, 1 - 0.04 * heat_excess)
        yield_factor = float(np.clip(suit * water_factor * pest_factor * som_factor * heat_factor, 0.2, 1.3))

        share = ctx.crop_shares.get(crop_id, 0.0)
        price_factor = 1 - 0.6 * max(0.0, share - 0.15)
        revenue = crop["avg_market_revenue_usd_ha"] * prorate * yield_factor * price_factor
        cost = crop["avg_input_cost_usd_ha"] * prorate + fert_cost + irrigated * IRRIGATION_COST_PER_MM

        res.seasons.append(
            SeasonPlan(
                season=k + 1,
                season_label=label,
                crop_id=crop_id,
                crop_name=crop["name"],
                category=cat,
                metrics=SeasonMetrics(
                    water_use_mm=round(water_use, 1),
                    water_deficit_mm=round(unmet, 1),
                    nitrogen_balance_kg_ha=round(n_balance, 1),
                    fertilizer_n_kg_ha=round(fert, 1),
                    som_pct=round(som, 3),
                    input_cost_usd_ha=round(cost, 2),
                    revenue_usd_ha=round(revenue, 2),
                    net_margin_usd_ha=round(revenue - cost, 2),
                    yield_factor=round(yield_factor, 3),
                ),
            )
        )
        if crop["growth_days"] > 180:
            res.warnings.append(f"{crop['name']} ({crop['growth_days']} d) spans more than one season; economics pro-rated.")
        if family_run:
            res.warnings.append(f"Season {k + 1}: repeated {crop['family']} family raises pest & disease pressure.")

        totals["water_use_mm"] += water_use
        totals["water_deficit_mm"] += unmet
        totals["input_cost_usd_ha"] += cost
        totals["revenue_usd_ha"] += revenue
        totals["fert"] += fert
        need_total += need
        drought_tol.append(crop["drought_tolerance"])
        families.add(crop["family"])
        shares.append(share)
        prev_family, prev_crop = crop["family"], crop_id

    som_delta = som - som0
    deficit_ratio = totals["water_deficit_mm"] / need_total if need_total else 0
    resilience = 100 * (
        0.25 * float(np.mean(drought_tol))
        + 0.25 * float(np.clip(som_delta / 0.3 + 0.5, 0, 1))
        + 0.20 * float(np.clip(n_balance / 150 + 0.5, 0, 1))
        + 0.15 * (len(families) / N_SEASONS)
        + 0.15 * (1 - min(1.0, deficit_ratio))
    )
    res.totals = dict(
        water_use_mm=totals["water_use_mm"],
        water_deficit_mm=totals["water_deficit_mm"],
        nitrogen_balance_kg_ha=n_balance,
        som_delta_pct=som_delta,
        input_cost_usd_ha=totals["input_cost_usd_ha"],
        revenue_usd_ha=totals["revenue_usd_ha"],
        net_margin_usd_ha=totals["revenue_usd_ha"] - totals["input_cost_usd_ha"],
        resilience_score=float(np.clip(resilience, 0, 100)),
        fertilizer_n_kg_ha=totals["fert"],
    )
    res.avg_market_share = float(np.mean(shares))
    # de-duplicate warnings, keep order
    res.warnings = list(dict.fromkeys(res.warnings))
    return res


# ====================================================================== fitness
def weights_for(kind: str, priority: str) -> dict[str, float]:
    w = dict(BASE_WEIGHTS[kind])
    obj = PRIORITY_TO_OBJECTIVE[priority]
    w[obj] *= 3.0 if kind == "REC" else 1.5
    total = sum(w.values())
    return {k: v / total for k, v in w.items()}


def objective(sim: SimResult, weights: dict[str, float]) -> float:
    t = sim.totals
    terms = {
        "margin": t["net_margin_usd_ha"] / 3000,
        "water": -(t["water_deficit_mm"] / 600 + t["water_use_mm"] / 4000),
        "soil": t["som_delta_pct"] / 0.3 + t["nitrogen_balance_kg_ha"] / 300,
        "resilience": t["resilience_score"] / 100,
        "market": -sim.avg_market_share / 0.3,
    }
    return float(sum(weights[k] * terms[k] for k in weights))


def penalties(seq: list[str], kind: str) -> float:
    crops = load_crops()
    p = 0.0
    for a, b in zip(seq, seq[1:]):
        if crops[a]["family"] == crops[b]["family"]:
            p += 0.30
    # A non-income cover crop is a great break crop, but a farmer can't afford it every other season.
    n_cover = sum(crops[c]["category"] == "cover_crop" for c in seq)
    p += 0.40 * max(0, n_cover - 1)
    if kind == "B" and not any(crops[c]["category"] in ("legume", "cover_crop") for c in seq):
        p += 1.0
    if kind == "B" and not any(crops[c]["category"] in ("legume", "cover_crop", "drought_tolerant") for c in seq[1:]):
        p += 0.3
    return p


# ====================================================================== genetic algorithm
@dataclass
class GeneticAlgorithm:
    candidates: list[str]
    fitness_fn: "callable"
    population: int = 60
    generations: int = 40
    crossover_rate: float = 0.9
    mutation_rate: float = 0.15
    elitism: int = 2
    tournament_k: int = 3
    seed: int = 42
    _memo: dict[tuple[int, ...], float] = field(default_factory=dict)

    def _fit(self, genome: np.ndarray) -> float:
        key = tuple(int(g) for g in genome)
        if key not in self._memo:
            self._memo[key] = self.fitness_fn([self.candidates[g] for g in key])
        return self._memo[key]

    def _tournament(self, pop: np.ndarray, fit: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        idx = rng.choice(len(pop), size=self.tournament_k, replace=False)
        return pop[idx[np.argmax(fit[idx])]]

    def run(self) -> list[tuple[list[str], float]]:
        rng = np.random.default_rng(self.seed)
        n_genes, n_alleles = N_SEASONS, len(self.candidates)
        pop = rng.integers(0, n_alleles, size=(self.population, n_genes))
        for _ in range(self.generations):
            fit = np.array([self._fit(g) for g in pop])
            order = np.argsort(-fit)
            nxt = [pop[i].copy() for i in order[: self.elitism]]
            while len(nxt) < self.population:
                p1, p2 = self._tournament(pop, fit, rng), self._tournament(pop, fit, rng)
                child = p1.copy()
                if rng.random() < self.crossover_rate:
                    cut = int(rng.integers(1, n_genes))
                    child[cut:] = p2[cut:]
                mutate = rng.random(n_genes) < self.mutation_rate
                child[mutate] = rng.integers(0, n_alleles, size=int(mutate.sum()))
                nxt.append(child)
            pop = np.array(nxt)
        ranked = sorted(self._memo.items(), key=lambda kv: -kv[1])
        return [([self.candidates[g] for g in genome], score) for genome, score in ranked]


# ====================================================================== public entry point
def _to_strategy(sid: str, sim: SimResult, fitness: float) -> Strategy:
    name, desc = STRATEGY_META[sid]
    t = sim.totals
    return Strategy(
        id=sid,
        name=name,
        description=desc,
        seasons=sim.seasons,
        totals=StrategyTotals(
            water_use_mm=round(t["water_use_mm"], 1),
            water_deficit_mm=round(t["water_deficit_mm"], 1),
            nitrogen_balance_kg_ha=round(t["nitrogen_balance_kg_ha"], 1),
            som_delta_pct=round(t["som_delta_pct"], 3),
            input_cost_usd_ha=round(t["input_cost_usd_ha"], 2),
            revenue_usd_ha=round(t["revenue_usd_ha"], 2),
            net_margin_usd_ha=round(t["net_margin_usd_ha"], 2),
            resilience_score=round(t["resilience_score"], 1),
            fitness=round(fitness, 4),
        ),
        warnings=sim.warnings,
    )


def optimize_rotations(
    current_crop: str,
    soil_type: str,
    priority: str,
    ctx: Layer1Context,
    planting_month: int = 10,
) -> tuple[list[Strategy], str, OptimizerInfo]:
    settings = get_settings()
    candidates = sorted(load_crops())
    sim = lambda seq: simulate(seq, ctx, soil_type, planting_month)  # noqa: E731

    # Seed mixes the global seed with the inputs → same request ⇒ same answer.
    seed = (settings.ga_seed * 1_000_003 + sum(map(ord, current_crop + soil_type + priority))) % (2**32)

    def run_ga(kind: str, salt: int) -> list[tuple[list[str], float]]:
        w = weights_for(kind, priority)
        ga = GeneticAlgorithm(
            candidates=candidates,
            fitness_fn=lambda seq: objective(sim(seq), w) - penalties(seq, kind),
            population=settings.ga_population,
            generations=settings.ga_generations,
            seed=seed + salt,
        )
        return ga.run()

    baseline_seq = [current_crop] * N_SEASONS
    rec_w = weights_for("REC", priority)

    sim_a = sim(baseline_seq)
    sim_a.warnings.insert(0, "Continuous cropping: soil N is mined each season, so fertilizer spend climbs.")

    ranked_b = run_ga("B", 1)
    seq_b, fit_b = next(((s, f) for s, f in ranked_b if s != baseline_seq), ranked_b[0])

    ranked_c = run_ga("C", 2)
    seq_c, fit_c = next(((s, f) for s, f in ranked_c if s not in (baseline_seq, seq_b)), ranked_c[0])

    sims = {"A": sim_a, "B": sim(seq_b), "C": sim(seq_c)}
    strategies = [
        _to_strategy("A", sims["A"], objective(sims["A"], rec_w)),
        _to_strategy("B", sims["B"], fit_b),
        _to_strategy("C", sims["C"], fit_c),
    ]
    rec_scores = {k: objective(v, rec_w) for k, v in sims.items()}
    recommended = max(rec_scores, key=rec_scores.get)

    info = OptimizerInfo(
        method="Genetic algorithm (tournament selection, one-point crossover, per-gene mutation, elitism)",
        population=settings.ga_population,
        generations=settings.ga_generations,
        seed=seed,
    )
    return strategies, recommended, info
