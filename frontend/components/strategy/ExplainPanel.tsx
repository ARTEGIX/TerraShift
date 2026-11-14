"use client";

import { ClipboardList, Lightbulb, ListChecks, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { mm, pct, usd } from "@/lib/labels";
import type { Explanation, Strategy } from "@/lib/types";
import { PLAN_COLOR, PLAN_SHORT } from "./StrategyCard";

function Box({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3 className="flex items-center gap-2.5 text-base font-bold text-slate-900">
        <span className={`grid size-9 place-items-center rounded-full ${tone}`} aria-hidden>
          {icon}
        </span>
        {title}
      </h3>
      <div className="mt-3 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

const List = ({ items, empty }: { items: string[]; empty: string }) =>
  items.length ? (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-slate-400">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  ) : (
    <p className="text-slate-500">{empty}</p>
  );

export default function ExplainPanel({
  strategy,
  note,
  areaHa,
}: {
  strategy: Strategy;
  note?: Explanation["per_strategy"][number];
  areaHa: number | null;
}) {
  const t = strategy.totals;
  // Gemini risks and engine warnings often overlap; show each once.
  const risks = [...new Set([...(note?.risks ?? []), ...strategy.warnings])];

  return (
    <section aria-labelledby="why-h" className="space-y-4">
      <h2 id="why-h" className="flex items-center gap-2.5 text-xl font-bold text-slate-900">
        <span className="grid size-8 place-items-center rounded-full text-sm font-bold text-white" style={{ background: PLAN_COLOR[strategy.id] }} aria-hidden>
          {strategy.id}
        </span>
        Why Plan {strategy.id}: {PLAN_SHORT[strategy.id]}?
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Box icon={<Lightbulb className="size-5" />} title="Why we suggest it" tone="bg-amber-100 text-amber-800">
          <p>{note?.why ?? strategy.description}</p>
        </Box>
        <Box icon={<ClipboardList className="size-5" />} title="Over 3 seasons" tone="bg-sky-100 text-sky-800">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Profit per ha</dt>
            <dd className="font-semibold text-slate-900">{usd(t.net_margin_usd_ha)}</dd>
            {areaHa ? (
              <>
                <dt className="text-slate-500">Profit for your field</dt>
                <dd className="font-semibold text-slate-900">{usd(t.net_margin_usd_ha * areaHa)}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Costs per ha</dt>
            <dd className="font-semibold text-slate-900">{usd(t.input_cost_usd_ha)}</dd>
            <dt className="text-slate-500">Water used</dt>
            <dd className="font-semibold text-slate-900">{mm(t.water_use_mm)}</dd>
            <dt className="text-slate-500">Water short by</dt>
            <dd className="font-semibold text-slate-900">{mm(t.water_deficit_mm)}</dd>
            <dt className="text-slate-500">Soil organic matter</dt>
            <dd className="font-semibold text-slate-900">{pct(t.som_delta_pct)}</dd>
          </dl>
        </Box>
        <Box icon={<TriangleAlert className="size-5" />} title="Watch out for" tone="bg-red-100 text-red-800">
          <List items={risks} empty="No special risks found for this plan." />
        </Box>
        <Box icon={<ListChecks className="size-5" />} title="First steps" tone="bg-emerald-100 text-emerald-800">
          <List items={note?.first_steps ?? []} empty="Talk to your local agrarian service centre before changing crops." />
        </Box>
      </div>
    </section>
  );
}
