"""Layer 2: In-Memory Multi-Objective Evolutionary Algorithm (`layer2_evolution.py`).

Implements a fast vectorized Genetic Algorithm in pure NumPy (`pop_size=50`, `n_gen=30`)
where each chromosome is `[season1_crop_idx, season2_crop_idx, season3_crop_idx]`.

All fitness calculations execute in-memory against `lookup_store.crop_matrix`
(`shape=(N_crops, 6)`, `dtype=np.float64`) and Layer 1's regressed constraints across
3 objectives:
  • F_soil  : Soil Health (cumulative nitrogen balance + erosion cover protection +
              pest-family rotation break bonus)
  • F_water : Water Resilience (water demand vs. Layer 1 projected seasonal water budget +
              drought tolerance)
  • F_cost  : Farm Economics (market revenue minus input cost, biological nitrogen
              fertilizer savings carried to subsequent crops, and neighbor-farm
              oversupply penalties)

Outputs 3 distinct strategies:
  1. `A_BASELINE`                — Current practice repeated across 3 seasons
  2. `B_SOIL_WATER_RESILIENCE`   — Evolved for soil regeneration & drought resilience
  3. `C_COST_MARKET_OPTIMIZED`   — Evolved for net margin, N-fixation savings & market diversity
"""
from __future__ import annotations

from typing import Any

import numpy as np

from app.config import get_settings
from app.layer1_regression import Layer1RegressionOutput
from app.memory_store import (
    COL_DROUGHT_TOL,
    COL_EROSION_COVER,
    COL_INPUT_COST,
    COL_MARKET_REVENUE,
    COL_NITROGEN_IMPACT,
    COL_WATER_DEMAND,
    InMemoryLookupStore,
    lookup_store,
)

N_SEASONS = 3
UREA_N_COST_USD_PER_KG = 1.35
LEGUME_N_CARRYOVER = 0.65


