"use client";

import { ArrowLeft, FlaskConical, Info, MapPin, Printer, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RiskPanel from "@/components/risk/RiskPanel";
import ExplainPanel from "@/components/strategy/ExplainPanel";
import PlanCharts from "@/components/strategy/PlanCharts";
import StrategyCard, { PLAN_COLOR } from "@/components/strategy/StrategyCard";
import { Notice, Spinner } from "@/components/ui/controls";
import { ApiError, fetchAnalysis, fetchCrops } from "@/lib/api";
import { MONTHS_LONG, priorityLabel, shortCrop, soilLabel } from "@/lib/labels";
import { MOCK_CROPS } from "@/lib/mock";
import type { AnalysisRecord, CropInfo, Priority, SoilType, StrategyId } from "@/lib/types";

type Loaded = AnalysisRecord & { isSample?: boolean };

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "demo";
  const [record, setRecord] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crops, setCrops] = useState<CropInfo[]>(MOCK_CROPS);
  const [selected, setSelected] = useState<StrategyId | null>(null);

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
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <TriangleAlert className="mx-auto size-10 text-amber-600" aria-hidden />
        <h1 className="mt-3 text-xl font-bold text-slate-900">We couldn&apos;t open this report</h1>
        <p className="mt-1 text-slate-600">{error}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/farms" className="btn-secondary">
            My fields
          </Link>
          <Link href="/results/demo" className="btn-primary">
            See a sample report
          </Link>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-slate-500">
        <Spinner /> Loading your report…
      </div>
    );
  }

  const { prediction: p, explanation: ex } = record;
  const baseline = p.strategies.find((s) => s.id === "A") ?? p.strategies[0];
  const current = p.strategies.find((s) => s.id === selected) ?? baseline;
  const notes = Object.fromEntries(ex.per_strategy.map((n) => [n.id, n]));
  const inputs = p.inputs as { current_crop?: string; soil_type?: SoilType; priority?: Priority; planting_month?: number };
  const cropName = shortCrop(crops.find((c) => c.id === inputs.current_crop)?.name ?? inputs.current_crop ?? "");

  function choose(sid: StrategyId) {
    setSelected(sid);
    if (window.matchMedia("(min-width: 1024px)").matches) document.getElementById("details")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
      <nav className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href={record.isSample ? "/" : "/farms"} className="inline-flex items-center gap-1.5 text-sm font-semibold text-leaf-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {record.isSample ? "Home" : "My fields"}
        </Link>
        <div className="flex gap-2">
          <Link href="/farm" className="btn-secondary !min-h-10 !px-4 text-sm">
            Plan another field
          </Link>
          <button type="button" onClick={() => window.print()} className="btn-secondary !min-h-10 !px-4 text-sm">
            <Printer className="size-4" aria-hidden /> Print
          </button>
        </div>
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Your 3 crop plans</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
          <MapPin className="size-4" aria-hidden />
          {p.location.lat.toFixed(3)}°N, {p.location.lon.toFixed(3)}°E
          {p.area_ha ? ` · ${p.area_ha} ha` : ""}
          {cropName && ` · Now: ${cropName}`}
          {inputs.soil_type && ` · ${soilLabel(inputs.soil_type)} soil`}
          {inputs.planting_month && ` · Planting ${MONTHS_LONG[inputs.planting_month - 1]}`}
          {inputs.priority && (
            <>
              {" · Goal: "}
              <strong className="text-slate-800">{priorityLabel(inputs.priority)}</strong>
            </>
          )}
        </p>
      </header>

      {record.isSample && (
        <Notice tone="sample" icon={<FlaskConical className="size-5" />}>
          <strong>Sample report.</strong> This is an example field near Kandy with made-up numbers, so you can see what a report
          looks like.{" "}
          <Link href="/farm" className="font-semibold underline">
            Plan your own field
          </Link>
          .
        </Notice>
      )}
      {p.climate.source === "fallback" && !record.isSample && (
        <Notice tone="warn" icon={<TriangleAlert className="size-5" />}>
          NASA POWER couldn&apos;t be reached, so this report uses modelled weather. Run it again later for real NASA data.
        </Notice>
      )}

      <section className="rounded-2xl bg-gradient-to-r from-leaf-900 to-leaf-700 p-6 text-white shadow">
        <p className="flex items-center gap-1.5 text-sm text-white/80">
          <Sparkles className="size-4" aria-hidden />
          {ex.source === "gemini" ? "Summary written by Google Gemini from the numbers below" : "Summary"}
        </p>
        <p className="mt-2 text-lg leading-relaxed">{ex.summary}</p>
      </section>

      <section aria-label="Plans">
        <div role="tablist" aria-label="Choose a plan" className="no-print mb-3 grid grid-cols-3 gap-2 lg:hidden">
          {p.strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === selected}
              onClick={() => setSelected(s.id)}
              className="min-h-12 rounded-xl border-2 text-[15px] font-semibold"
              style={
                s.id === selected
                  ? { background: PLAN_COLOR[s.id], borderColor: PLAN_COLOR[s.id], color: "#fff" }
                  : { borderColor: "#e2e8f0", background: "#fff", color: "#1e293b" }
              }
            >
              Plan {s.id}
              {s.id === p.recommended_strategy ? " ★" : ""}
            </button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {p.strategies.map((s) => (
            <div key={s.id} className={s.id === selected ? "" : "hidden lg:block print:block"}>
              <StrategyCard
                strategy={s}
                baseline={baseline}
                recommended={s.id === p.recommended_strategy}
                selected={s.id === selected}
                note={notes[s.id]}
                onSelect={() => choose(s.id)}
              />
            </div>
          ))}
        </div>
      </section>

      <div id="details" className="scroll-mt-20">
        <ExplainPanel strategy={current} note={notes[current.id]} areaHa={p.area_ha} />
      </div>

      <PlanCharts strategies={p.strategies} selected={current.id} />

      <RiskPanel prediction={p} />

      <section className="card text-sm text-slate-600">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Info className="size-5 text-slate-500" aria-hidden /> Good to know
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {ex.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>Money is in US dollars per hectare, using regional average prices.</li>
          <li>These plans support your own judgement and your agricultural officer&apos;s advice; they don&apos;t replace them.</li>
        </ul>
        <details className="mt-4">
          <summary className="cursor-pointer font-medium text-slate-700">How we worked this out</summary>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed">
            <li>
              <strong>Weather:</strong> NASA POWER monthly agroclimatology (max temperature, corrected rainfall, sunlight,
              evapotranspiration) for {p.climate.lat}, {p.climate.lon}, {p.climate.start_year}–{p.climate.end_year}
              {p.climate.cached ? " (from cache)" : ""}.
            </li>
            <li>
              <strong>Layer 1 forecast:</strong> {p.risk.soil_moisture_deficit.model.method}; soil water R² ={" "}
              {p.risk.soil_moisture_deficit.model.r2}, trend {p.risk.soil_moisture_deficit.model.slope_per_year} mm/month per year,{" "}
              {p.risk.soil_moisture_deficit.model.n_obs} months of data. Heat model R² = {p.risk.heat_stress.model.r2}.
            </li>
            <li>
              <strong>Layer 2 rotations:</strong> {p.optimizer.method}; population {p.optimizer.population},{" "}
              {p.optimizer.generations} generations.
            </li>
            <li>
              <strong>Nearby farms:</strong> modelled estimate (HHI {p.risk.regional_saturation.herfindahl_index}), not survey data.
            </li>
            <li>
              <strong>Explanation:</strong> {ex.source === "gemini" ? `Google ${ex.model ?? "Gemini"}` : "automatic template"}, written only from the numbers above.
            </li>
          </ul>
        </details>
      </section>
    </div>
  );
}
