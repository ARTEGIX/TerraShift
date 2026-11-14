"use client";

import { Check, CloudRain, Satellite, Sprout } from "lucide-react";
import { useEffect, useState } from "react";

/** A satellite circling a field with a growing sprout and falling rain. Decorative only. */
export function FieldOrbit({ size = "lg" }: { size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-44" : "size-24";
  const field = size === "lg" ? "size-24" : "size-14";
  const sprout = size === "lg" ? "size-12" : "size-7";
  const sat = size === "lg" ? "size-7" : "size-5";
  return (
    <div className={`relative ${box}`} aria-hidden>
      {/* orbit path */}
      <div className="absolute inset-0 rounded-full border border-dashed border-leaf-600/25" />
      {/* satellite: the ring rotates, the icon counter-rotates to stay upright */}
      <div className="absolute inset-0 animate-orbit">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1.5 shadow-soft">
          <Satellite className={`${sat} animate-orbit-counter text-sky-600`} />
        </div>
      </div>
      {/* the field */}
      <div className={`absolute left-1/2 top-1/2 ${field} -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-gradient-to-b from-sky-100 to-leaf-100`}>
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-soil-100" />
        {/* rain */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute top-2 h-2 w-0.5 animate-drop rounded-full bg-sky-500"
            style={{ left: `${28 + i * 22}%`, animationDelay: `${i * 0.45}s` }}
          />
        ))}
        <div className="absolute bottom-[22%] left-1/2 -translate-x-1/2">
          <Sprout className={`${sprout} origin-bottom animate-grow text-leaf-600`} />
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Satellite, text: "Reading NASA satellite records for your field" },
  { icon: CloudRain, text: "Checking rain, heat and dry months ahead" },
  { icon: Sprout, text: "Trying thousands of crop rotations" },
  { icon: Check, text: "Writing your plan in simple words" },
];

/**
 * Full-screen loader while the analysis runs (usually 10–60 s).
 * Steps advance on a timer: the API is a single request, so this shows progress, not exact stages.
 */
export function AnalysisLoader({ title = "Making your plan" }: { title?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 5500);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-canvas/90 px-6 backdrop-blur-xl"
      role="status"
      aria-live="polite"
      aria-label={`${title}. ${STEPS[step].text}`}
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <FieldOrbit />
        <h2 className="mt-8 text-[28px] font-bold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 text-[17px] text-ink-3">This takes about a minute.</p>

        <ol className="mt-8 w-full space-y-3 text-left">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={s.text}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition ${
                  active ? "bg-white shadow-soft" : ""
                } ${i > step ? "opacity-40" : ""}`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full ${
                    done ? "bg-leaf-600 text-white" : active ? "bg-leaf-50 text-leaf-700" : "bg-black/[0.05] text-ink-3"
                  }`}
                >
                  {done ? <Check className="size-4" /> : <s.icon className={`size-4 ${active ? "animate-pulse-soft" : ""}`} />}
                </span>
                <span className={`text-[15px] ${active ? "font-semibold text-ink" : "text-ink-2"}`}>{s.text}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 text-[13px] text-ink-4">Please keep this page open.</p>
      </div>
    </div>
  );
}

/** Small in-page loader for opening reports and lists. */
export function PageLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5 px-6 text-center" role="status">
      <FieldOrbit size="sm" />
      <p className="text-[17px] text-ink-3">{label}</p>
    </div>
  );
}
