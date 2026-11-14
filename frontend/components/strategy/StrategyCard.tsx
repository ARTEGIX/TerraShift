"use client";

import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Coins, Droplets, Equal, Leaf } from "lucide-react";
import CropIcon from "@/components/ui/CropIcon";
import { kg, mm, seasonName, shortCrop, signedUsd, usd } from "@/lib/labels";
import { letterOf, type Strategy } from "@/lib/types";

/** Validated categorical palette (passes CVD + contrast checks). Colour follows the plan, never its rank. */
export type PlanLetter = "A" | "B" | "C";
export const PLAN_COLOR: Record<PlanLetter, string> = { A: "#2563eb", B: "#047857", C: "#c2410c" };

export const PLAN_SHORT: Record<PlanLetter, string> = {
  A: "Keep going as now",
  B: "Protect soil and water",
  C: "Earn more",
};

export type Tone = "good" | "bad" | "same";

export interface Signal {
  icon: typeof Coins;
  label: string;
  text: string;
  tone: Tone;
}

/** Compare a plan with Plan A (the farmer's current practice) in plain words. */
export function signalsFor(s: Strategy, a: Strategy): Signal[] {
  const t = s.totals;
  if (letterOf(s) === "A") {
    return [
      { icon: Coins, label: "Profit", text: `${usd(t.net_margin_usd_ha)} per hectare in 3 seasons`, tone: t.net_margin_usd_ha < 0 ? "bad" : "same" },
      { icon: Droplets, label: "Water", text: `Uses ${mm(t.water_use_mm)} of water`, tone: "same" },
      {
        icon: Leaf,
        label: "Soil",
        text: t.nitrogen_balance_kg_ha < 0 ? "Soil gets weaker each season" : `Soil nitrogen ${kg(t.nitrogen_balance_kg_ha)}`,
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
      text: Math.abs(margin) < 10 ? "About the same money" : margin > 0 ? `Earn ${signedUsd(margin).slice(1)} more per hectare` : `Earn ${signedUsd(margin).slice(1)} less per hectare`,
      tone: tone(margin > 0, Math.abs(margin) < 10),
    },
    {
      icon: Droplets,
      label: "Water",
      text: Math.abs(waterPct) < 3 ? "About the same water" : waterPct < 0 ? `Uses ${-waterPct}% less water` : `Uses ${waterPct}% more water`,
      tone: tone(waterPct < 0, Math.abs(waterPct) < 3),
    },
    {
      icon: Leaf,
      label: "Soil",
      text: Math.abs(nDiff) < 5 ? "Soil about the same" : nDiff > 0 ? "Healthier soil" : "Weaker soil",
      tone: tone(nDiff > 0, Math.abs(nDiff) < 5),
    },
  ];
}

const TONE_CLS: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-700",
  bad: "bg-red-100 text-red-700",
  same: "bg-black/[0.05] text-ink-3",
};

export function SignalList({ signals, size = "md" }: { signals: Signal[]; size?: "sm" | "md" }) {
  return (
    <ul className={size === "md" ? "space-y-3" : "space-y-2"}>
      {signals.map((s) => {
        const Arrow = s.tone === "same" ? Equal : s.tone === "good" ? ArrowUp : ArrowDown;
        return (
          <li key={s.label} className="flex items-center gap-3">
            <span className={`grid shrink-0 place-items-center rounded-full ${TONE_CLS[s.tone]} ${size === "md" ? "size-8" : "size-7"}`} aria-hidden>
              <Arrow className="size-4" />
            </span>
            <span className="sr-only">{s.label}:</span>
            <span className={size === "md" ? "text-[17px] text-ink" : "text-[15px] text-ink-2"}>{s.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Crop sequence as small chips: Sunn Hemp → Sesame → Chickpea */
export function CropSequence({ strategy, withSeason = false }: { strategy: Strategy; withSeason?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="Crops by season">
      {strategy.seasons.map((s, i) => (
        <li key={s.season} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRight className="size-4 text-ink-4" aria-hidden />}
          <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] py-1 pl-1 pr-3">
            <CropIcon category={s.category} />
            <span className="leading-tight">
              {withSeason && <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-4">{seasonName(s.season_label)}</span>}
              <span className="block text-[15px] font-medium text-ink">{shortCrop(s.crop_name)}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Compact, tappable plan row used in the plan list. */
export default function StrategyCard({
  strategy,
  baseline,
  recommended,
  selected,
  onSelect,
}: {
  strategy: Strategy;
  baseline: Strategy;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const main = signalsFor(strategy, baseline)[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left transition active:scale-[0.99] sm:p-5 ${
        selected ? "shadow-lift" : "shadow-soft hover:shadow-lift"
      }`}
      style={selected ? { boxShadow: `0 0 0 2.5px ${PLAN_COLOR[letterOf(strategy)]}, 0 12px 32px rgba(0,0,0,0.10)` } : undefined}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full text-[17px] font-bold text-white" style={{ background: PLAN_COLOR[letterOf(strategy)] }} aria-hidden>
        {letterOf(strategy)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[17px] font-semibold text-ink">{PLAN_SHORT[letterOf(strategy)]}</span>
          {recommended && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-900">Recommended</span>}
        </span>
        <span className="mt-0.5 block truncate text-[15px] text-ink-3">{strategy.seasons.map((s) => shortCrop(s.crop_name)).join(" → ")}</span>
        <span className={`mt-1 block text-[15px] font-medium ${main.tone === "good" ? "text-emerald-700" : main.tone === "bad" ? "text-red-700" : "text-ink-2"}`}>
          {main.text}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-4" aria-hidden />
    </button>
  );
}
