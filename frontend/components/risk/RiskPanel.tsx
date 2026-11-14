"use client";

import { ChevronDown, CloudRain, Droplets, Flame, Mountain, Satellite, Store } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MONTHS, monthLabel, riskBand, seasonName } from "@/lib/labels";
import type { ClimateMonth, PredictResponse, RiskLevel } from "@/lib/types";

const axisTick = { fontSize: 12, fill: "#6e6e73" };
const tip = { borderRadius: 14, border: "none", boxShadow: "0 8px 24px rgba(0,0,0,.12)", fontSize: 13 };

type Level = "good" | "warn" | "bad";
const LEVEL: Record<Level, { word: string; dot: string; text: string }> = {
  good: { word: "Low risk", dot: "bg-emerald-500", text: "text-emerald-700" },
  warn: { word: "Medium risk", dot: "bg-amber-500", text: "text-amber-700" },
  bad: { word: "High risk", dot: "bg-red-500", text: "text-red-700" },
};
const fromScore = (s: number): Level => riskBand(s).tone;
const ERO_CLS: Record<RiskLevel, string> = {
  low: "bg-emerald-50 text-emerald-800",
  medium: "bg-amber-100 text-amber-900",
  high: "bg-red-100 text-red-900",
};
const prettyCrop = (id: string) => id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function monthlyAverages(monthly: ClimateMonth[]) {
  return MONTHS.map((name, i) => {
    const rows = monthly.filter((m) => Number(m.month.slice(5, 7)) === i + 1);
    const avg = (k: keyof ClimateMonth) => (rows.length ? rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) / rows.length : 0);
    return { name, rain: Math.round(avg("precip_mm")), tmax: Math.round(avg("t2m_max_c") * 10) / 10 };
  });
}

type TileId = "dry" | "rain" | "heat" | "market";

