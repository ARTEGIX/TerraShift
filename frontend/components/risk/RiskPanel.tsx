import type { RiskReport } from "@/lib/types";

export default function RiskPanel({ risk }: { risk: RiskReport }) {
  const cards = [
    {
      title: "Overall Risk Score",
      score: risk.overall_score,
      detail: "Weighted composite across climate & regional saturation",
    },
    {
      title: "Soil Moisture Deficit",
      score: risk.soil_moisture_deficit.score,
      detail: `Trend: ${risk.soil_moisture_deficit.trend} · ${risk.soil_moisture_deficit.cumulative_deficit_mm_12m} mm deficit (12m)`,
    },
    {
      title: "Heat Stress Risk",
      score: risk.heat_stress.score,
      detail: `${risk.heat_stress.months_over_threshold} mo > ${risk.heat_stress.threshold_c}°C (peak ${risk.heat_stress.peak_t2m_max_c}°C)`,
    },
    {
      title: "Regional Saturation",
      score: risk.regional_saturation.score,
      detail: `${risk.regional_saturation.crop_share_pct}% same crop · Oversupply: ${risk.regional_saturation.oversupply_risk ? "Yes" : "No"}`,
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900">Layer 1 — Environmental &amp; Regional Vulnerability</h2>
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
