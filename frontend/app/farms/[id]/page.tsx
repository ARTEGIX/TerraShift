"use client";

import { ArrowLeft, Calendar, ExternalLink, Pencil, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import FarmMapLazy from "@/components/map/FarmMapLazy";
import CascadeWarningModal from "@/components/ui/CascadeWarningModal";
import { Notice } from "@/components/ui/controls";
import { AnalysisLoader, PageLoader } from "@/components/ui/Loaders";
import { analyseFarm, deleteAnalysis, deleteFarm, fetchCrops, getFarmDetail, updateFarm } from "@/lib/api";
import { haToAcres } from "@/lib/geo";
import { PLANTING_PRESETS, PRIORITY_OPTIONS, SOIL_OPTIONS, prettyId, shortCrop } from "@/lib/labels";
import { letterOf, type CropInfo, type Farm, type FarmReportSummary, type Polygon, type Priority } from "@/lib/types";

const dateFmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function FarmDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [farm, setFarm] = useState<Farm | null>(null);
  const [reports, setReports] = useState<FarmReportSummary[]>([]);
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Editable form state
  const [name, setName] = useState("");
  const [currentCrop, setCurrentCrop] = useState("");
  const [plantingMonth, setPlantingMonth] = useState<number>(10);
  const [soilType, setSoilType] = useState("soil_clay_loam");
  const [priority, setPriority] = useState<Priority>("water");
  const [polygon, setPolygon] = useState<Polygon | null>(null);
  const [drawSignal, setDrawSignal] = useState(0);

  // Action states
  const [busyAction, setBusyAction] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [modalMode, setModalMode] = useState<"save_field" | "delete_field" | "delete_report" | null>(null);
  const [reportToDelete, setReportToDelete] = useState<FarmReportSummary | null>(null);

  useEffect(() => {
    fetchCrops().then(setCrops).catch(() => setCrops([]));
    setLoading(true);
    setError(null);
    getFarmDetail(id)
      .then((res) => {
        setFarm(res.farm);
        setReports(res.reports);
        setName(res.farm.name);
        setCurrentCrop(res.farm.current_crop);
        setPlantingMonth(res.farm.planting_month ?? 10);
        setSoilType(res.farm.soil_type);
        setPriority(res.farm.default_priority);
        setPolygon(res.farm.polygon);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const cropName = (cid: string) => shortCrop(crops.find((c) => c.id === cid)?.name ?? prettyId(cid));

  async function executeSaveField() {
    if (!farm || !polygon) return;
    setBusyAction(true);
    setError(null);
    setSavedMsg(null);
    try {
      const updated = await updateFarm(farm._id, {
        name: name.trim() || farm.name,
        current_crop: currentCrop,
        planting_month: plantingMonth,
        soil_type: soilType,
        default_priority: priority,
        polygon,
      });
      setFarm({ ...updated, reports_count: 0, projects_count: 0 });
      setReports([]);
      setModalMode(null);
      setSavedMsg("Field changes saved. Linked reports and projects were cleared.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  }

  function handleSaveClick(e: React.FormEvent) {
    e.preventDefault();
    if (!farm) return;
    const hasLinked = (farm.reports_count ?? reports.length) > 0 || (farm.projects_count ?? 0) > 0;
    if (hasLinked) {
      setModalMode("save_field");
    } else {
      void executeSaveField();
    }
  }

  async function executeDeleteField() {
    if (!farm) return;
    setBusyAction(true);
    try {
      await deleteFarm(farm._id);
      router.push("/farms");
    } catch (err) {
      setError((err as Error).message);
      setBusyAction(false);
      setModalMode(null);
    }
  }

  async function executeDeleteReport() {
    if (!reportToDelete) return;
    setBusyAction(true);
    try {
      await deleteAnalysis(reportToDelete.id);
      setReports((prev) => prev.filter((r) => r.id !== reportToDelete.id));
      setFarm((prev) =>
        prev
          ? {
              ...prev,
              reports_count: Math.max(0, (prev.reports_count ?? reports.length) - 1),
              projects_count: Math.max(0, (prev.projects_count ?? 0) - reportToDelete.projects_count),
            }
          : null,
      );
      setReportToDelete(null);
      setModalMode(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleGenerateReport() {
    if (!farm) return;
    setAnalyzing(true);
    setError(null);
    try {
      const a = await analyseFarm(farm._id, priority, plantingMonth);
      router.push(`/results/${a.id}`);
    } catch (err) {
      setError((err as Error).message);
      setAnalyzing(false);
    }
  }

  if (loading) return <PageLoader label="Loading field details…" />;
  if (!farm) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Notice tone="error">{error ?? "Field not found."}</Notice>
        <Link href="/farms" className="btn-secondary mt-4 inline-flex">
          <ArrowLeft className="size-4" aria-hidden /> Back to My fields
        </Link>
      </div>
    );
  }

  const reportsCount = farm.reports_count ?? reports.length;
  const projectsCount = farm.projects_count ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/farms" className="btn-plain -ml-1 text-[15px]">
          <ArrowLeft className="size-5" aria-hidden /> Back to My fields
        </Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleGenerateReport} disabled={analyzing} className="btn-primary !min-h-10 !px-4 text-sm">
            <RefreshCw className="size-4" aria-hidden /> Get new plans
          </button>
          <button
            type="button"
            onClick={() => setModalMode("delete_field")}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-2xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
          >
            <Trash2 className="size-4" aria-hidden /> Delete Field
          </button>
        </div>
      </div>

      <header className="mt-4">
        <h1 className="text-[32px] font-bold leading-tight tracking-tight text-ink">{farm.name}</h1>
        <p className="mt-1 text-[15px] text-ink-3">
          {farm.area_ha} ha ({haToAcres(farm.area_ha).toFixed(1)} acres) · {farm.centroid.lat.toFixed(4)}° N, {farm.centroid.lon.toFixed(4)}° E ·{" "}
          {reportsCount} report(s) · {projectsCount} active project(s)
        </p>
      </header>

      {analyzing && <AnalysisLoader title="Generating new plans for this field" />}
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {savedMsg && (
        <div className="mt-4">
          <Notice tone="info">{savedMsg}</Notice>
        </div>
      )}

      {/* Editable Field Form + Geofence */}
      <form onSubmit={handleSaveClick} className="card mt-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[20px] font-semibold text-ink">Field Data &amp; Geofence (Editable)</h2>
          <button type="submit" disabled={busyAction} className="btn-primary !min-h-10 !px-4 text-sm">
            <Save className="size-4" aria-hidden /> Save Field Changes
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="field-name" className="block text-[14px] font-semibold text-ink">
              Field Name
            </label>
            <input
              id="field-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
            />
          </div>

          <div>
            <label htmlFor="field-crop" className="block text-[14px] font-semibold text-ink">
              Current Crop in Field
            </label>
            <select
              id="field-crop"
              value={currentCrop}
              onChange={(e) => setCurrentCrop(e.target.value)}
              className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
            >
              {crops.length > 0 ? (
                crops.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))
              ) : (
                <option value={currentCrop}>{prettyId(currentCrop)}</option>
              )}
            </select>
          </div>

          <div>
            <label htmlFor="field-season" className="block text-[14px] font-semibold text-ink">
              Next Planting Season
            </label>
            <select
              id="field-season"
              value={plantingMonth}
              onChange={(e) => setPlantingMonth(Number(e.target.value))}
              className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
            >
              {PLANTING_PRESETS.map((p) => (
                <option key={p.month} value={p.month}>
                  {p.label} ({p.hint})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="field-soil" className="block text-[14px] font-semibold text-ink">
              Soil Condition
            </label>
            <select
              id="field-soil"
              value={soilType}
              onChange={(e) => setSoilType(e.target.value)}
              className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
            >
              {SOIL_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="field-priority" className="block text-[14px] font-semibold text-ink">
              Primary Farmer Goal
            </label>
            <select
              id="field-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="mt-1.5 w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-leaf-600"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.hint}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold text-ink">Geofence Polygon</span>
            <button
              type="button"
              onClick={() => setDrawSignal((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-black/[0.1]"
            >
              <Pencil className="size-3.5" aria-hidden /> Redraw Geofence
            </button>
          </div>
          <div className="h-72 overflow-hidden rounded-2xl border border-black/10">
            <FarmMapLazy polygon={polygon} onPolygonChange={setPolygon} drawSignal={drawSignal} />
          </div>
        </div>
      </form>

      {/* Read-only Generated Reports List */}
      <section className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[20px] font-semibold text-ink">Generated Reports</h2>
            <p className="text-[14px] text-ink-3">Read-only snapshots. Deleting a report also deletes its linked projects.</p>
          </div>
        </div>

        {reports.length === 0 ? (
          <p className="mt-4 text-[15px] text-ink-3">No reports generated for this field yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                      <Calendar className="size-4 text-leaf-700" aria-hidden />
                      {dateFmt(r.created_at)}
                    </span>
                    <span className="rounded-full bg-leaf-50 px-2.5 py-0.5 text-[12px] font-semibold text-leaf-700">
                      Best: Plan {letterOf(r.recommended_strategy)}
                    </span>
                    <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[12px] font-medium text-ink-2">
                      {r.projects_count} linked {r.projects_count === 1 ? "project" : "projects"}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-ink-3">
                    Report #{r.id.slice(0, 8)} {r.current_crop ? `· Crop: ${cropName(r.current_crop)}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/results/${r.id}`} className="btn-secondary !min-h-10 !px-3.5 text-sm">
                    <ExternalLink className="size-4" aria-hidden /> Open Report
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setReportToDelete(r);
                      setModalMode("delete_report");
                    }}
                    aria-label={`Delete report ${r.id}`}
                    className="grid size-10 place-items-center rounded-2xl bg-black/[0.05] text-ink-3 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CascadeWarningModal
        open={modalMode === "save_field"}
        title="Save changes and cascade delete?"
        description={`Changing any field value or the geofence will permanently cascade-delete ${reportsCount} linked report(s) and ${projectsCount} linked project(s).`}
        confirmLabel="Save Changes & Cascade Delete"
        busy={busyAction}
        onCancel={() => setModalMode(null)}
        onConfirm={executeSaveField}
      />

      <CascadeWarningModal
        open={modalMode === "delete_field"}
        title={`Delete "${farm.name}"?`}
        description={`Deleting this field will permanently delete the field, ${reportsCount} linked report(s), and ${projectsCount} linked project(s).`}
        confirmLabel="Delete Field & Linked Data"
        busy={busyAction}
        onCancel={() => setModalMode(null)}
        onConfirm={executeDeleteField}
      />

      <CascadeWarningModal
        open={modalMode === "delete_report"}
        title="Delete this report?"
        description={`Deleting this read-only report will also permanently delete ${reportToDelete?.projects_count ?? 0} linked project(s).`}
        confirmLabel="Delete Report & Linked Projects"
        busy={busyAction}
        onCancel={() => {
          setModalMode(null);
          setReportToDelete(null);
        }}
        onConfirm={executeDeleteReport}
      />
    </div>
  );
}