def evaluate_population_vectorized(
    pop: np.ndarray,
    layer1: Layer1RegressionOutput,
    store: InMemoryLookupStore = lookup_store,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized multi-objective evaluation of `pop` (`shape=(P, 3)`) in pure NumPy.

    Returns `(F_soil, F_water, F_cost)` each of shape `(P,)` normalized to roughly `[0, 1]`.
    """
    mat = store.crop_matrix  # (N_crops, 6)
    fam = store.pest_family_ids  # (N_crops,)
    cat = store.category_ids  # (N_crops,) 0=cash, 1=legume, 2=cover, 3=drought_tolerant

    # Gather (P, 3) matrices for each agronomic attribute via single NumPy fancy-index pass
    water_demand = mat[pop, COL_WATER_DEMAND]        # (P, 3)
    drought_tol = mat[pop, COL_DROUGHT_TOL]          # (P, 3)
    n_impact = mat[pop, COL_NITROGEN_IMPACT]         # (P, 3)
    erosion_c = mat[pop, COL_EROSION_COVER]          # (P, 3) lower = better cover
    input_cost = mat[pop, COL_INPUT_COST]            # (P, 3)
    base_rev = mat[pop, COL_MARKET_REVENUE]          # (P, 3)
    pop_fam = fam[pop]                               # (P, 3)
    pop_cat = cat[pop]                               # (P, 3)
    oversupply_pen = layer1.oversupply_penalty_vector[pop]  # (P, 3)

    # ------------------------------------------------------------------
    # 1. F_soil: Nitrogen balance + erosion cover + pest-family diversity
    # ------------------------------------------------------------------
    leaching = float(layer1.soil_profile["leaching_factor"])
    effective_n = np.where(n_impact > 0, n_impact, n_impact * (1.0 + 0.35 * leaching))
    total_n_balance = np.sum(effective_n, axis=1)  # (P,)
    n_score = np.clip((total_n_balance + 180.0) / 360.0, 0.0, 1.0)

    # Erosion protection: 1 - C_factor weighted by soil K-factor
    k_factor = float(layer1.soil_profile["erosion_k_factor"])
    cover_score = np.mean(1.0 - erosion_c * (0.85 + k_factor), axis=1)  # (P,)

    # Pest rotation bonus: penalize consecutive identical pest families and dominant regional pest family
    same_12 = (pop_fam[:, 0] == pop_fam[:, 1]).astype(np.float64)
    same_23 = (pop_fam[:, 1] == pop_fam[:, 2]).astype(np.float64)
    same_13 = (pop_fam[:, 0] == pop_fam[:, 2]).astype(np.float64)
    dom_hits = np.mean((pop_fam == layer1.dominant_pest_family_code).astype(np.float64), axis=1)
    rotation_bonus = np.clip(1.0 - 0.38 * (same_12 + same_23) - 0.12 * same_13 - 0.18 * dom_hits, 0.0, 1.0)

    # Penalize >1 pure cover crop (farmers need harvestable income in at least 2 of 3 seasons)
    cover_crop_count = np.sum(pop_cat == 2, axis=1)
    cover_overuse_pen = np.maximum(0.0, cover_crop_count - 1.0) * 0.28

    # SoilGrids pH buffering: acidic (<5.5) or alkaline (>7.8) soils reward legumes/cover crops
    soil_ph = layer1.soil_profile.get("ph")
    ph_buffer_bonus = np.zeros_like(n_score)
    ph_yield_mult = 1.0
    if soil_ph is not None:
        ph_val = float(soil_ph)
        if ph_val < 5.5 or ph_val > 7.8:
            legume_or_cover = np.sum((pop_cat == 1) | (pop_cat == 2), axis=1)
            ph_buffer_bonus = np.minimum(0.08, legume_or_cover * 0.03)
        if ph_val < 5.0 or ph_val > 8.2:
            ph_yield_mult = 0.94

    f_soil = np.clip(0.42 * n_score + 0.28 * cover_score + 0.30 * rotation_bonus + ph_buffer_bonus - cover_overuse_pen, 0.0, 1.0)

    # ------------------------------------------------------------------
    # 2. F_water: Seasonal water budget compliance + drought tolerance
    # ------------------------------------------------------------------
    budgets = layer1.season_water_budgets_mm[None, :]  # (1, 3)
    deficit_mm = np.maximum(0.0, water_demand - budgets)  # (P, 3)
    rel_deficit = deficit_mm / np.maximum(1.0, water_demand)
    budget_score = 1.0 - np.mean(np.clip(rel_deficit, 0.0, 1.0), axis=1)
    tol_score = np.mean(drought_tol, axis=1)
    f_water = np.clip(0.62 * budget_score + 0.38 * tol_score - cover_overuse_pen * 0.5, 0.0, 1.0)

    # ------------------------------------------------------------------
    # 3. F_cost: Net margin + biological N fertilizer credit - oversupply
    # ------------------------------------------------------------------
    # Yield factor depends on water adequacy, drought tolerance, and pest rotation break
    water_yield_mult = np.clip(1.0 - rel_deficit * (1.0 - 0.65 * drought_tol), 0.35, 1.05)
    pest_yield_mult = np.ones_like(water_yield_mult)
    pest_yield_mult[:, 1] *= np.where(same_12 > 0, 0.88, 1.03)
    pest_yield_mult[:, 2] *= np.where(same_23 > 0, 0.85, 1.04)

    adj_revenue = base_rev * water_yield_mult * pest_yield_mult * ph_yield_mult * (1.0 - oversupply_pen)

    # Biological N credit carried from season t to season t+1 reduces synthetic urea cost
    n_credit_s2 = np.maximum(0.0, n_impact[:, 0]) * LEGUME_N_CARRYOVER
    n_credit_s3 = np.maximum(0.0, n_impact[:, 1]) * LEGUME_N_CARRYOVER
    n_need = np.maximum(0.0, -n_impact)  # (P, 3)

    synth_n_s1 = n_need[:, 0]
    synth_n_s2 = np.maximum(0.0, n_need[:, 1] - n_credit_s2) * (1.08 if True else 1.0)
    synth_n_s3 = np.maximum(0.0, n_need[:, 2] - n_credit_s3) * 1.166

    fert_cost = (synth_n_s1 + synth_n_s2 + synth_n_s3) * UREA_N_COST_USD_PER_KG
    total_cost = np.sum(input_cost, axis=1) + fert_cost
    total_rev = np.sum(adj_revenue, axis=1)
    net_margin = total_rev - total_cost

    # Normalize net margin into roughly [0, 1] across typical 3-season smallholder ranges (-$200 .. $3,200/ha)
    f_cost = np.clip((net_margin + 200.0) / 3400.0 - 0.15 * (same_12 + same_23) - cover_overuse_pen, 0.0, 1.0)

    return f_soil, f_water, f_cost


def _evolve_strategy(
    weights: tuple[float, float, float],
    layer1: Layer1RegressionOutput,
    require_legume_or_cover: bool,
    forbid_sequences: set[tuple[int, int, int]],
    seed: int,
    pop_size: int = 50,
    n_gen: int = 30,
    store: InMemoryLookupStore = lookup_store,
) -> tuple[tuple[int, int, int], float]:
    """Run vectorized GA (`pop_size=50`, `n_gen=30`) in pure NumPy and return best chromosome."""
    rng = np.random.default_rng(seed)
    n_crops = len(store.crop_ids)
    w_soil, w_water, w_cost = weights
    cat = store.category_ids

    pop = rng.integers(0, n_crops, size=(pop_size, N_SEASONS), dtype=np.int32)

    for _ in range(n_gen):
        f_soil, f_water, f_cost = evaluate_population_vectorized(pop, layer1, store)
        fitness = w_soil * f_soil + w_water * f_water + w_cost * f_cost

        if require_legume_or_cover:
            has_fixer = np.any((cat[pop] == 1) | (cat[pop] == 2), axis=1)
            fitness = np.where(has_fixer, fitness, fitness - 0.45)

        # Elitism: keep top 4 chromosomes
        elite_idx = np.argsort(-fitness)[:4]
        elites = pop[elite_idx].copy()

        # Vectorized tournament selection (k=3) for remaining (pop_size - 4) offspring
        n_offspring = pop_size - 4
        t1 = rng.integers(0, pop_size, size=(n_offspring, 3))
        t2 = rng.integers(0, pop_size, size=(n_offspring, 3))
        p1 = pop[t1[np.arange(n_offspring), np.argmax(fitness[t1], axis=1)]]
        p2 = pop[t2[np.arange(n_offspring), np.argmax(fitness[t2], axis=1)]]

        # One-point crossover across all offspring simultaneously
        cut = rng.integers(1, N_SEASONS, size=(n_offspring, 1))
        gene_pos = np.arange(N_SEASONS)[None, :]
        children = np.where(gene_pos < cut, p1, p2)

        # Per-gene mutation (18% rate)
        mut_mask = rng.random((n_offspring, N_SEASONS)) < 0.18
        random_genes = rng.integers(0, n_crops, size=(n_offspring, N_SEASONS), dtype=np.int32)
        children = np.where(mut_mask, random_genes, children)

        pop = np.vstack([elites, children])

    # Final evaluation & pick best distinct sequence
    f_soil, f_water, f_cost = evaluate_population_vectorized(pop, layer1, store)
    fitness = w_soil * f_soil + w_water * f_water + w_cost * f_cost
    if require_legume_or_cover:
        has_fixer = np.any((cat[pop] == 1) | (cat[pop] == 2), axis=1)
        fitness = np.where(has_fixer, fitness, fitness - 0.45)

    for idx in np.argsort(-fitness):
        seq = (int(pop[idx, 0]), int(pop[idx, 1]), int(pop[idx, 2]))
        if seq not in forbid_sequences:
            return seq, float(fitness[idx])

    top = int(np.argmax(fitness))
    return (int(pop[top, 0]), int(pop[top, 1]), int(pop[top, 2])), float(fitness[top])


def _build_strategy_payload(
    strategy_id: str,
    name: str,
    description: str,
    seq: tuple[int, int, int],
    layer1: Layer1RegressionOutput,
    store: InMemoryLookupStore = lookup_store,
) -> dict[str, Any]:
    """Simulate a single 3-season chromosome in detail for API & frontend presentation."""
    arr = np.asarray([list(seq)], dtype=np.int32)
    f_soil_arr, f_water_arr, f_cost_arr = evaluate_population_vectorized(arr, layer1, store)
    f_soil, f_water, f_cost = float(f_soil_arr[0]), float(f_water_arr[0]), float(f_cost_arr[0])

    seasons_out: list[dict[str, Any]] = []
    warnings: list[str] = []

    som_pct = 2.10 if layer1.soil_profile["_id"] == "soil_clay_loam" else 1.45
    som_start = som_pct
    cum_n = 0.0
    n_carry = 0.0
    total_water = 0.0
    total_deficit = 0.0
    total_cost = 0.0
    total_rev = 0.0
    prev_family: str | None = None

    for s_idx, crop_idx in enumerate(seq):
        cid = store.crop_ids[crop_idx]
        crop = store.crops_by_id[cid]
        budget_mm = float(layer1.season_water_budgets_mm[s_idx])
        demand_mm = float(crop["water_demand_mm"])
        drought_tol = float(crop["drought_tolerance"])
        deficit_mm = max(0.0, demand_mm - budget_mm)
        rel_def = deficit_mm / max(1.0, demand_mm)

        fam = str(crop["pest_family"])
        same_family = prev_family == fam
        if same_family:
            warnings.append(f"Season {s_idx + 1}: consecutive {fam} crop increases pest & disease pressure.")

        n_imp = float(crop["nitrogen_impact_kg_ha"])
        cum_n += n_imp
        if n_imp < 0:
            need_n = -n_imp * (1.10 if same_family else 1.0)
            used_credit = min(n_carry, need_n)
            n_carry -= used_credit
            fert_n = need_n - used_credit
        else:
            fert_n = 0.0
            n_carry += n_imp * LEGUME_N_CARRYOVER

        fert_cost = fert_n * UREA_N_COST_USD_PER_KG * ((1.08) ** s_idx)
        base_cost = float(crop["input_cost_usd_ha"]) + fert_cost

        water_mult = float(np.clip(1.0 - rel_def * (1.0 - 0.65 * drought_tol), 0.35, 1.05))
        pest_mult = 0.86 if same_family else 1.03
        yield_factor = round(water_mult * pest_mult, 3)

        oversupply_disc = float(layer1.oversupply_penalty_vector[crop_idx])
        if oversupply_disc > 0:
            warnings.append(f"{crop['name']} is flagged as regionally oversupplied (-{int(oversupply_disc * 100)}% price risk).")

        rev = float(crop["market_revenue_usd_ha"]) * yield_factor * (1.0 - oversupply_disc)
        margin = rev - base_cost

        som_delta_step = (0.14 if crop["category"] == "cover_crop" else 0.06 if crop["category"] == "legume" else -0.05) - (
            0.03 if same_family else 0.0
        )
        som_pct = max(0.4, som_pct + som_delta_step)

        seasons_out.append(
            {
                "season": s_idx + 1,
                "season_label": layer1.season_labels[s_idx],
                "crop_id": cid,
                "crop_name": crop["name"],
                "category": crop["category"],
                "pest_family": fam,
                "metrics": {
                    "water_use_mm": round(demand_mm, 1),
                    "water_budget_mm": round(budget_mm, 1),
                    "water_deficit_mm": round(deficit_mm, 1),
                    "nitrogen_balance_kg_ha": round(cum_n, 1),
                    "fertilizer_n_kg_ha": round(fert_n, 1),
                    "som_pct": round(som_pct, 3),
                    "input_cost_usd_ha": round(base_cost, 2),
                    "revenue_usd_ha": round(rev, 2),
                    "net_margin_usd_ha": round(margin, 2),
                    "yield_factor": yield_factor,
                },
            }
        )

        total_water += demand_mm
        total_deficit += deficit_mm
        total_cost += base_cost
        total_rev += rev
        prev_family = fam

    if strategy_id == "A_BASELINE":
        warnings.insert(0, "Continuous monocropping depletes soil nitrogen and raises synthetic fertilizer spend each season.")

    resilience_score = float(np.clip((0.55 * f_soil + 0.45 * f_water) * 100.0, 0.0, 100.0))
    overall_fitness = round(float(0.35 * f_soil + 0.35 * f_water + 0.30 * f_cost), 4)

    return {
        "id": strategy_id,
        "short_id": strategy_id[0],  # "A" | "B" | "C" for UI badge compatibility
        "name": name,
        "description": description,
        "seasons": seasons_out,
        "objectives": {
            "f_soil": round(f_soil, 4),
            "f_water": round(f_water, 4),
            "f_cost": round(f_cost, 4),
        },
        "totals": {
            "water_use_mm": round(total_water, 1),
            "water_deficit_mm": round(total_deficit, 1),
            "nitrogen_balance_kg_ha": round(cum_n, 1),
            "som_delta_pct": round(som_pct - som_start, 3),
            "input_cost_usd_ha": round(total_cost, 2),
            "revenue_usd_ha": round(total_rev, 2),
            "net_margin_usd_ha": round(total_rev - total_cost, 2),
            "resilience_score": round(resilience_score, 1),
            "fitness": overall_fitness,
        },
        "warnings": list(dict.fromkeys(warnings)),
    }


def run_layer2_evolution(
    current_crop_id: str,
    priority: str,
    layer1: Layer1RegressionOutput,
    store: InMemoryLookupStore = lookup_store,
) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    """Execute the vectorized NumPy GA and return the 3 required strategies + recommendation."""
    settings = get_settings()
    pop_size = int(settings.ga_population or 50)
    n_gen = int(settings.ga_generations or 30)

    curr_idx = store.crop_index.get(current_crop_id, 0)
    seq_a = (curr_idx, curr_idx, curr_idx)

    # Priority nudges the evolutionary objective weights
    prio_boost = {
        "soil": (0.12, 0.0, 0.0),
        "water": (0.0, 0.12, 0.0),
        "cost": (0.0, 0.0, 0.12),
    }.get(priority, (0.0, 0.0, 0.0))

    weights_b = (0.50 + prio_boost[0], 0.40 + prio_boost[1], 0.10 + prio_boost[2])
    weights_c = (0.20 + prio_boost[0], 0.15 + prio_boost[1], 0.65 + prio_boost[2])

    base_seed = (int(settings.ga_seed) * 1_000_003 + sum(map(ord, current_crop_id + priority))) % (2**31)

    seq_b, _ = _evolve_strategy(
        weights=weights_b,
        layer1=layer1,
        require_legume_or_cover=True,
        forbid_sequences={seq_a},
        seed=base_seed + 11,
        pop_size=pop_size,
        n_gen=n_gen,
        store=store,
    )

    seq_c, _ = _evolve_strategy(
        weights=weights_c,
        layer1=layer1,
        require_legume_or_cover=False,
        forbid_sequences={seq_a, seq_b},
        seed=base_seed + 29,
        pop_size=pop_size,
        n_gen=n_gen,
        store=store,
    )

    strat_a = _build_strategy_payload(
        "A_BASELINE",
        "Strategy A: Baseline (Current Practice)",
        "Continues your current crop across all 3 seasons with conventional synthetic inputs.",
        seq_a,
        layer1,
        store,
    )
    strat_b = _build_strategy_payload(
        "B_SOIL_WATER_RESILIENCE",
        "Strategy B: Soil & Water Resilience",
        "Maximizes biological nitrogen fixation, erosion cover, pest family breaks, and drought tolerance.",
        seq_b,
        layer1,
        store,
    )
    strat_c = _build_strategy_payload(
        "C_COST_MARKET_OPTIMIZED",
        "Strategy C: Cost & Market Optimized",
        "Balances biological nitrogen fertilizer savings with high-margin crops that avoid regional oversupply.",
        seq_c,
        layer1,
        store,
    )

    strategies = [strat_a, strat_b, strat_c]
    recommended = "C_COST_MARKET_OPTIMIZED" if priority == "cost" else "B_SOIL_WATER_RESILIENCE"

    optimizer_meta = {
        "method": "Vectorized NumPy Multi-Objective Genetic Algorithm (in-memory crop_matrix)",
        "population": pop_size,
        "generations": n_gen,
        "seed": base_seed,
        "lookup_source": store.source,
    }
    return strategies, recommended, optimizer_meta
