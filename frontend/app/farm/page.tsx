"use client";

import { ArrowLeft, ArrowRight, Coins, Droplets, Pencil, Sprout } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import FarmMapLazy from "@/components/map/FarmMapLazy";
import CropIcon from "@/components/ui/CropIcon";
import { ChoiceCards, Notice, Question, Spinner } from "@/components/ui/controls";
import { AnalysisLoader, PageLoader } from "@/components/ui/Loaders";
import { ApiError, analyseFarm, createFarm, fetchCrops, getToken, prefetchSatellite } from "@/lib/api";
import { clearDraft, useDraft, type FieldDraft } from "@/lib/draft";
import { checkField, formatLatLon, haToAcres } from "@/lib/geo";
import { CATEGORY_LABEL, MONTHS_LONG, PLANTING_PRESETS, PRIORITY_OPTIONS, SOIL_OPTIONS, regionFor, shortCrop } from "@/lib/labels";
import type { CropInfo, Priority } from "@/lib/types";

const STEPS = [
  { title: "Your field", sub: "Find your farm and trace the field" },
  { title: "What you grow", sub: "The crop in the field now" },
  { title: "Your soil", sub: "Pick the one that looks most like yours" },
  { title: "Your main goal", sub: "We'll mark the plan that fits it best" },
] as const;

type Errors = Partial<Record<"field" | "crop" | "soil" | "priority", string>>;

function errorsFor(d: FieldDraft, step: number): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (!d.polygon) e.field = "Draw your field on the map first.";
    else {
      const c = checkField(d.polygon);
      if (!c.ok) e.field = c.error;
    }
  }
  if (step === 1 && !d.currentCrop) e.crop = "Choose the crop in your field now.";
  if (step === 2 && !d.soilType) e.soil = "Choose your soil type.";
  if (step === 3 && !d.priority) e.priority = "Choose your main goal.";
  return e;
}

