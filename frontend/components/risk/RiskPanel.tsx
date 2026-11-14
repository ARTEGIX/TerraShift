"use client";

import { CloudRain, Droplets, Flame, Mountain, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MONTHS, monthLabel, riskBand } from "@/lib/labels";
import type { ClimateMonth, PredictResponse, RiskLevel } from "@/lib/types";

const axisTick = { fontSize: 12, fill: "#475569" };
const tip = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 };
const BAND_CLS = { good: "bg-emerald-100 text-emerald-900", warn: "bg-amber-100 text-amber-900", bad: "bg-red-100 text-red-900" };
const LEVEL_CLS: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  medium: "bg-amber-100 text-amber-900 ring-amber-200",
  high: "bg-red-100 text-red-900 ring-red-200",
};

function Score({ score }: { score: number }) {
  const b = riskBand(score);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${BAND_CLS[b.tone]}`}>
      {b.word} risk · {Math.round(score)}/100
    </span>
  );
}

function Block({ icon, title, score, children }: { icon: ReactNode; title: string; score?: number; children: ReactNode }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <span className="text-slate-500" aria-hidden>
            {icon}
          </span>
          {title}
        </h3>
        {score !== undefined && <Score score={score} />}
      </div>
      <div className="mt-3 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

/** Average each calendar month over the years NASA POWER returned. */
function monthlyAverages(monthly: ClimateMonth[]) {
  return MONTHS.map((name, i) => {
    const rows = monthly.filter((m) => Number(m.month.slice(5, 7)) === i + 1);
    const avg = (k: keyof ClimateMonth) => (rows.length ? rows.reduce((s, r) => s + Number(r[k]), 0) / rows.length : 0);
    return { name, rain: Math.round(avg("precip_mm")), et: Math.round(avg("evapotranspiration_mm")), tmax: Math.round(avg("t2m_max_c") * 10) / 10 };
  });
}

export default function RiskPanel({ prediction }: { prediction: PredictResponse }) {
  const { risk, climate } = prediction;
  const smd = risk.soil_moisture_deficit;
  const heat = risk.heat_stress;
  const reg = risk.regional_saturation;
  const forecast = smd.forecast.map((f) => ({ ...f, label: monthLabel(f.month), range: [f.lower, f.upper] as [number, number] }));
  const highErosion = risk.erosion_windows.filter((w) => w.risk_level === "high");
  const mediumErosion = risk.erosion_windows.filter((w) => w.risk_level === "medium");
  const avgs = climate.monthly?.length ? monthlyAverages(climate.monthly) : null;
  const trendWord = { improving: "getting wetter", stable: "staying about the same", worsening: "getting drier" }[smd.trend];

  return (
    <section aria-labelledby="risk-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="risk-h" className="text-xl font-bold text-slate-900">
            What NASA data shows for your area
          </h2>
          <p className="text-sm text-slate-600">
            {climate.source === "nasa_power"
              ? `From NASA POWER records ${climate.start_year}–${climate.end_year}, with a 12-month forecast.`
              : "NASA POWER was offline, so this uses modelled weather. Treat it as a rough guide."}
          </p>
        </div>
        <Score score={risk.overall_score} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block icon={<Droplets className="size-5" />} title="Will your soil be dry?" score={smd.score}>
          <p>
            {smd.deficit_months_12m > 0 ? (
              <>
                Over the next 12 months, about <strong>{smd.deficit_months_12m} month{smd.deficit_months_12m > 1 ? "s" : ""}</strong> may
                lose more water than rain gives (about {Math.round(smd.cumulative_deficit_mm_12m)} mm short in total).
              </>
            ) : (
              <>In the next 12 months, rain is forecast to cover what the land loses every month.</>
            )}{" "}
            The long-term trend is <strong>{trendWord}</strong>.
          </p>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={forecast} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} interval={1} tickFormatter={(l: string) => l.split(" ")[0]} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Tooltip
                  contentStyle={tip}
                  formatter={(v, name) =>
                    name === "range"
                      ? [`${Math.round((v as number[])[0])} to ${Math.round((v as number[])[1])} mm`, "Likely range"]
                      : [`${Math.round(Number(v))} mm`, Number(v) < 0 ? "Water short" : "Extra water"]
                  }
                />
                <Area dataKey="range" name="range" stroke="none" fill="#93c5fd" fillOpacity={0.35} isAnimationActive={false} />
                <Line dataKey="value" name="value" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-slate-500">Rain minus evaporation each month, in mm. Below the line means the soil dries out. The shaded band is the likely range.</p>
        </Block>

        <Block icon={<Mountain className="size-5" />} title="Heavy rain on bare soil">
          <p>
            {highErosion.length
              ? `In ${highErosion.map((w) => monthLabel(w.month)).join(", ")}, heavy rain is likely while your field is bare. Topsoil can wash away. A cover crop then helps.`
              : mediumErosion.length
                ? `No high-risk months. Watch ${mediumErosion.map((w) => monthLabel(w.month)).join(", ")}: some soil may wash away in heavy rain.`
                : "No month with heavy rain on bare soil in the next year. Good."}
          </p>
          <ol className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-12" aria-label="Soil wash-away risk by month">
            {risk.erosion_windows.map((w) => (
              <li
                key={w.month}
                title={`${monthLabel(w.month, true)}: ${Math.round(w.precip_mm)} mm rain, field ${w.bare_field ? "bare" : "planted"}, ${w.risk_level} risk`}
                className={`rounded-md px-1 py-1.5 text-center text-[11px] font-medium ring-1 ${LEVEL_CLS[w.risk_level]}`}
              >
                {monthLabel(w.month).split(" ")[0]}
                <span className="block text-[10px] font-normal">{w.bare_field ? "bare" : "crop"}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>Green: low</span>
            <span>Yellow: medium</span>
            <span>Red: high risk</span>
          </p>
        </Block>

        <Block icon={<Flame className="size-5" />} title="Too hot for your crop?" score={heat.score}>
          <p>
            Your current crop starts to suffer above <strong>{heat.threshold_c}°C</strong>. The hottest month ahead is forecast at about{" "}
            <strong>{heat.peak_t2m_max_c.toFixed(1)}°C</strong>
            {heat.months_over_threshold > 0
              ? `, and ${heat.months_over_threshold} month${heat.months_over_threshold > 1 ? "s" : ""} may be too hot.`
              : ", so heat is not a big worry next year."}
          </p>
        </Block>

        <Block icon={<Users className="size-5" />} title="Nearby farms (estimate)" score={reg.score}>
          <p>
            We estimate about <strong>{Math.round(reg.crop_share_pct)}%</strong> of farms around you grow the same crop.
            {reg.oversupply_risk && " Prices may drop at harvest because many farmers sell the same crop."}
            {reg.monoculture_pest_risk && " Pests and diseases can spread more easily when so many fields grow similar crops."}
            {!reg.oversupply_risk && !reg.monoculture_pest_risk && " That's a healthy mix."}
          </p>
          <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            This is a modelled estimate for {reg.neighbor_farms_sampled} nearby farms, not a real survey. Ask your agrarian service
            centre what neighbours plan to grow.
          </p>
        </Block>
      </div>

      {avgs && (
        <section className="card" aria-labelledby="rain-h">
          <h3 id="rain-h" className="flex items-center gap-2 text-base font-bold text-slate-900">
            <CloudRain className="size-5 text-slate-500" aria-hidden /> Rain in your area, month by month
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Rain in mm, average of {climate.start_year}–{climate.end_year} from NASA POWER. Hottest month averages{" "}
            {Math.max(...avgs.map((a) => a.tmax)).toFixed(1)}°C.
          </p>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={avgs} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} interval={0} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={tip}
                  cursor={{ fill: "#f1f5f9" }}
                  formatter={(v) => [`${v} mm`, "Rain"]}
                  labelFormatter={(l, p) => {
                    const d = p?.[0]?.payload as (typeof avgs)[number] | undefined;
                    return d ? `${l} · max temp ${d.tmax}°C · evaporation ${d.et} mm` : String(l);
                  }}
                />
                <Bar dataKey="rain" fill="#2563eb" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </section>
  );
}
