"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import RiskPanel from "@/components/risk/RiskPanel";
import StrategyCard from "@/components/strategy/StrategyCard";
import { fetchAnalysis } from "@/lib/api";
import { MOCK_ANALYSIS } from "@/lib/mock";
import type { AnalysisRecord } from "@/lib/types";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "demo";
  const [record, setRecord] = useState<AnalysisRecord>(MOCK_ANALYSIS);

  useEffect(() => {
    fetchAnalysis(id).then(setRecord);
  }, [id]);

  const { prediction, explanation } = record;
  const notesById = Object.fromEntries(explanation.per_strategy.map((n) => [n.id, n]));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-leaf-700">
            NASA POWER ({prediction.climate.source}) · Lat {prediction.location.lat}°, Lon {prediction.location.lon}°
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-0.5">Field Shift Adaptation Report</h1>
        </div>
        <Link
          href="/farm"
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-white border border-soil-100 hover:bg-soil-50"
        >
          ← New Field Analysis
        </Link>
      </div>

      <section className="rounded-2xl bg-gradient-to-r from-leaf-900 to-leaf-700 text-white p-6 shadow">
        <div className="flex items-center justify-between text-xs text-white/75 mb-1">
          <span>✨ AI Agronomist Summary ({explanation.source})</span>
          <span>Recommended: Strategy {prediction.recommended_strategy}</span>
        </div>
        <p className="text-sm md:text-base leading-relaxed">{explanation.summary}</p>
      </section>

      <RiskPanel risk={prediction.risk} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Layer 2 — 3-Season Genetic Rotation Strategies</h2>
          <span className="text-xs text-slate-500">
            GA: pop {prediction.optimizer.population} × {prediction.optimizer.generations} generations
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {prediction.strategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              recommended={s.id === prediction.recommended_strategy}
              note={notesById[s.id]}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
