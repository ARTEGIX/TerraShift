"use client";

import { CalendarDays, ChevronDown, Droplets, PackageCheck, Scissors, ShieldAlert, Shovel, Sprout, Tractor } from "lucide-react";
import CropIcon from "@/components/ui/CropIcon";
import { MONTHS, seasonName, shortCrop } from "@/lib/labels";
import type { CropInfo, PredictResponse, Strategy } from "@/lib/types";

/**
 * Month-by-month "what to do when" for the selected plan.
 *
 * Built only from data already in the analysis response:
 *  - season start = planting month + 6 months per season (same as layer2_rot.season_windows)
 *  - crop duration from the crop table (growth_days)
 *  - fertilizer N and water shortfall per season from strategy.seasons[].metrics
 *  - dry months (projected rain under DRY_MONTH_MM) and bare-soil erosion months from Layer 1
 *    (`risk.bare_field_erosion.windows`, keyed by calendar month)
 * The task wording is general agronomy guidance, so the UI says to confirm it locally.
 */

const SEASON_MONTHS = 6;
/** A month with less projected rain than this is treated as dry. */
const DRY_MONTH_MM = 50;
const UREA_N_SHARE = 0.46; // urea is 46% nitrogen

interface YM {
  y: number;
  m: number; // 1-12
}
const add = ({ y, m }: YM, n: number): YM => {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
const key = ({ y, m }: YM) => `${y}-${String(m).padStart(2, "0")}`;
const label = (a: YM) => `${MONTHS[a.m - 1]} ${a.y}`;
const range = (a: YM, b: YM) => (key(a) === key(b) ? label(a) : a.y === b.y ? `${MONTHS[a.m - 1]} – ${label(b)}` : `${label(a)} – ${label(b)}`);
const monthsBetween = (a: YM, b: YM) => {
  const out: YM[] = [];
  for (let c = a; key(c) <= key(b); c = add(c, 1)) out.push(c);
  return out;
};
const list = (ms: YM[]) => ms.map((x) => MONTHS[x.m - 1]).join(", ");

type StepKind = "prepare" | "plant" | "grow" | "harvest" | "rest";

interface Step {
  kind: StepKind;
  when: string;
  /** YYYY-MM of the last month of this step, to find "what's next" from today. */
  end: string;
  title: string;
  tasks: string[];
  alert?: string;
}

interface SeasonPlanView {
  label: string;
  cropName: string;
  category: string;
  span: string;
  steps: Step[];
  note?: string;
}

const STEP_ICON: Record<StepKind, typeof Shovel> = {
  prepare: Shovel,
  plant: Sprout,
  grow: Droplets,
  harvest: Scissors,
  rest: ShieldAlert,
};
const STEP_TONE: Record<StepKind, string> = {
  prepare: "bg-amber-100 text-amber-800",
  plant: "bg-emerald-100 text-emerald-800",
  grow: "bg-sky-100 text-sky-800",
  harvest: "bg-orange-100 text-orange-800",
  rest: "bg-black/[0.06] text-ink-2",
};

function buildPlan(strategy: Strategy, prediction: PredictResponse, crops: CropInfo[], areaHa: number | null): SeasonPlanView[] {
  const planting = Number((prediction.inputs as { planting_month?: number }).planting_month ?? 10);
  // Season labels carry no year ("Season 1 (Maha)"), so start at the next time this planting month comes round.
  const today = new Date();
  const firstYear = planting >= today.getMonth() + 1 ? today.getFullYear() : today.getFullYear() + 1;
  const start0: YM = { y: firstYear, m: planting };

  const windows = prediction.risk.bare_field_erosion?.windows ?? [];
  const dryMonths = new Set(windows.filter((w) => w.projected_precip_mm < DRY_MONTH_MM).map((w) => w.month_num));
  const erosion = new Map(windows.map((w) => [w.month_num, w.risk_level]));

  return strategy.seasons.map((s, k) => {
    const crop = crops.find((c) => c.id === s.crop_id);
    const days = crop?.growth_days ?? 120;
    const start = add(start0, k * SEASON_MONTHS);
    const nextStart = add(start, SEASON_MONTHS);
    const growMonths = Math.max(1, Math.ceil(days / 30));
    const harvest = add(start, growMonths - 1);
    const name = shortCrop(s.crop_name);
    const isCover = s.category === "cover_crop";
    const isLegume = s.category === "legume" || isCover;
    const prev = strategy.seasons[k - 1];
    const m = s.metrics;
    const steps: Step[] = [];

    // 1. Get ready (month before planting)
    const prepTasks = [`Get ${name} seed${isLegume ? " (ask for rhizobium inoculant too; it helps the plants make their own nitrogen)" : ""}.`];
    if (k === 0) prepTasks.push("Test your soil (pH and nutrients) if you can. Your agrarian service centre can help.");
    if (prev?.category === "cover_crop") prepTasks.push(`Prepare the land. The ${shortCrop(prev.crop_name).toLowerCase()} you turned in is now feeding the soil.`);
    else if (prev) prepTasks.push(`Clear what is left of the ${shortCrop(prev.crop_name).toLowerCase()} and prepare the land.`);
    else prepTasks.push("Plough or dig the field and remove weeds.");
    if (m.water_deficit_mm > 0) prepTasks.push("Rain will not be enough this season. Check your canal, well or pump now.");
    steps.push({ kind: "prepare", when: label(add(start, -1)), end: key(add(start, -1)), title: "Get ready", tasks: prepTasks });

    // 2. Plant
    const plantTasks = [isCover ? `Sow ${name} thickly so it covers the whole field.` : `Plant ${name}.`];
    if (m.fertilizer_n_kg_ha > 0) {
      const urea = m.fertilizer_n_kg_ha / UREA_N_SHARE;
      const fieldKg = areaHa ? urea * areaHa : 0;
      const bags = Math.max(1, Math.round(fieldKg / 50)); // urea is sold in 50 kg bags
      const field = areaHa
        ? ` (about ${Math.round(fieldKg).toLocaleString("en-US")} kg, or ${bags.toLocaleString("en-US")} bag${bags > 1 ? "s" : ""} of 50 kg, for your whole field)`
        : "";
      plantTasks.push(
        `This crop needs about ${Math.round(m.fertilizer_n_kg_ha)} kg of nitrogen per hectare, roughly ${Math.round(urea)} kg of urea per hectare${field}. Give part at planting and the rest in 1–2 later doses.`,
      );
    } else {
      plantTasks.push(
        isLegume
          ? "No nitrogen fertilizer (urea) needed. This crop makes its own."
          : "No extra nitrogen fertilizer needed. The crop grown before left enough in the soil.",
      );
    }
    steps.push({ kind: "plant", when: label(start), end: key(start), title: isCover ? "Sow the cover crop" : "Plant", tasks: plantTasks });

    // 3. Look after the crop
    if (growMonths > 1) {
      // Month after planting to month before harvest; short crops (2 months) are looked after from planting.
      const growRange = growMonths > 2 ? monthsBetween(add(start, 1), add(harvest, -1)) : monthsBetween(start, harvest);
      const dry = growRange.filter((x) => dryMonths.has(x.m));
      const growTasks = ["Pull weeds in the first weeks. Walk the field each week to look for pests and sick leaves."];
      if (m.water_deficit_mm > 0) {
        growTasks.push(
          `Water the crop when the soil is dry${dry.length ? `, especially in ${list(dry)}` : ""}. Even with watering, about ${Math.round(m.water_deficit_mm)} mm may still be missing, so don't plant more than you can water.`,
        );
      } else {
        growTasks.push(dry.length ? `Rain should mostly be enough, but ${list(dry)} may be dry. Water if the soil cracks.` : "Rain should be enough for this crop.");
      }
      if (m.fertilizer_n_kg_ha > 0) growTasks.push("Give the second fertilizer dose about 4–6 weeks after planting.");
      steps.push({
        kind: "grow",
        when: range(growRange[0], growRange[growRange.length - 1]),
        end: key(growRange[growRange.length - 1]),
        title: "Look after the crop",
        tasks: growTasks,
      });
    }

    // 4. Harvest
    steps.push({
      kind: "harvest",
      when: label(harvest),
      end: key(harvest),
      title: isCover ? "Cut and turn into the soil" : "Harvest",
      tasks: isCover
        ? [`Cut the ${name} when it starts to flower and mix it into the soil. This is free fertilizer for the next crop.`]
        : [`Harvest the ${name} (about ${days} days after planting).`, "Leave crop leftovers on the field to protect the soil, unless they carry disease."],
    });

    // 5. Between harvest and next season
    const restStart = add(harvest, 1);
    const restEnd = add(nextStart, -2); // month before "Get ready" of next season
    let note: string | undefined;
    if (key(harvest) >= key(nextStart)) {
      note = `${name} needs about ${days} days, longer than one season, so it will still be in the field when the next season starts.`;
    } else if (key(restStart) <= key(restEnd)) {
      const gap = monthsBetween(restStart, restEnd);
      const risky = gap.filter((x) => erosion.get(x.m) === "high" || erosion.get(x.m) === "medium");
      steps.push({
        kind: "rest",
        when: range(gap[0], gap[gap.length - 1]),
        end: key(gap[gap.length - 1]),
        title: "Field is empty: protect the soil",
        tasks: ["Keep the soil covered with crop leftovers, mulch or a quick cover crop.", "Fix bunds and drains before the next rains."],
        alert: risky.length ? `Heavy rain is likely in ${list(risky)} while the field is empty. Topsoil can wash away.` : undefined,
      });
    }

    return { label: seasonName(s.season_label), cropName: name, category: s.category, span: range(add(start, -1), harvest), steps, note };
  });
}

function StepBody({ step, big = false }: { step: Step; big?: boolean }) {
  return (
    <>
      <ul className={`space-y-1.5 ${big ? "text-[17px]" : "text-[15px]"} leading-relaxed text-ink-2`}>
        {step.tasks.map((t) => (
          <li key={t} className="flex gap-2.5">
            <span className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      {step.alert && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[15px] text-red-800">{step.alert}</p>}
    </>
  );
}

export default function ActionPlan({
  strategy,
  prediction,
  crops,
  areaHa,
}: {
  strategy: Strategy;
  prediction: PredictResponse;
  crops: CropInfo[];
  areaHa: number | null;
}) {
  const seasons = buildPlan(strategy, prediction, crops, areaHa);
  const now = key({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 });

  // The next thing to do from today (or the very first step if the plan starts later).
  const all = seasons.flatMap((s, si) => s.steps.map((st) => ({ st, si })));
  const next = all.find((x) => x.st.end >= now) ?? all[0];
  const NextIcon = STEP_ICON[next.st.kind];

  return (
    <div className="space-y-6">
      {/* 1. One clear thing to do next */}
      <section aria-labelledby="next-h" className="card animate-fade-up">
        <p className="eyebrow">Your next step</p>
        <div className="mt-3 flex items-start gap-4">
          <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${STEP_TONE[next.st.kind]}`} aria-hidden>
            <NextIcon className="size-7" />
          </span>
          <div className="min-w-0">
            <h3 id="next-h" className="text-[22px] font-bold leading-tight tracking-tight text-ink">
              {next.st.title}
            </h3>
            <p className="mt-0.5 text-[17px] font-medium text-leaf-700">
              {next.st.when} · {seasons[next.si].cropName}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <StepBody step={next.st} big />
        </div>
      </section>

      {/* 2. Whole calendar, one season at a time */}
      <section aria-labelledby="cal-h" className="space-y-3">
        <h3 id="cal-h" className="flex items-center gap-2 px-1 text-[20px] font-bold tracking-tight text-ink">
          <CalendarDays className="size-5 text-ink-3" aria-hidden /> All 3 seasons
        </h3>
        {seasons.map((s, i) => (
          <details key={s.label} open={i === next.si} className="group card !p-0 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-4 p-5">
              <CropIcon category={s.category} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold text-ink">
                  Season {i + 1}: {s.cropName}
                </span>
                <span className="block text-[15px] text-ink-3">{s.span}</span>
              </span>
              <ChevronDown className="size-5 shrink-0 text-ink-4 transition group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="space-y-5 px-5 pb-5">
              {s.steps.map((step) => {
                const Icon = STEP_ICON[step.kind];
                const isNext = step === next.st;
                return (
                  <li key={step.kind} className="flex gap-3.5">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-full ${STEP_TONE[step.kind]}`} aria-hidden>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[17px] font-semibold text-ink">{step.title}</span>
                        <span className="text-[15px] text-ink-3">{step.when}</span>
                        {isNext && <span className="rounded-full bg-leaf-600 px-2 py-0.5 text-[12px] font-semibold text-white">Next</span>}
                      </p>
                      <div className="mt-1">
                        <StepBody step={step} />
                      </div>
                    </div>
                  </li>
                );
              })}
              {s.note && (
                <li className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
                  <Tractor className="mt-0.5 size-4 shrink-0" aria-hidden /> {s.note}
                </li>
              )}
            </ol>
          </details>
        ))}
      </section>

      <p className="flex items-start gap-2 px-1 text-[13px] text-ink-3">
        <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Dates, fertilizer and water amounts come from your analysis. The tasks are general advice; check them with your
        agricultural officer.
      </p>
    </div>
  );
}
