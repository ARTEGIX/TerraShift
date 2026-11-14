/**
 * Gemini explainability wrapper.
 *
 * Turns the agronomy-engine's numeric output into plain-language guidance for farmers.
 * - Sends a *compact digest* (not the raw climate series) to keep tokens/cost low.
 * - Forces JSON output and validates it with zod.
 * - Caches by content hash in Redis.
 * - Falls back to a deterministic template when no key is set or the call fails,
 *   so the product always returns an explanation.
 */
import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "../config/env";
import { cacheGet, cacheSet } from "../db/redis";
import type { Explanation, PredictResponse, StrategyId } from "../types/contract";

const ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;

const explanationSchema = z.object({
  summary: z.string().min(1),
  per_strategy: z
    .array(
      z.object({
        id: z.enum(["A", "B", "C"]),
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
  const r = p.risk;
  return {
    location: p.location,
    inputs: p.inputs,
    climate_source: p.climate.source,
    risk: {
      overall: r.overall_score,
      soil_moisture: {
        score: r.soil_moisture_deficit.score,
        trend: r.soil_moisture_deficit.trend,
        deficit_mm_next_12m: r.soil_moisture_deficit.cumulative_deficit_mm_12m,
      },
      heat: { score: r.heat_stress.score, months_over: r.heat_stress.months_over_threshold, peak_c: r.heat_stress.peak_t2m_max_c },
      erosion_high_months: r.erosion_windows.filter((w) => w.risk_level === "high").map((w) => w.month),
      regional: {
        crop_share_pct: r.regional_saturation.crop_share_pct,
        oversupply: r.regional_saturation.oversupply_risk,
        monoculture_pest: r.regional_saturation.monoculture_pest_risk,
      },
    },
    strategies: p.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      rotation: s.seasons.map((x) => `${x.season_label}: ${x.crop_name}`),
      totals: s.totals,
      warnings: s.warnings,
    })),
    recommended: p.recommended_strategy,
  };
}

function buildPrompt(digest: ReturnType<typeof buildDigest>): string {
  return [
    "You are TerraShift, an agronomy advisor for smallholder farmers in Sri Lanka and South Asia.",
    "Explain the crop-rotation analysis below in simple, encouraging language a farmer can act on.",
    "Use only the numbers provided; do not invent data. Currency is USD per hectare.",
    "Strategy A is the farmer's current practice; B prioritises soil & water resilience; C prioritises cost & market.",
    "Return ONLY JSON matching this TypeScript type:",
    "{ summary: string; per_strategy: { id: 'A'|'B'|'C'; headline: string; why: string; risks: string[]; first_steps: string[] }[]; caveats: string[] }",
    "Keep summary under 80 words, each 'why' under 60 words, max 3 risks and 3 first_steps per strategy.",
    "",
    "ANALYSIS:",
    JSON.stringify(digest),
  ].join("\n");
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function templateExplanation(p: PredictResponse): Explanation {
  const r = p.risk;
  const byId = Object.fromEntries(p.strategies.map((s) => [s.id, s])) as Record<StrategyId, PredictResponse["strategies"][number]>;
  const rec = byId[p.recommended_strategy];
  const a = byId.A;

  const risks: string[] = [];
  if (r.soil_moisture_deficit.trend === "worsening") risks.push("soil moisture is trending drier");
  if (r.heat_stress.months_over_threshold > 0) risks.push(`${r.heat_stress.months_over_threshold} hot month(s) above crop tolerance`);
  if (r.regional_saturation.oversupply_risk) risks.push(`${r.regional_saturation.crop_share_pct}% of nearby farms grow the same crop`);
  if (r.erosion_windows.some((w) => w.risk_level === "high")) risks.push("heavy rain falls while the field is bare");

  return {
    source: "template",
    summary:
      `Overall climate & market risk for this field is ${Math.round(r.overall_score)}/100` +
      (risks.length ? ` — mainly because ${risks.join(", ")}.` : ".") +
      ` We recommend Strategy ${rec.id} (${rec.name}): ${rec.seasons.map((s) => s.crop_name).join(" → ")}.`,
    per_strategy: p.strategies.map((s) => {
      const marginDiff = s.totals.net_margin_usd_ha - a.totals.net_margin_usd_ha;
      const waterDiff = s.totals.water_use_mm - a.totals.water_use_mm;
      return {
        id: s.id,
        headline: `${s.name}: ${s.seasons.map((x) => x.crop_name).join(" → ")}`,
        why:
          s.id === "A"
            ? `Keeps your current crop. Over 3 seasons: net margin ${usd(s.totals.net_margin_usd_ha)}/ha, soil organic matter change ${s.totals.som_delta_pct.toFixed(2)}%, nitrogen balance ${s.totals.nitrogen_balance_kg_ha} kg/ha.`
            : `Compared with today: ${marginDiff >= 0 ? "+" : "-"}${usd(Math.abs(marginDiff))}/ha margin, ${waterDiff <= 0 ? "" : "+"}${Math.round(waterDiff)} mm water, soil organic matter ${s.totals.som_delta_pct >= 0 ? "+" : ""}${s.totals.som_delta_pct.toFixed(2)}%, resilience ${Math.round(s.totals.resilience_score)}/100.`,
        risks: s.warnings.slice(0, 3),
        first_steps:
          s.id === "A"
            ? ["Get a soil test before next season", "Budget for rising fertilizer costs"]
            : [`Source ${s.seasons[0].crop_name} seed before ${s.seasons[0].season_label}`, "Talk to your local agrarian service centre about the rotation"],
      };
    }),
    caveats: [
      p.climate.source === "fallback"
        ? "NASA POWER data was unavailable; a modelled climate was used."
        : `Based on NASA POWER climate data ${p.climate.start_year}–${p.climate.end_year}.`,
      "Prices and yields are regional averages — confirm with local markets.",
    ],
  };
}

export async function explain(prediction: PredictResponse): Promise<Explanation> {
  const digest = buildDigest(prediction);
  const key = `explain:${env.GEMINI_MODEL}:${createHash("sha256").update(JSON.stringify(digest)).digest("hex")}`;

  const cached = await cacheGet<Explanation>(key);
  if (cached) return cached;

  if (!ai) return templateExplanation(prediction);

  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: buildPrompt(digest),
      config: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 1500 },
    });
    const parsed = explanationSchema.parse(JSON.parse(response.text ?? ""));
    const explanation: Explanation = { source: "gemini", model: env.GEMINI_MODEL, ...parsed };
    await cacheSet(key, explanation);
    return explanation;
  } catch (err) {
    console.warn("Gemini explanation failed, using template:", (err as Error).message);
    return templateExplanation(prediction);
  }
}
