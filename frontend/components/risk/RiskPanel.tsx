import type { RiskReport } from "@/lib/types";

export default function RiskPanel({ risk }: { risk: RiskReport }) {
  const budgets = risk.season_water_budgets_mm?.map((b) => `${Math.round(b)} mm`).join(" / ") ?? "—";
  const cards = [
    {
      title: "Overall Risk Score",
      score: risk.overall_score,
      detail: `3-Season Water Budgets: ${budgets}`,
    },
    {
      title: "Soil Moisture & Oct Anomaly",
      score: risk.soil_moisture_deficit.score,
      detail: `Trend: ${risk.soil_moisture_deficit.trend} · Oct SMAP anomaly: ${risk.october_moisture_anomaly_pct >= 0 ? "+" : ""}${risk.october_moisture_anomaly_pct}%`,
    },
    {
      title: "Bare-Field Erosion Risk",
      score: risk.bare_field_erosion.score,
      detail: `K-factor ${risk.bare_field_erosion.soil_k_factor} · Bare months: ${risk.bare_field_erosion.bare_field_months.join(", ")}`,
    },
    {
      title: "Regional Saturation & Heat",
      score: risk.regional_saturation.current_crop_oversupplied ? 75 : risk.heat_stress.score,
      detail: `${risk.regional_saturation.region_id} · Oversupply penalty: -${risk.regional_saturation.oversupply_penalty_pct}%`,
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">Layer 1 — In-Memory Regression &amp; Vulnerability</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="bg-white rounded-xl border border-soil-100 p-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">{c.title}</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">
              {Math.round(c.score)}
              <span className="text-xs font-normal text-slate-400"> / 100</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{c.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