export default function RiskPanel({ prediction }: { prediction: PredictResponse }) {
  const { risk, climate } = prediction;
  const smd = risk.soil_moisture_deficit;
  const ero = risk.bare_field_erosion;
  const heat = risk.heat_stress;
  const reg = risk.regional_saturation;
  const high = ero.windows.filter((w) => w.risk_level === "high");
  const medium = ero.windows.filter((w) => w.risk_level === "medium");
  const [open, setOpen] = useState<TileId>("dry");

  const monthly = climate.monthly ?? [];
  const years = monthly.length ? `${monthly[0].month.slice(0, 4)}–${monthly[monthly.length - 1].month.slice(0, 4)}` : "";
  const seasonLabels = prediction.strategies[0]?.seasons.map((s) => seasonName(s.season_label)) ?? [];
  const budgets = risk.season_water_budgets_mm.map((mm, i) => ({ name: seasonLabels[i] ? `${i + 1}. ${seasonLabels[i]}` : `Season ${i + 1}`, mm: Math.round(mm) }));
  const driest = budgets.length ? budgets.reduce((a, b) => (b.mm < a.mm ? b : a)) : null;
  const driestName = driest?.name.replace(/^\d\. /, "");
  const anomaly = smd.october_moisture_anomaly_pct;
  const trendWord = { improving: "getting wetter", stable: "about the same", worsening: "getting drier" }[smd.trend];
  const monthName = (n: number) => MONTHS[(n - 1 + 12) % 12];

  const tiles: { id: TileId; icon: typeof Droplets; title: string; level: Level; line: string }[] = [
    {
      id: "dry",
      icon: Droplets,
      title: "Dry soil",
      level: fromScore(smd.score),
      line: driestName ? `Driest season: ${driestName}` : `Soil is ${trendWord}`,
    },
    {
      id: "rain",
      icon: Mountain,
      title: "Soil washing away",
      level: high.length ? "bad" : fromScore(ero.score),
      line: high.length
        ? `Watch ${high.map((w) => monthName(w.month_num)).join(", ")}`
        : medium.length
          ? `Some risk in ${medium.length} month${medium.length > 1 ? "s" : ""}`
          : "No problem expected",
    },
    {
      id: "heat",
      icon: Flame,
      title: "Too hot",
      level: fromScore(heat.score),
      line: heat.months_over_35c > 0 ? `${heat.months_over_35c} month${heat.months_over_35c > 1 ? "s" : ""} over 35°C` : "No month over 35°C",
    },
    {
      id: "market",
      icon: Store,
      title: "Crowded market",
      level: reg.current_crop_oversupplied ? "bad" : "good",
      line: reg.current_crop_oversupplied ? `Your crop sells for ~${Math.round(reg.oversupply_penalty_pct)}% less` : "Your crop isn't oversupplied",
    },
  ];

  const detail: Record<TileId, ReactNode> = {
    dry: (
      <>
        <p>
          Rain brings very different amounts of water each season
          {driestName ? `. ${driestName} is the driest, so choose crops that need little water then` : ""}. Over the years, the soil
          in your area is {trendWord}
          {Math.abs(anomaly) >= 1 ? `, and October soil moisture is ${Math.abs(Math.round(anomaly))}% ${anomaly > 0 ? "above" : "below"} normal` : ""}.
        </p>
        {budgets.length > 0 && (
          <>
            <p className="mt-4 text-[15px] font-semibold text-ink">Water from rain, each season (mm)</p>
            <div className="mt-2 h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={budgets} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="#ececf0" />
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
                  <Tooltip contentStyle={tip} cursor={{ fill: "#f5f5f7" }} formatter={(v) => [`${v} mm`, "Rain water"]} />
                  <Bar dataKey="mm" fill="#2563eb" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
        {monthly.some((m) => m.smap_rootzone_pct != null) && (
          <>
            <p className="mt-4 text-[15px] font-semibold text-ink">Soil moisture from NASA SMAP (%){years ? `, ${years}` : ""}</p>
            <div className="mt-2 h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly.map((m) => ({ label: monthLabel(m.month), v: m.smap_rootzone_pct }))} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} stroke="#ececf0" />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={5} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} domain={[0, 100]} />
                  <Tooltip contentStyle={tip} formatter={(v) => [`${v}%`, "Soil moisture"]} />
                  <Line dataKey="v" stroke="#047857" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[13px] text-ink-3">Higher means wetter soil around the roots.</p>
          </>
        )}
      </>
    ),
    rain: (
      <>
        <p>
          {high.length
            ? `Heavy rain is likely in ${high.map((w) => monthName(w.month_num)).join(", ")} while the field is bare. Keep the soil covered then.`
            : medium.length
              ? `No big danger. In ${medium.map((w) => monthName(w.month_num)).join(", ")} heavy rain may wash some soil away, so keep the ground covered.`
              : "No heavy rain on bare soil expected in the next year."}
        </p>
        <ol className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-12" aria-label="Risk by month">
          {ero.windows.map((w) => (
            <li
              key={w.month_num}
              title={`${monthName(w.month_num)}: about ${Math.round(w.projected_precip_mm)} mm rain, field ${w.bare_field ? "bare" : "planted"}, ${w.risk_level} risk`}
              className={`rounded-xl px-1 py-2 text-center text-[12px] font-semibold ${ERO_CLS[w.risk_level]}`}
            >
              {monthName(w.month_num)}
              <span className="block text-[11px] font-normal opacity-80">{w.bare_field ? "bare" : "crop"}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[13px] text-ink-3">Green: low · Yellow: medium · Red: high. “Bare” means no crop in the field that month.</p>
      </>
    ),
    heat: (
      <p>
        The hottest month may reach about <strong className="text-ink">{heat.peak_t2m_max_c.toFixed(1)}°C</strong>.{" "}
        {heat.months_over_35c > 0
          ? `${heat.months_over_35c} month${heat.months_over_35c > 1 ? "s are" : " is"} over 35°C, which stresses many crops. Crops that handle heat, like sesame or cowpea, are safer then.`
          : "No month goes over 35°C, so heat should not be a big problem."}
      </p>
    ),
    market: (
      <>
        <p>
          In your region, many farms already grow{" "}
          <strong className="text-ink">{reg.oversupplied_crops.map(prettyCrop).join(", ") || "a mix of crops"}</strong>.
          {reg.current_crop_oversupplied
            ? ` Your current crop is one of them, so its price may be about ${Math.round(reg.oversupply_penalty_pct)}% lower at harvest.`
            : " Your current crop is not one of them."}{" "}
          Pests of the {reg.dominant_pest_family} family are common here, so switching to a different crop family helps.
        </p>
        <p className="mt-3 rounded-2xl bg-black/[0.04] px-4 py-3 text-[13px] text-ink-3">
          Based on the regional land-use profile for {reg.region_name}. Ask your agrarian service centre what neighbours plan to grow
          this season.
        </p>
      </>
    ),
  };

  const overall = fromScore(risk.overall_score);
  const active = tiles.find((t) => t.id === open)!;
  const avgs = monthly.length ? monthlyAverages(monthly) : null;

  return (
    <div className="space-y-4">
      <section className="card animate-fade-up">
        <p className="eyebrow flex items-center gap-1.5">
          <Satellite className="size-4" aria-hidden /> NASA data for your area
        </p>
        <p className="mt-2 text-[22px] font-bold tracking-tight text-ink">
          Overall: <span className={LEVEL[overall].text}>{LEVEL[overall].word.toLowerCase()}</span>
        </p>
        <p className="mt-1 text-[15px] text-ink-3">
          {climate.source === "nasa_power"
            ? `Based on ${monthly.length || climate.months_count || 36} months of NASA weather, soil moisture and plant health${years ? ` (${years})` : ""}.`
            : "NASA data was unavailable, so this uses modelled weather. Treat it as a rough guide."}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {tiles.map((t) => {
            const lv = LEVEL[t.level];
            const on = t.id === open;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpen(t.id)}
                aria-pressed={on}
                className={`flex flex-col items-start gap-2 rounded-2xl p-4 text-left transition active:scale-[0.98] ${
                  on ? "bg-white ring-2 ring-leaf-600" : "bg-black/[0.035] hover:bg-black/[0.06]"
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <t.icon className="size-6 text-ink-2" aria-hidden />
                  <span className={`size-2.5 rounded-full ${lv.dot}`} aria-hidden />
                </span>
                <span className="text-[17px] font-semibold leading-tight text-ink">{t.title}</span>
                <span className={`text-[13px] font-semibold ${lv.text}`}>{lv.word}</span>
                <span className="text-[13px] leading-snug text-ink-3">{t.line}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section key={open} className="card animate-fade-up text-[17px] leading-relaxed text-ink-2" aria-live="polite">
        <h3 className="mb-2 flex items-center gap-2 text-[20px] font-bold tracking-tight text-ink">
          <active.icon className="size-5 text-ink-3" aria-hidden /> {active.title}
        </h3>
        {detail[open]}
      </section>

      {avgs && (
        <details className="group card [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3">
            <CloudRain className="size-5 text-ink-3" aria-hidden />
            <span className="flex-1 text-[17px] font-semibold text-ink">Rain by month</span>
            <ChevronDown className="size-5 text-ink-4 transition group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 text-[15px] text-ink-3">
            Average rain in mm{years ? `, ${years}` : ""}. Hottest month averages {Math.max(...avgs.map((a) => a.tmax)).toFixed(1)}°C.
          </p>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={avgs} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#ececf0" />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={tip} cursor={{ fill: "#f5f5f7" }} formatter={(v) => [`${v} mm`, "Rain"]} />
                <Bar dataKey="rain" fill="#2563eb" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </details>
      )}
    </div>
  );
}
