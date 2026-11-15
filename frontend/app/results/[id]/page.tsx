"use client";

import { ArrowLeft, CalendarDays, ChevronDown, CloudSun, FolderPlus, Layers, Printer, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RiskPanel from "@/components/risk/RiskPanel";
import ActionPlan from "@/components/strategy/ActionPlan";
import ExplainPanel from "@/components/strategy/ExplainPanel";
import PlanCharts from "@/components/strategy/PlanCharts";
import StrategyCard, { CropSequence, PLAN_COLOR, PLAN_SHORT, SignalList, signalsFor } from "@/components/strategy/StrategyCard";
import CascadeWarningModal from "@/components/ui/CascadeWarningModal";
import { PageLoader } from "@/components/ui/Loaders";
import { ApiError, createProject, deleteAnalysis, fetchAnalysis, fetchCrops } from "@/lib/api";
import { MONTHS_LONG, cleanText, prettyId, priorityLabel, shortCrop, soilLabel } from "@/lib/labels";
import { letterOf, type AnalysisRecord, type CropInfo, type Priority, type SoilType, type StrategyId } from "@/lib/types";

type Tab = "plans" | "calendar" | "weather";

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: "plans", label: "Plans", icon: Layers },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "weather", label: "Weather", icon: CloudSun },
];

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [selected, setSelected] = useState<StrategyId | null>(null);
  const [tab, setTab] = useState<Tab>("plans");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectPlan, setProjectPlan] = useState<StrategyId>("B_SOIL_WATER_RESILIENCE");
  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingReport, setDeletingReport] = useState(false);

  useEffect(() => {
    setRecord(null);
    setError(null);
    fetchCrops().then(setCrops).catch(() => setCrops([]));
    fetchAnalysis(id)
      .then((r) => {
        setRecord(r);
        setSelected(r.prediction.recommended_strategy);
        setProjectPlan(r.prediction.recommended_strategy);
        setProjectName("3-Season Field Project");
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
          <Link href="/farm" className="btn-secondary">
            Plan a field
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
  const cropNow = inputs.current_crop ? shortCrop(crops.find((c) => c.id === inputs.current_crop)?.name ?? prettyId(inputs.current_crop)) : "";

  function go(t: Tab, plan?: StrategyId) {
    if (plan) setSelected(plan);
    setTab(t);
    document.getElementById("tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openCreateProject(planId?: StrategyId) {
    const chosen = planId ?? current.id;
    setProjectPlan(chosen);
    setProjectError(null);
    if (!projectName.trim()) {
      setProjectName(`${cropNow ? `${cropNow} ` : ""}3-Season Project`);
    }
    setProjectModalOpen(true);
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) {
      setProjectError("Please enter a project name.");
      return;
    }
    setCreatingProject(true);
    setProjectError(null);
    try {
      const proj = await createProject({
        report_id: record!.id,
        selected_strategy: projectPlan,
        name: projectName.trim(),
      });
      router.push(`/projects/${proj.id}`);
    } catch (err) {
      setProjectError((err as Error).message);
      setCreatingProject(false);
    }
  }

  async function handleDeleteReport() {
    setDeletingReport(true);
    try {
      await deleteAnalysis(record!.id);
      router.push(record!.farm_id ? `/farms/${record!.farm_id}` : "/farms");
    } catch (err) {
      setError((err as Error).message);
      setDeletingReport(false);
      setDeleteModalOpen(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-4 sm:px-6">
      {/* Top actions */}
      <nav className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={record.farm_id ? `/farms/${record.farm_id}` : "/farms"} className="btn-plain -ml-1 text-[15px]">
            <ArrowLeft className="size-5" aria-hidden /> {record.farm_id ? "Back to field" : "My fields"}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateProject()}
            className="btn-primary !min-h-10 !px-4 text-[14px]"
          >
            <FolderPlus className="size-4" aria-hidden /> Create Project
          </button>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            aria-label="Delete report"
            className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
          <button type="button" onClick={() => window.print()} aria-label="Print this plan" className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-black/[0.05]">
            <Printer className="size-5" aria-hidden />
          </button>
        </div>
      </nav>

      {/* Title */}
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[12px] font-semibold text-ink-2">
            Read-Only Report Snapshot
          </span>
          {record.farm_id && (
            <Link href={`/farms/${record.farm_id}`} className="rounded-full bg-leaf-50 px-3 py-1 text-[12px] font-semibold text-leaf-700 hover:bg-leaf-100">
              View Field →
            </Link>
          )}
        </div>
        <h1 className="mt-2 text-[34px] font-bold leading-tight tracking-tight text-ink">Your plan</h1>
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

      {p.climate.source === "fallback" && (
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

            <button type="button" onClick={() => openCreateProject(current.id)} className="btn-primary w-full">
              <FolderPlus className="size-5" aria-hidden /> Create Project from Plan {letterOf(current)}
            </button>
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

      {/* Create Project Modal */}
      {projectModalOpen && (
        <div
          className="fixed inset-0 z-[2000] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
        >
          <form onSubmit={handleCreateProject} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="create-project-title" className="text-[22px] font-bold tracking-tight text-ink">
                  Create Project from Report
                </h2>
                <p className="mt-1 text-[14px] text-ink-3">
                  Choose a 3-season strategy to turn into an editable project workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProjectModalOpen(false)}
                disabled={creatingProject}
                aria-label="Close modal"
                className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-black/[0.05]"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Select strategy">
              {p.strategies.map((s) => {
                const l = letterOf(s);
                const checked = projectPlan === s.id;
                return (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition ${
                      checked ? "border-leaf-600 bg-leaf-50/60" : "border-black/10 hover:bg-black/[0.02]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="projectPlan"
                      value={s.id}
                      checked={checked}
                      onChange={() => setProjectPlan(s.id)}
                      className="mt-1 accent-leaf-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-ink">
                          Plan {l} · {PLAN_SHORT[l]}
                          {s.id === p.recommended_strategy ? " ★" : ""}
                        </span>
                        <span className="text-[13px] font-medium text-leaf-700">
                          ${Math.round(s.totals.net_margin_usd_ha)}/ha · {Math.round(s.totals.water_use_mm)} mm
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-ink-3">
                        {s.seasons.map((sn) => sn.crop_name).join(" → ")}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-4">
              <label htmlFor="project-name-input" className="block text-[14px] font-semibold text-ink">
                Project Name
              </label>
              <input
                id="project-name-input"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g., North Paddy 3-Season Project"
                maxLength={120}
                className="mt-1.5 w-full rounded-2xl border border-black/15 px-4 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
              />
            </div>

            {projectError && <p className="mt-3 text-[14px] font-medium text-red-600">{projectError}</p>}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setProjectModalOpen(false)} disabled={creatingProject} className="btn-secondary !min-h-11 !px-4 text-[15px]">
                Cancel
              </button>
              <button type="submit" disabled={creatingProject} className="btn-primary !min-h-11 !px-5 text-[15px]">
                {creatingProject ? "Creating…" : "Create & Open Project"}
              </button>
            </div>
          </form>
        </div>
      )}

      <CascadeWarningModal
        open={deleteModalOpen}
        title="Delete this report?"
        description="Deleting this report is permanent and will also cascade-delete all active 3-season projects created from this report."
        confirmLabel="Delete Report & Linked Projects"
        busy={deletingReport}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteReport}
      />
    </div>
  );
}
