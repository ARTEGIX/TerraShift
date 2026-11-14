"use client";

import { Coins, Droplets, Layers3, Leaf } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortCrop } from "@/lib/labels";
import type { SeasonMetrics, Strategy } from "@/lib/types";
import { PLAN_COLOR, PLAN_SHORT } from "./StrategyCard";

type Metric = "net_margin_usd_ha" | "water_use_mm" | "nitrogen_balance_kg_ha" | "som_pct";

const METRICS: { key: Metric; label: string; icon: typeof Coins; unit: string; kind: "bar" | "line"; help: string; fmt: (v: number) => string }[] = [
  {
    key: "net_margin_usd_ha",
    label: "Profit",
    icon: Coins,
    unit: "USD/ha",
    kind: "bar",
    help: "Money left after costs, per hectare, each season. Higher is better.",
    fmt: (v) => `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`,
  },
  {
    key: "water_use_mm",
    label: "Water",
    icon: Droplets,
    unit: "mm",
    kind: "bar",
    help: "Water the crop uses each season (rain plus irrigation). Lower is easier in dry years.",
    fmt: (v) => `${Math.round(v)} mm`,
  },
  {
    key: "nitrogen_balance_kg_ha",
    label: "Soil nitrogen",
    icon: Leaf,
    unit: "kg/ha",
    kind: "line",
    help: "Nitrogen gained or lost by the soil since today. Above zero means the soil is getting richer.",
    fmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} kg/ha`,
  },
  {
    key: "som_pct",
    label: "Soil organic matter",
    icon: Layers3,
    unit: "%",
    kind: "line",
    help: "How much organic matter is in the soil. More means it holds water and food better.",
    fmt: (v) => `${v.toFixed(2)}%`,
  },
];

const axisTick = { fontSize: 12, fill: "#475569" };

export default function PlanCharts({ strategies, selected }: { strategies: Strategy[]; selected: Strategy["id"] }) {
  const [metric, setMetric] = useState<Metric>("net_margin_usd_ha");
  const m = METRICS.find((x) => x.key === metric)!;
  const labels = strategies[0].seasons.map((s) => s.season_label);

  const data = labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of strategies) row[s.id] = s.seasons[i]?.metrics[metric as keyof SeasonMetrics] ?? 0;
    return row;
  });

  const tooltip = (
    <Tooltip
      cursor={{ fill: "#f1f5f9" }}
      formatter={(v, name) => [m.fmt(Number(v)), `Plan ${name}`]}
      labelFormatter={(l) => {
        const i = labels.indexOf(String(l));
        return `${l} — ${strategies.map((s) => `${s.id}: ${shortCrop(s.seasons[i]?.crop_name ?? "")}`).join(" · ")}`;
      }}
      contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
    />
  );
  const axes = [
    <CartesianGrid key="g" vertical={false} stroke="#e2e8f0" />,
    <XAxis key="x" dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />,
    <YAxis key="y" tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (metric === "net_margin_usd_ha" ? `${v < 0 ? "−" : ""}$${Math.abs(v)}` : String(v))} />,
  ];

  return (
    <section aria-labelledby="charts-h" className="card">
      <h2 id="charts-h" className="text-xl font-bold text-slate-900">
        Season by season
      </h2>
      <div role="tablist" aria-label="What to compare" className="mt-3 flex flex-wrap gap-2">
        {METRICS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={metric === key}
            onClick={() => setMetric(key)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-[15px] font-medium ${
              metric === key ? "border-leaf-700 bg-leaf-700 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
            }`}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-600">{m.help}</p>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700" aria-label="Legend">
        {strategies.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm" style={{ background: PLAN_COLOR[s.id], opacity: s.id === selected ? 1 : 0.55 }} aria-hidden />
            Plan {s.id}: {PLAN_SHORT[s.id]}
          </li>
        ))}
      </ul>

      <div className="mt-2 h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {m.kind === "bar" ? (
            <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }} barGap={2} barCategoryGap="24%">
              {axes}
              {metric === "net_margin_usd_ha" && <ReferenceLine y={0} stroke="#64748b" />}
              {tooltip}
              {strategies.map((s) => (
                <Bar key={s.id} dataKey={s.id} name={s.id} fill={PLAN_COLOR[s.id]} fillOpacity={s.id === selected ? 1 : 0.5} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
              {axes}
              {metric === "nitrogen_balance_kg_ha" && <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 4" />}
              {tooltip}
              {strategies.map((s) => (
                <Line
                  key={s.id}
                  type="linear"
                  dataKey={s.id}
                  name={s.id}
                  stroke={PLAN_COLOR[s.id]}
                  strokeWidth={s.id === selected ? 3 : 2}
                  strokeOpacity={s.id === selected ? 1 : 0.55}
                  dot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: PLAN_COLOR[s.id] }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-600">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Season</th>
                {strategies.map((s) => (
                  <th key={s.id} className="py-1.5 pr-3 font-medium">
                    Plan {s.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={label} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3">{label}</td>
                  {strategies.map((s) => (
                    <td key={s.id} className="py-1.5 pr-3 tabular-nums">
                      {shortCrop(s.seasons[i]?.crop_name ?? "")} · {m.fmt(Number(data[i][s.id]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
