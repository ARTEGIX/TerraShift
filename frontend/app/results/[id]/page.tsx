"use client";

import { ArrowLeft, CalendarDays, ChevronDown, CloudSun, FlaskConical, Layers, Printer, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RiskPanel from "@/components/risk/RiskPanel";
import ActionPlan from "@/components/strategy/ActionPlan";
import ExplainPanel from "@/components/strategy/ExplainPanel";
import PlanCharts from "@/components/strategy/PlanCharts";
import StrategyCard, { CropSequence, PLAN_COLOR, PLAN_SHORT, SignalList, signalsFor } from "@/components/strategy/StrategyCard";
import { PageLoader } from "@/components/ui/Loaders";
import { ApiError, fetchAnalysis, fetchCrops } from "@/lib/api";
import { MONTHS_LONG, cleanText, priorityLabel, shortCrop, soilLabel } from "@/lib/labels";
import { MOCK_CROPS } from "@/lib/mock";
import { letterOf, type AnalysisRecord, type CropInfo, type Priority, type SoilType, type StrategyId } from "@/lib/types";

type Loaded = AnalysisRecord & { isSample?: boolean };
type Tab = "plans" | "calendar" | "weather";

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: "plans", label: "Plans", icon: Layers },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "weather", label: "Weather", icon: CloudSun },
];

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "demo";
  const [record, setRecord] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crops, setCrops] = useState<CropInfo[]>(MOCK_CROPS);
  const [selected, setSelected] = useState<StrategyId | null>(null);
  const [tab, setTab] = useState<Tab>("plans");

  useEffect(() => {
    setRecord(null);
    setError(null);
    fetchCrops().then(setCrops);
    fetchAnalysis(id)
      .then((r) => {
        setRecord(r);
        setSelected(r.prediction.recommended_strategy);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isAuth) router.replace(`/login?next=/results/${encodeURIComponent(id)}`);
        else setError((err as Error).message);
      });
  }, [id, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <TriangleAlert className="mx-auto size-12 text-amber-500" aria-hidden />
        <h1 className="mt-4 text-[28px] font-bold tracking-tight text-ink">Can&apos;t open this report</h1>
        <p className="mt-2 text-[17px] text-ink-3">{error}</p>
        <div className="mt-8 flex flex-col gap-3">
          <Link href="/farms" className="btn-primary">
            Go to my fields
          </Link>
          <Link href="/results/demo" className="btn-secondary">
            See a sample report
          </Link>
        </div>
      </div>
    );
  }

  if (!record) return <PageLoader label="Opening your plan…" />;

  const p = record.prediction;
  // Repair double-encoded characters from the backend template ("â†’" → "→").
  const raw = record.explanation;
  const ex = {
    ...raw,
    summary: cleanText(raw.summary),
    caveats: raw.caveats.map(cleanText),
    per_strategy: raw.per_strategy.map((n) => ({
      ...n,
      headline: cleanText(n.headline),
      why: cleanText(n.why),
      risks: n.risks.map(cleanText),
      first_steps: n.first_steps.map(cleanText),
    })),
  };
  const baseline = p.strategies.find((s) => letterOf(s) === "A") ?? p.strategies[0];
  const best = p.strategies.find((s) => s.id === p.recommended_strategy) ?? baseline;
  const current = p.strategies.find((s) => s.id === selected) ?? best;
  const notes = Object.fromEntries(ex.per_strategy.map((n) => [n.id, n]));
  const inputs = p.inputs as { current_crop?: string; soil_type?: SoilType; priority?: Priority; planting_month?: number };
  const cropNow = shortCrop(crops.find((c) => c.id === inputs.current_crop)?.name ?? inputs.current_crop ?? "");

  function go(t: Tab, plan?: StrategyId) {
    if (plan) setSelected(plan);
    setTab(t);
    document.getElementById("tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-4 sm:px-6">
      {/* Top actions */}
      <nav className="no-print flex items-center justify-between">
        <Link href={record.isSample ? "/" : "/farms"} className="btn-plain -ml-1 text-[15px]">
          <ArrowLeft className="size-5" aria-hidden /> {record.isSample ? "Home" : "My fields"}
        </Link>
        <button type="button" onClick={() => window.print()} aria-label="Print this plan" className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-black/[0.05]">
          <Printer className="size-5" aria-hidden />
        </button>
      </nav>

      {/* Title */}
      <header className="mt-3">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink">Your plan</h1>
        <p className="mt-1 text-[15px] text-ink-3">
          {[
            p.area_ha ? `${p.area_ha} ha` : null,
            cropNow ? `${cropNow} now` : null,
            inputs.soil_type ? soilLabel(inputs.soil_type) : null,
            inputs.planting_month ? `planting in ${MONTHS_LONG[inputs.planting_month - 1]}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {record.isSample && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-violet-50 px-4 py-3 text-[15px] text-violet-900">
          <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            <strong>Sample report</strong> with made-up numbers.{" "}
            <Link href="/farm" className="font-semibold underline">
              Plan your own field
            </Link>
          </span>
        </p>
      )}
      {p.climate.source === "fallback" && !record.isSample && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          NASA data couldn&apos;t be reached, so this uses modelled weather. Try again later for real data.
        </p>
      )}

      {/* The one answer: what we recommend */}
      <section aria-labelledby="best-h" className="card mt-5 animate-fade-up">
        <p className="eyebrow">We recommend</p>
        <h2 id="best-h" className="mt-2 flex items-center gap-3 text-[28px] font-bold leading-tight tracking-tight text-ink">
          <span className="grid size-10 shrink-0 place-items-center rounded-full text-[17px] text-white" style={{ background: PLAN_COLOR[letterOf(best)] }} aria-hidden>
            {letterOf(best)}
          </span>
          {PLAN_SHORT[letterOf(best)]}
        </h2>
        <p className="mt-1 text-[15px] text-ink-3">Best for your goal: {priorityLabel(inputs.priority)}</p>
        <div className="mt-5">
          <CropSequence strategy={best} withSeason />
        </div>
        <div className="mt-5">
          <SignalList signals={signalsFor(best, baseline)} />
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => go("calendar", best.id)} className="btn-primary flex-1">
            <CalendarDays className="size-5" aria-hidden /> What to do and when
          </button>
          <button type="button" onClick={() => go("plans")} className="btn-secondary flex-1">
            Compare plans
          </button>
        </div>
      </section>

      {/* Tabs: one topic per screen */}
      <div id="tabs" className="no-print sticky top-14 z-30 -mx-4 mt-8 scroll-mt-14 bg-canvas/85 px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div role="tablist" aria-label="Report sections" className="segmented grid-cols-3">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <t.icon className="size-4" aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {tab === "plans" && (
          <div className="space-y-4">
            <section className="rounded-3xl bg-gradient-to-br from-leaf-700 to-leaf-900 p-5 text-white sm:p-6">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-white/75">
                <Sparkles className="size-4" aria-hidden /> In short
              </p>
              <p className="mt-2 text-[17px] leading-relaxed">{ex.summary}</p>
            </section>

            <div className="space-y-3" role="list" aria-label="The 3 plans">
              {p.strategies.map((s) => (
                <div role="listitem" key={s.id}>
                  <StrategyCard
                    strategy={s}
                    baseline={baseline}
                    recommended={s.id === p.recommended_strategy}
                    selected={s.id === current.id}
                    onSelect={() => setSelected(s.id)}
                  />
                </div>
              ))}
            </div>

            <ExplainPanel key={current.id} strategy={current} baseline={baseline} note={notes[current.id]} areaHa={p.area_ha} />

            <button type="button" onClick={() => go("calendar")} className="btn-secondary w-full">
              <CalendarDays className="size-5" aria-hidden /> Calendar for Plan {letterOf(current)}
            </button>

            <details className="group card [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <Layers className="size-5 text-ink-3" aria-hidden />
                <span className="flex-1 text-[17px] font-semibold text-ink">Compare season by season</span>
                <ChevronDown className="size-5 text-ink-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="mt-4">
                <PlanCharts strategies={p.strategies} selected={current.id} />
              </div>
            </details>
          </div>
        )}

        {tab === "calendar" && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Calendar for which plan" className="segmented grid-cols-3">
              {p.strategies.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={s.id === current.id} aria-selected={s.id === current.id} onClick={() => setSelected(s.id)}>
                  <span className="size-2.5 rounded-full" style={{ background: PLAN_COLOR[letterOf(s)] }} aria-hidden />
                  Plan {letterOf(s)}
                  {s.id === p.recommended_strategy ? " ★" : ""}
                </button>
              ))}
            </div>
            <ActionPlan key={current.id} strategy={current} prediction={p} crops={crops} areaHa={p.area_ha} />
          </div>
        )}

        {tab === "weather" && <RiskPanel prediction={p} />}
      </div>

      {/* Fine print, folded away */}
      <details className="group mt-10 px-1 text-[15px] text-ink-3 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-ink-2">
          About this plan
          <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-3 space-y-2">
          {ex.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>Money is in US dollars per hectare, using regional average prices.</li>
          <li>Plans support your own judgement and your agricultural officer&apos;s advice; they don&apos;t replace them.</li>
          <li className="text-[13px]">
            Weather: NASA POWER, SMAP soil moisture and NDVI, last {p.climate.months_count ?? p.climate.monthly?.length ?? 36} months at{" "}
            {p.climate.lat}, {p.climate.lon}. Layer 1: soil moisture trend R² {p.risk.soil_moisture_deficit.r2}. Region profile:{" "}
            {p.risk.regional_saturation.region_name}. Rotations: {p.optimizer.method}, {p.optimizer.population} ×{" "}
            {p.optimizer.generations} generations{p.optimizer.lookup_source ? ` (crop data: ${p.optimizer.lookup_source})` : ""}. Text:{" "}
            {ex.source === "gemini" ? `Google ${ex.model ?? "Gemini"}` : "automatic template"}.
          </li>
        </ul>
      </details>
    </div>
  );
}
