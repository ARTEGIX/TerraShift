/**
 * Gemini Explainability Wrapper (`llmExplainer.ts`).
 *
 * Converts deterministic JSON output from `agronomy-engine` (`POST /predict`)
 * into farmer-friendly plain-language guidance.
 * - Uses `@google/genai` (`gemini-2.5-flash`) when `GEMINI_API_KEY` is set.
 * - Caches explanations by SHA-256 digest in Redis.
 * - Falls back to a deterministic template if `GEMINI_API_KEY` is omitted or fails.
 */
import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../config/env";
import { cacheGet, cacheSet } from "../db/redis";
import type { Explanation, PredictResponse, StrategyId } from "../types/contract";

const ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;

const strategyIds = ["A_BASELINE", "B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"] as const;

const explanationSchema = z.object({
  summary: z.string().min(1),
  per_strategy: z
    .array(
      z.object({
        id: z.enum(strategyIds),
        headline: z.string(),
        why: z.string(),
        risks: z.array(z.string()).default([]),
        first_steps: z.array(z.string()).default([]),
      }),
    )
    .length(3),
  caveats: z.array(z.string()).default([]),
});

export function buildDigest(p: PredictResponse) {
  return {
    location: p.location,
    inputs: p.inputs,
    climate_source: p.climate.source,
    grid_key: p.climate.grid_key,
    risk: p.risk,
    strategies: p.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      rotation: s.seasons.map((x) => `${x.season_label}: ${x.crop_name}`),
      objectives: s.objectives,
      totals: s.totals,
      warnings: s.warnings,
    })),
    recommended: p.recommended_strategy,
  };
}

function buildPrompt(digest: ReturnType<typeof buildDigest>): string {
  return [
    "You are TerraShift, an AI agronomy advisor for farmers adapting to climate and market shifts using NASA data.",
    "Explain the 3-season crop rotation simulation below in clear, practical language.",
    "Use only the numbers provided; currency is USD per hectare.",
    "Strategy IDs are exact: 'A_BASELINE', 'B_SOIL_WATER_RESILIENCE', 'C_COST_MARKET_OPTIMIZED'.",
    "Return ONLY valid JSON matching:",
    "{ summary: string; per_strategy: { id: 'A_BASELINE'|'B_SOIL_WATER_RESILIENCE'|'C_COST_MARKET_OPTIMIZED'; headline: string; why: string; risks: string[]; first_steps: string[] }[]; caveats: string[] }",
    "",
    "SIMULATION_DIGEST:",
    JSON.stringify(digest),
  ].join("\n");
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function templateExplanation(p: PredictResponse): Explanation {
  const r = p.risk;
  const byId = Object.fromEntries(p.strategies.map((s) => [s.id, s])) as Record<StrategyId, PredictResponse["strategies"][number]>;
  const rec = byId[p.recommended_strategy] ?? p.strategies[1];
  const base = byId.A_BASELINE ?? p.strategies[0];

  const drivers: string[] = [];
  if (r.soil_moisture_deficit.trend === "worsening") drivers.push("declining root-zone soil moisture trend");
  if (r.bare_field_erosion.score >= 35) drivers.push(`bare-field erosion risk (${Math.round(r.bare_field_erosion.score)}/100)`);
  if (r.regional_saturation.current_crop_oversupplied) {
    drivers.push(`regional oversupply of ${String(p.inputs.current_crop)} (-${r.regional_saturation.oversupply_penalty_pct}% price penalty)`);
  }

  return {
    source: "template",
    summary:
      `Field risk score is ${Math.round(r.overall_score)}/100` +
      (drivers.length ? ` driven by ${drivers.join(", ")}.` : ".") +
      ` Recommended: ${rec.name} (${rec.seasons.map((s) => s.crop_name).join(" → ")}), delivering ${usd(rec.totals.net_margin_usd_ha)}/ha net margin and ${Math.round(rec.totals.resilience_score)}/100 resilience.`,
    per_strategy: p.strategies.map((s) => {
      const marginDiff = s.totals.net_margin_usd_ha - base.totals.net_margin_usd_ha;
      const waterDiff = s.totals.water_use_mm - base.totals.water_use_mm;
      return {
        id: s.id,
        headline: `${s.name}: ${s.seasons.map((x) => x.crop_name).join(" → ")}`,
        why:
          s.id === "A_BASELINE"
            ? `Continues current practice. 3-season net margin ${usd(s.totals.net_margin_usd_ha)}/ha, nitrogen balance ${s.totals.nitrogen_balance_kg_ha} kg/ha, SOM Δ ${s.totals.som_delta_pct.toFixed(2)}%.`
            : `Vs. baseline: ${marginDiff >= 0 ? "+" : "-"}${usd(Math.abs(marginDiff))}/ha net margin, ${waterDiff <= 0 ? "" : "+"}${Math.round(waterDiff)} mm water demand, N balance ${s.totals.nitrogen_balance_kg_ha >= 0 ? "+" : ""}${s.totals.nitrogen_balance_kg_ha} kg/ha, resilience ${Math.round(s.totals.resilience_score)}/100.`,
        risks: s.warnings.slice(0, 3),
        first_steps:
          s.id === "A_BASELINE"
            ? ["Test soil nitrogen before Maha planting", "Budget for +8%/season urea cost inflation"]
            : [
                `Secure ${s.seasons[0].crop_name} seed ahead of ${s.seasons[0].season_label}`,
                "Incorporate legume/cover-crop residue to capture biological nitrogen credit",
              ],
      };
    }),
    caveats: [
      p.climate.source === "fallback"
        ? `Harmonized 36-month NASA POWER + SMAP + NDVI fallback cube (${p.climate.grid_key}).`
        : `Harmonized 36-month NASA POWER + SMAP + NDVI satellite cube (${p.climate.grid_key}).`,
      "Market revenues and input costs are regional reference averages (FAO GAEZ / USDA AMS).",
    ],
  };
}

export async function explainSimulation(prediction: PredictResponse): Promise<Explanation> {
  const digest = buildDigest(prediction);
  const key = `explain:v2:${env.GEMINI_MODEL}:${createHash("sha256").update(JSON.stringify(digest)).digest("hex")}`;

  const cached = await cacheGet<Explanation>(key);
  if (cached) return cached;

  if (!ai) return templateExplanation(prediction);

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: buildPrompt(digest),
      config: { responseMimeType: "application/json", temperature: 0.35, maxOutputTokens: 1500 },
    });
    const parsed = explanationSchema.parse(JSON.parse(response.text ?? ""));
    const explanation: Explanation = { source: "gemini", model: env.GEMINI_MODEL, ...parsed };
    await cacheSet(key, explanation);
    return explanation;
  } catch (err) {
    console.warn("Gemini explainability fallback triggered:", (err as Error).message);
    return templateExplanation(prediction);
  }
}
