"use client";

import { ChevronDown, Lightbulb, ListChecks, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cleanText, mm, pct, usd } from "@/lib/labels";
import { letterOf, type Explanation, type Strategy } from "@/lib/types";
import { CropSequence, PLAN_COLOR, PLAN_SHORT, SignalList, signalsFor } from "./StrategyCard";

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-black/[0.06] pt-5">
      <h4 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="text-ink-3" aria-hidden>
          {icon}
        </span>
        {title}
      </h4>
      <div className="mt-2 text-[17px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="space-y-1.5">
    {items.map((t) => (
      <li key={t} className="flex gap-2.5">
        <span className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
        <span>{t}</span>
      </li>
    ))}
  </ul>
);

/** One plan, explained: what changes, why, what to watch, first steps. Numbers stay folded away. */
export default function ExplainPanel({
  strategy,
  baseline,
  note,
  areaHa,
}: {
  strategy: Strategy;
  baseline: Strategy;
  note?: Explanation["per_strategy"][number];
  areaHa: number | null;
}) {
  const t = strategy.totals;
  const risks = [...new Set([...(note?.risks ?? []), ...strategy.warnings.map(cleanText)])];
  const steps = note?.first_steps?.length ? note.first_steps : ["Talk to your local agrarian service centre before changing crops."];

  return (
    <article className="card animate-fade-up space-y-5" aria-labelledby="detail-h">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full text-[17px] font-bold text-white" style={{ background: PLAN_COLOR[letterOf(strategy)] }} aria-hidden>
          {letterOf(strategy)}
        </span>
        <h3 id="detail-h" className="text-[22px] font-bold tracking-tight text-ink">
          {PLAN_SHORT[letterOf(strategy)]}
        </h3>
      </header>

      <CropSequence strategy={strategy} withSeason />
      <SignalList signals={signalsFor(strategy, baseline)} />

      <Section icon={<Lightbulb className="size-4" />} title="Why this plan">
        <p>{note?.why ?? strategy.description}</p>
      </Section>

      {risks.length > 0 && (
        <Section icon={<TriangleAlert className="size-4" />} title="Watch out for">
          <Bullets items={risks} />
        </Section>
      )}

      <Section icon={<ListChecks className="size-4" />} title="First steps">
        <Bullets items={steps} />
      </Section>

      <details className="group border-t border-black/[0.06] pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-medium text-leaf-700">
          See the numbers
          <ChevronDown className="size-5 transition group-open:rotate-180" aria-hidden />
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[15px]">
          <dt className="text-ink-3">Profit per hectare</dt>
          <dd className="text-right font-semibold text-ink">{usd(t.net_margin_usd_ha)}</dd>
          {areaHa ? (
            <>
              <dt className="text-ink-3">Profit for your field</dt>
              <dd className="text-right font-semibold text-ink">{usd(t.net_margin_usd_ha * areaHa)}</dd>
            </>
          ) : null}
          <dt className="text-ink-3">Costs per hectare</dt>
          <dd className="text-right font-semibold text-ink">{usd(t.input_cost_usd_ha)}</dd>
          <dt className="text-ink-3">Water used</dt>
          <dd className="text-right font-semibold text-ink">{mm(t.water_use_mm)}</dd>
          <dt className="text-ink-3">Water still short</dt>
          <dd className="text-right font-semibold text-ink">{mm(t.water_deficit_mm)}</dd>
          <dt className="text-ink-3">Soil organic matter</dt>
          <dd className="text-right font-semibold text-ink">{pct(t.som_delta_pct)}</dd>
          <dt className="text-ink-3">Climate resilience</dt>
          <dd className="text-right font-semibold text-ink">{Math.round(t.resilience_score)}/100</dd>
        </dl>
        <p className="mt-2 text-[13px] text-ink-4">3 seasons, US dollars, regional average prices.</p>
      </details>
    </article>
  );
}