export default function FarmWizardPage() {
  const router = useRouter();
  const [draft, update, loaded] = useDraft();
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [cropsError, setCropsError] = useState<string | null>(null);
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [drawSignal, setDrawSignal] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  function loadCrops() {
    setCropsError(null);
    fetchCrops()
      .then(setCrops)
      .catch((err: Error) => setCropsError(err.message));
  }
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?next=/farm");
      return;
    }
    setAuthed(true);
    loadCrops();
  }, [router]);

  const step = draft.step;
  const errors = tried[step] ? errorsFor(draft, step) : {};
  const field = useMemo(() => (draft.polygon ? checkField(draft.polygon) : null), [draft.polygon]);
  const crop = crops.find((c) => c.id === draft.currentCrop);

  function goTo(s: FieldDraft["step"]) {
    update({ step: s });
    window.scrollTo({ top: 0 });
  }

  async function next() {
    if (Object.keys(errorsFor(draft, step)).length) {
      setTried((t) => ({ ...t, [step]: true }));
      return;
    }
    if (step === 0 && field?.centroid) {
      prefetchSatellite(field.centroid.lat, field.centroid.lon);
    }
    if (step < 3) return goTo((step + 1) as FieldDraft["step"]);
    await run();
  }

  async function run() {
    setRunError(null);
    setRunning(true);
    try {
      const farm = await createFarm({
        name: draft.name.trim() || "My field",
        polygon: draft.polygon!,
        // centroid omitted: main-service computes an area-weighted one.
        region_id: field?.centroid ? regionFor(field.centroid.lat) : undefined,
        soil_type: draft.soilType!,
        current_crop: draft.currentCrop!,
        default_priority: draft.priority!,
        planting_month: draft.plantingMonth,
      });
      const analysis = await analyseFarm(farm._id, draft.priority!, draft.plantingMonth);
      clearDraft();
      router.push(`/results/${analysis.id}`);
    } catch (err) {
      setRunning(false);
      if (err instanceof ApiError && err.isAuth) {
        router.replace("/login?next=/farm");
        return;
      }
      setRunError((err as Error).message);
    }
  }

  if (!loaded || !authed) return <PageLoader label="Loading…" />;

  const header = (
    <header className="space-y-3">
      <nav aria-label="Steps">
        <ol className="flex gap-1.5">
          {STEPS.map((s, i) => {
            const reachable = STEPS.slice(0, i).every((_, j) => Object.keys(errorsFor(draft, j)).length === 0);
            return (
              <li key={s.title} className="flex-1">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => goTo(i as FieldDraft["step"])}
                  aria-current={step === i ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  className="block w-full py-1 disabled:cursor-not-allowed"
                >
                  <span className={`block h-1.5 rounded-full transition-colors ${i <= step ? "bg-leaf-600" : "bg-black/[0.08]"}`} />
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-1.5 text-[15px] text-ink-3">
          Step {step + 1} of {STEPS.length}
        </p>
      </nav>
      <div>
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink">{STEPS[step].title}</h1>
        <p className="mt-1 text-[17px] text-ink-3">{STEPS[step].sub}</p>
      </div>
    </header>
  );

  const footer = (
    <div className="space-y-2">
      {runError && <Notice tone="error">{runError}</Notice>}
      <div className="flex gap-3">
        {step > 0 && (
          <button type="button" onClick={() => goTo((step - 1) as FieldDraft["step"])} className="btn-secondary flex-1" disabled={running}>
            <ArrowLeft className="size-5" aria-hidden /> Back
          </button>
        )}
        <button type="button" onClick={next} disabled={running} className="btn-primary flex-[2]">
          {running ? (
            <>
              <Spinner /> Working…
            </>
          ) : step === 3 ? (
            <>
              Get my 3 plans <ArrowRight className="size-5" aria-hidden />
            </>
          ) : (
            <>
              Next <ArrowRight className="size-5" aria-hidden />
            </>
          )}
        </button>
      </div>
    </div>
  );

  const runningOverlay = running && <AnalysisLoader />;

  /* ---------------- Step 1: the map gets most of the screen ---------------- */
  if (step === 0) {
    return (
      <div className="flex flex-col-reverse lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
        {runningOverlay}
        <aside className="flex w-full shrink-0 flex-col bg-canvas lg:w-[27rem] lg:border-r lg:border-black/[0.08]">
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {header}
            <Question label="Trace your field" error={errors.field}>
              <ol className="space-y-1.5 text-[15px] leading-relaxed text-ink-2">
                <li>1. Search your village or tap the location button on the map.</li>
                <li>2. Zoom in until you can see your field.</li>
                <li>3. Tap each corner of the field, then tap the first corner again.</li>
              </ol>
              <button
                type="button"
                onClick={() => {
                  setDrawSignal((n) => n + 1);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="btn-primary w-full"
              >
                <Pencil className="size-5" aria-hidden /> {draft.polygon ? "Draw it again" : "Start drawing"}
              </button>
              {field?.ok && field.centroid && (
                <p className="animate-fade-up rounded-2xl bg-leaf-50 px-4 py-3 text-[15px] text-leaf-900">
                  Field size: <strong>{field.areaHa} ha</strong> ({haToAcres(field.areaHa!).toFixed(1)} acres) ·{" "}
                  {formatLatLon(field.centroid)}
                </p>
              )}
            </Question>
            <Question label="Field name (optional)">
              <input
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="North paddy"
                maxLength={120}
                aria-label="Field name"
                className="input"
              />
            </Question>
          </div>
          <div className="sticky bottom-0 border-t border-black/[0.08] bg-canvas/85 px-5 py-3 backdrop-blur-xl">{footer}</div>
        </aside>
        <div className="relative h-[56vh] min-h-[24rem] w-full shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <FarmMapLazy polygon={draft.polygon} onPolygonChange={(p) => update({ polygon: p })} drawSignal={drawSignal} />
        </div>
      </div>
    );
  }

  /* ---------------- Steps 2–4: one simple card ---------------- */
  return (
    <div className="mx-auto max-w-3xl px-4 pb-40 pt-6 sm:px-6">
      {runningOverlay}
      {header}
      <div key={step} className="mt-8 animate-fade-up">
        {step === 1 && (
          <div className="space-y-8">
            <Question label="Which crop is in the field now?" error={errors.crop}>
              {cropsError && (
                <Notice tone="error">
                  <p>Couldn&apos;t load the crop list. {cropsError}</p>
                  <button type="button" onClick={loadCrops} className="btn-plain mt-1 text-[15px]">
                    Try again
                  </button>
                </Notice>
              )}
              {!cropsError && crops.length === 0 && (
                <p className="flex items-center gap-2 text-[15px] text-ink-3">
                  <Spinner className="size-4" /> Loading crops…
                </p>
              )}
              <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {crops.map((c) => {
                  const on = draft.currentCrop === c.id;
                  return (
                    <label
                      key={c.id}
                      className={`flex min-h-[4rem] cursor-pointer items-center gap-3 rounded-2xl bg-white px-3 py-2.5 transition active:scale-[0.98] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-leaf-600 ${
                        on ? "shadow-lift ring-2 ring-leaf-600" : "shadow-soft hover:shadow-lift"
                      }`}
                    >
                      <input type="radio" name="crop" className="sr-only" checked={on} onChange={() => update({ currentCrop: c.id })} />
                      <CropIcon category={c.category} />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold leading-tight text-ink">{shortCrop(c.name)}</span>
                        <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">{CATEGORY_LABEL[c.category]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Question>
            <Question
              label="When do you plant next?"
              help="Maha is the main rainy season (planting around October). Yala is the drier season (planting around April). The plan covers three seasons from this month."
            >
              <ChoiceCards
                name="planting"
                value={PLANTING_PRESETS.some((p) => p.month === draft.plantingMonth) ? String(draft.plantingMonth) : null}
                onChange={(v) => update({ plantingMonth: Number(v) })}
                options={PLANTING_PRESETS.map((p) => ({ value: String(p.month), label: p.label, hint: p.hint }))}
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Or choose a month:
                <select
                  value={draft.plantingMonth}
                  onChange={(e) => update({ plantingMonth: Number(e.target.value) })}
                  className="rounded-lg border-2 border-slate-200 bg-white px-2 py-1.5 text-sm"
                >
                  {MONTHS_LONG.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </Question>
          </div>
        )}

        {step === 2 && (
          <Question
            label="What does your soil look and feel like?"
            error={errors.soil}
            help="Take a handful of damp soil and squeeze it. Clay makes a sticky ribbon. Sandy soil falls apart and feels gritty. Loam holds together loosely. Red, hard soil is laterite."
          >
            <ChoiceCards
              name="soil"
              value={draft.soilType}
              onChange={(v) => update({ soilType: v })}
              options={SOIL_OPTIONS.map((s) => ({ value: s.value, label: s.label, hint: s.hint, swatch: s.color }))}
            />
          </Question>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <Question label="What matters most to you?" error={errors.priority}>
              <ChoiceCards<Priority>
                name="priority"
                value={draft.priority}
                onChange={(v) => update({ priority: v })}
                columns="grid-cols-1 sm:grid-cols-3"
                options={PRIORITY_OPTIONS.map((p) => ({
                  ...p,
                  icon:
                    p.value === "cost" ? <Coins className="size-7" /> : p.value === "water" ? <Droplets className="size-7" /> : <Sprout className="size-7" />,
                }))}
              />
            </Question>
            <div className="card text-[15px] text-ink-2">
              <p className="font-semibold text-slate-900">Your answers</p>
              <ul className="mt-1.5 space-y-0.5">
                <li>
                  Field: {draft.name.trim() || "My field"}
                  {field?.areaHa ? ` · ${field.areaHa} ha` : ""}{" "}
                  <button type="button" onClick={() => goTo(0)} className="ml-1 text-leaf-700 underline">
                    change
                  </button>
                </li>
                <li>
                  Crop now: {crop ? shortCrop(crop.name) : "—"} · planting in {MONTHS_LONG[draft.plantingMonth - 1]}{" "}
                  <button type="button" onClick={() => goTo(1)} className="ml-1 text-leaf-700 underline">
                    change
                  </button>
                </li>
                <li>
                  Soil: {SOIL_OPTIONS.find((s) => s.value === draft.soilType)?.label ?? "—"}{" "}
                  <button type="button" onClick={() => goTo(2)} className="ml-1 text-leaf-700 underline">
                    change
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.08] bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">{footer}</div>
      </div>
    </div>
  );
}
