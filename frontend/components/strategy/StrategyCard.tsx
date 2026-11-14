import type { Explanation, Strategy } from "@/lib/types";

interface Props {
  strategy: Strategy;
  recommended: boolean;
  note?: Explanation["per_strategy"][number];
}

export default function StrategyCard({ strategy, recommended, note }: Props) {
  const t = strategy.totals;
  const badgeLabel = strategy.short_id ?? strategy.id.split("_")[0];
  return (
    <div
      className={`rounded-2xl bg-white p-5 border shadow-sm flex flex-col justify-between ${
        recommended ? "border-2 border-leaf-600 ring-2 ring-leaf-100" : "border-soil-100"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-soil-100 text-soil-900">
            Strategy {badgeLabel} ({strategy.id})
          </span>
          {recommended && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-leaf-600 text-white">
              ★ Recommended
            </span>
          )}
        </div>
        <h3 className="mt-2 font-bold text-lg text-slate-900">{strategy.name}</h3>
        <p className="text-xs text-slate-600 mt-0.5">{strategy.description}</p>

        <ol className="mt-4 space-y-2 border-t border-b border-slate-100 py-3">
          {strategy.seasons.map((s) => (
            <li key={s.season} className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-500">{s.season_label}</span>
              <span className="font-semibold text-slate-900">{s.crop_name}</span>
              <span className="text-slate-500">${Math.round(s.metrics.net_margin_usd_ha)}/ha</span>
            </li>
          ))}
        </ol>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-50 p-2 rounded">
            <dt className="text-slate-500">3-Season Net Margin</dt>
            <dd className="font-bold text-slate-900">${Math.round(t.net_margin_usd_ha).toLocaleString()}/ha</dd>
          </div>
          <div className="bg-slate-50 p-2 rounded">
            <dt className="text-slate-500">Resilience Score</dt>
            <dd className="font-bold text-leaf-700">{Math.round(t.resilience_score)} / 100</dd>
          </div>
          <div className="bg-slate-50 p-2 rounded">
            <dt className="text-slate-500">Water Used / Deficit</dt>
            <dd className="font-semibold text-slate-800">
              {Math.round(t.water_use_mm)} / {Math.round(t.water_deficit_mm)} mm
            </dd>
          </div>
          <div className="bg-slate-50 p-2 rounded">
            <dt className="text-slate-500">Soil N / SOM Δ</dt>
            <dd className="font-semibold text-slate-800">
              {t.nitrogen_balance_kg_ha > 0 ? "+" : ""}
              {Math.round(t.nitrogen_balance_kg_ha)} kg · {t.som_delta_pct >= 0 ? "+" : ""}
              {t.som_delta_pct.toFixed(2)}%
            </dd>
          </div>
        </dl>

        {note && <p className="mt-3 text-xs text-slate-700 bg-leaf-50/70 p-2.5 rounded-lg">{note.why}</p>}
      </div>

      {strategy.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg">
          {strategy.warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
