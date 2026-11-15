"use client";

import { ArrowRight, Calendar, MapPin, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CascadeWarningModal from "@/components/ui/CascadeWarningModal";
import { Notice } from "@/components/ui/controls";
import { AnalysisLoader, PageLoader } from "@/components/ui/Loaders";
import { ApiError, analyseFarm, deleteFarm, fetchCrops, getToken, listAnalyses, listFarms } from "@/lib/api";
import { haToAcres } from "@/lib/geo";
import { prettyId, priorityLabel, shortCrop, soilLabel } from "@/lib/labels";
import { letterOf, type AnalysisSummary, type CropInfo, type Farm } from "@/lib/types";

const dateFmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function FarmsPage() {
  const router = useRouter();
  const [farms, setFarms] = useState<Farm[] | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Farm | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?next=/farms");
      return;
    }
    fetchCrops().then(setCrops).catch(() => setCrops([]));
    Promise.all([listFarms(), listAnalyses()])
      .then(([f, a]) => {
        setFarms(f);
        setAnalyses(a);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isAuth) router.replace("/login?next=/farms");
        else setError((err as Error).message);
      });
  }, [router]);

  const cropName = (id: string) => shortCrop(crops.find((c) => c.id === id)?.name ?? prettyId(id));

  async function rerun(farm: Farm) {
    setBusy(farm._id);
    setError(null);
    try {
      const a = await analyseFarm(farm._id);
      router.push(`/results/${a.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFarm(deleteTarget._id);
      setFarms((f) => f?.filter((x) => x._id !== deleteTarget._id) ?? null);
      setAnalyses((prev) => prev.filter((a) => a.farm_id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink">My fields</h1>
          <p className="mt-1 text-[17px] text-ink-3">Get new plans for a field, or open an old report.</p>
        </div>
        <Link href="/farm" className="btn-primary">
          <Plus className="size-5" aria-hidden /> Add a field
        </Link>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {busy && <AnalysisLoader title="Making new plans" />}
      {farms === null && !error && <PageLoader label="Loading your fields…" />}

      {farms?.length === 0 && (
        <div className="card mt-8 text-center">
          <MapPin className="mx-auto size-9 text-leaf-600" aria-hidden />
          <p className="mt-2 text-lg font-semibold text-slate-900">Add your first field</p>
          <p className="text-slate-600">Draw it on the map and get three crop plans in about a minute.</p>
          <Link href="/farm" className="btn-primary mt-4">
            Plan my field <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      )}

      <ul className="mt-6 space-y-4">
        {farms?.map((farm) => {
          const past = analyses.filter((a) => a.farm_id === farm._id);
const reportsCount = Math.max(farm.reports_count ?? 0, past.length);
          const projectsCount = farm.projects_count ?? 0;
          return (
            <li key={farm._id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/farms/${farm._id}`} className="text-[20px] font-semibold tracking-tight text-ink hover:text-leaf-700">
                      {farm.name}
                    </Link>
                    <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-[12px] font-medium text-ink-2">
                      {reportsCount} {reportsCount === 1 ? "report" : "reports"}
                    </span>
                    <span className="rounded-full bg-leaf-50 px-2.5 py-0.5 text-[12px] font-medium text-leaf-700">
                      {projectsCount} {projectsCount === 1 ? "project" : "projects"}
                    </span>
                  </div>
                  <p className="mt-1 text-[15px] text-ink-3">
                    {farm.area_ha} ha ({haToAcres(farm.area_ha).toFixed(1)} acres) · {cropName(farm.current_crop)} ·{" "}
                    {soilLabel(farm.soil_type)} · Goal: {priorityLabel(farm.default_priority)}
                    {farm.planting_month ? ` · ${farm.planting_month === 4 ? "Yala (Apr)" : "Maha (Oct)"}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/farms/${farm._id}`} className="btn-secondary !min-h-11 !px-3.5 text-sm">
                    <Pencil className="size-4" aria-hidden /> Open / Edit
                  </Link>
                  <button type="button" onClick={() => rerun(farm)} disabled={!!busy} className="btn-primary !min-h-11 !px-4 text-sm">
                    <RefreshCw className="size-4" aria-hidden /> Get new plans
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(farm)}
                    aria-label={`Delete ${farm.name}`}
                    className="grid size-11 place-items-center rounded-2xl bg-black/[0.05] text-ink-3 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
              {past.length > 0 && (
                <div className="mt-4 border-t border-black/[0.06] pt-4">
                  <p className="eyebrow">Past reports</p>
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {past.slice(0, 6).map((a) => (
                      <li key={a._id}>
                        <Link href={`/results/${a._id}`} className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] px-3.5 py-2 text-[15px] text-ink-2 hover:bg-leaf-50 hover:text-leaf-700">
                          <Calendar className="size-3.5" aria-hidden /> {dateFmt(a.created_at)} · Best: Plan {letterOf(a.recommended_strategy)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <CascadeWarningModal
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name ?? "field"}"?`}
        description={`Deleting this field will permanently remove the field along with ${
          deleteTarget ? (deleteTarget.reports_count ?? analyses.filter((a) => a.farm_id === deleteTarget._id).length) : 0
        } linked report(s) and ${deleteTarget?.projects_count ?? 0} linked project(s).`}
        confirmLabel="Delete Field & Linked Data"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
