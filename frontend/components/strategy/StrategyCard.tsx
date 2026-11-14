"use client";

import { ArrowDown, ArrowUp, Coins, Droplets, Equal, Leaf, ShieldCheck, Star } from "lucide-react";
import CropIcon from "@/components/ui/CropIcon";
import { kg, mm, shortCrop, signedUsd, usd } from "@/lib/labels";
import type { Explanation, Strategy, StrategyId } from "@/lib/types";

/** Validated categorical palette (passes CVD + contrast checks). Colour follows the plan, never its rank. */
export const PLAN_COLOR: Record<StrategyId, string> = { A: "#2563eb", B: "#047857", C: "#c2410c" };

export const PLAN_SHORT: Record<StrategyId, string> = {
  A: "Keep going as now",
  B: "Protect soil and water",
  C: "Earn more",
};

type Tone = "good" | "bad" | "same";

interface Signal {
  icon: typeof Coins;
  label: string;
  text: string;
  tone: Tone;
}

/** Compare a plan with Plan A (the farmer's current practice) in plain words. */
export function signalsFor(s: Strategy, a: Strategy): Signal[] {
  const t = s.totals;
  if (s.id === "A") {
    return [
      { icon: Coins, label: "Profit", text: `${usd(t.net_margin_usd_ha)} per ha over 3 seasons`, tone: "same" },
      { icon: Droplets, label: "Water", text: `${mm(t.water_use_mm)} used`, tone: "same" },
      {
        icon: Leaf,
        label: "Soil",
        text: t.nitrogen_balance_kg_ha < 0 ? `Soil loses ${Math.abs(Math.round(t.nitrogen_balance_kg_ha))} kg/ha nitrogen` : `Soil nitrogen ${kg(t.nitrogen_balance_kg_ha)}`,
        tone: t.nitrogen_balance_kg_ha < 0 ? "bad" : "same",
      },
    ];
  }
  const margin = t.net_margin_usd_ha - a.totals.net_margin_usd_ha;
  const waterPct = a.totals.water_use_mm ? Math.round(((t.water_use_mm - a.totals.water_use_mm) / a.totals.water_use_mm) * 100) : 0;
  const nDiff = t.nitrogen_balance_kg_ha - a.totals.nitrogen_balance_kg_ha;
  const tone = (good: boolean, small: boolean): Tone => (small ? "same" : good ? "good" : "bad");
  return [
    {
      icon: Coins,
      label: "Profit",
      text: Math.abs(margin) < 10 ? "About the same profit" : `${signedUsd(margin)} per ha vs. now`,
      tone: tone(margin > 0, Math.abs(margin) < 10),
    },
    {
      icon: Droplets,
      label: "Water",
      text: Math.abs(waterPct) < 3 ? "About the same water" : waterPct < 0 ? `${-waterPct}% less water` : `${waterPct}% more water`,
      tone: tone(waterPct < 0, Math.abs(waterPct) < 3),
    },
    {
      icon: Leaf,
      label: "Soil",
      text: Math.abs(nDiff) < 5 ? "Soil about the same" : nDiff > 0 ? `${Math.round(nDiff)} kg/ha more soil nitrogen` : `${Math.round(-nDiff)} kg/ha less soil nitrogen`,
      tone: tone(nDiff > 0, Math.abs(nDiff) < 5),
    },
  ];
}

const TONE_CLS: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  bad: "bg-red-100 text-red-800",
  same: "bg-slate-100 text-slate-600",
};

export function SeasonStrip({ strategy }: { strategy: Strategy }) {
  return (
    <ol className="space-y-1.5" aria-label="Crop for each season">
      {strategy.seasons.map((s) => (
        <li key={s.season} className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
          <CropIcon category={s.category} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{s.season_label}</span>
            <span className="block truncate text-sm font-semibold text-slate-900">{shortCrop(s.crop_name)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

interface Props {
  strategy: Strategy;
  baseline: Strategy;
  recommended: boolean;
  selected: boolean;
  note?: Explanation["per_strategy"][number];
  onSelect: () => void;
}

export default function StrategyCard({ strategy, baseline, recommended, selected, note, onSelect }: Props) {
  const color = PLAN_COLOR[strategy.id];
  return (
    <article
      aria-labelledby={`plan-${strategy.id}`}
      className={`flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ${selected ? "" : "ring-1 ring-soil-100"}`}
      style={selected ? { boxShadow: `0 0 0 3px ${color}` } : undefined}
    >
      <div className="flex min-h-[1.75rem] items-start justify-between gap-2">
        <span className="grid size-8 place-items-center rounded-full text-sm font-bold text-white" style={{ background: color }} aria-hidden>
          {strategy.id}
        </span>
        {recommended && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
            <Star className="size-3.5" aria-hidden /> Best for your goal
          </span>
        )}
      </div>
      <h3 id={`plan-${strategy.id}`} className="mt-3 text-lg font-bold leading-tight text-slate-900">
        Plan {strategy.id}: {PLAN_SHORT[strategy.id]}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{note?.headline ?? strategy.description}</p>

      <div className="mt-4">
        <SeasonStrip strategy={strategy} />
      </div>

      <ul className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
        {signalsFor(strategy, baseline).map((s) => {
          const Arrow = s.tone === "same" ? Equal : s.tone === "good" ? ArrowUp : ArrowDown;
          return (
            <li key={s.label} className="flex items-center gap-2.5">
              <s.icon className="size-5 shrink-0 text-slate-500" aria-hidden />
              <span className="sr-only">{s.label}:</span>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full ${TONE_CLS[s.tone]}`} aria-hidden>
                <Arrow className="size-4" />
              </span>
              <span className="text-[15px] leading-snug text-slate-800">{s.text}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <ShieldCheck className="size-5 text-slate-500" aria-hidden />
        Climate resilience: <strong className="text-slate-900">{Math.round(strategy.totals.resilience_score)}/100</strong>
      </div>

      <div className="mt-auto pt-5">
        <button type="button" onClick={onSelect} aria-pressed={selected} className={`w-full ${selected ? "btn-primary" : "btn-secondary"}`}>
          {selected ? "Details shown below" : "Why this plan?"}
        </button>
      </div>
    </article>
  );
}
