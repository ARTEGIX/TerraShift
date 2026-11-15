"use client";

import { ArrowLeft, ExternalLink, RefreshCw, Save, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/controls";
import { PageLoader } from "@/components/ui/Loaders";
import { ApiError, deleteProject, fetchCrops, getProject, getToken, recalculateProject, updateProject, type ProjectSeasonInput } from "@/lib/api";
import { prettyId } from "@/lib/labels";
import { letterOf, type CropInfo, type ProjectDetailResponse } from "@/lib/types";

interface SeasonDraft {
  crop_id: string;
  target_water_mm: string;
  input_cost_usd_ha: string;
}

export default function ProjectWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<SeasonDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=/projects/${encodeURIComponent(id)}`);
      return;
    }
    fetchCrops().then(setCrops).catch(() => setCrops([]));
    setLoading(true);
    setError(null);
    getProject(id)
      .then((res) => {
        setDetail(res);
        setName(res.project.name);
        setDrafts(
          res.project.seasons.map((s) => ({
            crop_id: s.crop_id,
            target_water_mm: s.target_water_mm != null ? String(s.target_water_mm) : "",
            input_cost_usd_ha: s.input_cost_usd_ha != null ? String(s.input_cost_usd_ha) : "",
          })),
        );
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isAuth) {
          router.replace(`/login?next=/projects/${encodeURIComponent(id)}`);
        } else {
          setError((err as Error).message);
        }
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  function toSeasonInputs(): ProjectSeasonInput[] {
    return drafts.map((d) => ({
      crop_id: d.crop_id,
      target_water_mm: d.target_water_mm.trim() ? Number(d.target_water_mm) : null,
      input_cost_usd_ha: d.input_cost_usd_ha.trim() ? Number(d.input_cost_usd_ha) : null,
    }));
  }

  function updateDraft(idx: number, patch: Partial<SeasonDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function handleRecalculate() {
    if (!detail) return;
    setRecalculating(true);
    setError(null);
    setStatusMsg(null);
    try {
      const updated = await recalculateProject(detail.project.id, toSeasonInputs());
      setDetail({ ...detail, project: updated });
      setStatusMsg("Recalculated 3-season metrics with Agronomy Engine.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecalculating(false);
    }
  }

  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const updated = await updateProject(detail.project.id, {
        name: name.trim() || detail.project.name,
        seasons: toSeasonInputs(),
      });
      setDetail({ ...detail, project: updated });
      setStatusMsg("Project saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail || !confirm(`Delete project "${detail.project.name}"?`)) return;
    setDeleting(true);
    try {
      await deleteProject(detail.project.id);
      router.push("/projects");
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  if (loading) return <PageLoader label="Opening project workspace…" />;
  if (!detail) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Notice tone="error">{error ?? "Project not found."}</Notice>
        <Link href="/projects" className="btn-secondary mt-4 inline-flex">
          <ArrowLeft className="size-4" aria-hidden /> Back to My projects
        </Link>
      </div>
    );
  }

  const { project, farm, report } = detail;
  const planLetter = letterOf(project.selected_strategy);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/projects" className="btn-plain -ml-1 text-[15px]">
          <ArrowLeft className="size-5" aria-hidden /> Back to My projects
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleSave} disabled={saving || recalculating} className="btn-secondary !min-h-10 !px-4 text-sm">
            <Save className="size-4" aria-hidden /> {saving ? "Saving…" : "Save Project"}
          </button>
          <button type="button" onClick={handleRecalculate} disabled={recalculating || saving} className="btn-primary !min-h-10 !px-4 text-sm">
            <RefreshCw className={`size-4 ${recalculating ? "animate-spin" : ""}`} aria-hidden />{" "}
            {recalculating ? "Recalculating…" : "Recalculate"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete project"
            className="grid size-10 place-items-center rounded-2xl bg-black/[0.05] text-ink-3 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Provenance Header */}
      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="rounded-full bg-leaf-50 px-3 py-1 font-semibold text-leaf-700">
            Based on Plan {planLetter}
          </span>
          {project.report_id && (
            <Link
              href={`/results/${project.report_id}`}
              className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-1 font-medium text-ink-2 hover:bg-black/[0.09]"
            >
              Report #{(report?.id ?? project.report_id).slice(0, 8)} <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
          {project.farm_id && (
            <Link
              href={`/farms/${project.farm_id}`}
              className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-3 py-1 font-medium text-ink-2 hover:bg-black/[0.09]"
            >
              Field: {farm?.name ?? project.farm_id} <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
        </div>

        <input
          type="text"
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mt-3 w-full rounded-2xl border border-transparent bg-transparent text-[30px] font-bold tracking-tight text-ink outline-none hover:border-black/10 focus:border-leaf-600 focus:bg-white focus:px-3"
        />
      </header>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {statusMsg && (
        <div className="mt-4">
          <Notice tone="info">{statusMsg}</Notice>
        </div>
      )}

      {/* Live Agronomy Engine Output Summary */}
      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <div className="card !p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">3-Season Net Profit</p>
          <p className="mt-1 text-[24px] font-bold text-leaf-700">${Math.round(project.totals?.net_margin_usd_ha ?? 0)}/ha</p>
        </div>
        <div className="card !p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Total Water Demand</p>
          <p className="mt-1 text-[24px] font-bold text-ink">{Math.round(project.totals?.water_use_mm ?? 0)} mm</p>
        </div>
        <div className="card !p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Soil N Balance</p>
          <p className="mt-1 text-[24px] font-bold text-ink">
            {project.totals?.nitrogen_balance_kg_ha >= 0 ? "+" : ""}
            {Math.round(project.totals?.nitrogen_balance_kg_ha ?? 0)} kg/ha
          </p>
        </div>
        <div className="card !p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Resilience Score</p>
          <p className="mt-1 text-[24px] font-bold text-ink">
            {Math.round(project.totals?.resilience_score ?? 0)}/100
          </p>
          <p className="text-[12px] text-ink-3">Recalculations: {project.recalculation_count}</p>
        </div>
      </section>

      {project.warnings?.length > 0 && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-[14px] text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0" aria-hidden /> Agronomic Warnings
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {project.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3-Season Timeline Stepper & Editable Parameters */}
      <section className="mt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-ink">3-Season Timeline &amp; Parameters</h2>
          <span className="text-[13px] text-ink-3">Edit parameters and click Recalculate to update metrics</span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {project.seasons.map((season, idx) => {
            const draft = drafts[idx] ?? { crop_id: season.crop_id, target_water_mm: "", input_cost_usd_ha: "" };
            return (
              <div key={idx} className="card flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-leaf-600 px-2.5 py-0.5 text-[12px] font-bold text-white">
                      0{idx + 1}
                    </span>
                    <span className="text-[13px] font-medium text-ink-3">{season.season_label}</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <label htmlFor={`s-${idx}-crop`} className="block text-[13px] font-semibold text-ink">
                        Crop
                      </label>
                      <select
                        id={`s-${idx}-crop`}
                        value={draft.crop_id}
                        onChange={(e) => updateDraft(idx, { crop_id: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-leaf-600"
                      >
                        {crops.length > 0 ? (
                          crops.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))
                        ) : (
                          <option value={draft.crop_id}>{prettyId(draft.crop_id)}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label htmlFor={`s-${idx}-water`} className="block text-[13px] font-semibold text-ink">
                        Target Water (mm)
                      </label>
                      <input
                        id={`s-${idx}-water`}
                        type="number"
                        min={1}
                        step="any"
                        placeholder={String(Math.round(season.metrics?.water_use_mm ?? 0))}
                        value={draft.target_water_mm}
                        onChange={(e) => updateDraft(idx, { target_water_mm: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-leaf-600"
                      />
                    </div>

                    <div>
                      <label htmlFor={`s-${idx}-cost`} className="block text-[13px] font-semibold text-ink">
                        Input Cost ($/ha)
                      </label>
                      <input
                        id={`s-${idx}-cost`}
                        type="number"
                        min={0}
                        step="any"
                        placeholder={String(Math.round(season.metrics?.input_cost_usd_ha ?? 0))}
                        value={draft.input_cost_usd_ha}
                        onChange={(e) => updateDraft(idx, { input_cost_usd_ha: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-leaf-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1 border-t border-black/[0.06] pt-3 text-[13px] text-ink-2">
                  <div className="flex justify-between">
                    <span>Net margin</span>
                    <span className="font-semibold text-ink">${Math.round(season.metrics?.net_margin_usd_ha ?? 0)}/ha</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Water use</span>
                    <span className="font-semibold text-ink">{Math.round(season.metrics?.water_use_mm ?? 0)} mm</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Nitrogen balance</span>
                    <span className="font-semibold text-ink">
                      {(season.metrics?.nitrogen_balance_kg_ha ?? 0) >= 0 ? "+" : ""}
                      {Math.round(season.metrics?.nitrogen_balance_kg_ha ?? 0)} kg/ha
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
