"use client";

import { ChevronDown, ChevronUp, Layers, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BASE_LAYERS, NASA_LAYERS, type BaseLayerKey, type NasaLayer } from "@/lib/layers";

export interface MapView {
  base: BaseLayerKey;
  overlay: string | null;
  opacity: number;
  /** YYYY-MM-DD or null for the latest image. */
  date: string | null;
  showLabels: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
function shift(date: string | null, days: number) {
  const d = date ? new Date(`${date}T00:00:00Z`) : new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const chip =
  "inline-flex items-center rounded-full border px-2 sm:px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs font-medium transition-colors";
const chipOn = "border-leaf-700 bg-leaf-700 text-white";
const chipOff = "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

function DateControls({ layer, view, onChange }: { layer: NasaLayer; view: MapView; onChange: (p: Partial<MapView>) => void }) {
  if (layer.period === "static") return <p className="text-[11px] sm:text-xs text-slate-500">This layer doesn&apos;t change over time.</p>;
  const step = layer.period === "monthly" ? 30 : layer.period === "16day" ? 16 : 1;
  return (
    <div className="space-y-1.5 sm:space-y-2">
      <label className="flex items-center gap-2 text-[11px] sm:text-xs font-medium text-slate-600">
        Date
        <input
          type="date"
          min={layer.minDate}
          max={today()}
          value={view.date ?? ""}
          onChange={(e) => onChange({ date: e.target.value || null })}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 sm:px-2 sm:py-1 text-[11px] sm:text-xs"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={`${chip} ${view.date === null ? chipOn : chipOff}`} onClick={() => onChange({ date: null })}>
          Latest
        </button>
        <button type="button" className={`${chip} ${chipOff}`} onClick={() => onChange({ date: shift(view.date, -step) })}>
          ← Earlier
        </button>
        <button type="button" className={`${chip} ${chipOff}`} onClick={() => onChange({ date: shift(view.date, -365) })}>
          1 year ago
        </button>
      </div>
      <p className="text-[10px] sm:text-[11px] leading-snug text-slate-500">
        {view.date === null ? "Showing the newest image." : "Map empty? There may be no image for that day. Try another date."}
        {layer.key === "water_storage" && " Groundwater images on this service stop in mid-2022."}
      </p>
    </div>
  );
}

export default function LayerPanel({
  view,
  onChange,
  compact,
  drawSignal,
}: {
  view: MapView;
  onChange: (patch: Partial<MapView>) => void;
  compact?: boolean;
  drawSignal?: number;
}) {
  const [open, setOpen] = useState(() => !compact && typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const active = NASA_LAYERS.find((l) => l.key === view.overlay) ?? null;

  // Auto-close when drawing begins so user can draw freely
  useEffect(() => {
    if (drawSignal) setOpen(false);
  }, [drawSignal]);

  return (
    <div
      className={`absolute right-3 top-14 sm:top-3 z-[1000] text-slate-800 transition-all ${
        open
          ? "w-[min(15.5rem,calc(100vw-2.5rem))] sm:w-[min(19rem,calc(100cqw-4.5rem))]"
          : "w-auto max-w-[calc(100%-4.5rem)] sm:w-[min(19rem,calc(100cqw-4.5rem))]"
      }`}
    >
      <div className="rounded-xl bg-white/95 shadow-lg ring-1 ring-black/5 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2.5 text-xs sm:text-sm font-semibold"
        >
          <Layers className="size-4 text-leaf-700 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">NASA satellite layers{active ? ` · ${active.label}` : ""}</span>
          {open ? <ChevronUp className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
        </button>

        {open && (
          <div className="max-h-[min(19rem,calc(100cqh-5.5rem))] sm:max-h-[calc(100cqh-5rem)] space-y-2 sm:space-y-3 overflow-y-auto border-t border-slate-200 px-2.5 pb-2.5 pt-2 sm:px-3 sm:pb-3">
            <div className="flex gap-1">
              {(Object.keys(BASE_LAYERS) as BaseLayerKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={view.base === k}
                  onClick={() => onChange({ base: k })}
                  className={`${chip} flex-1 justify-center ${view.base === k ? chipOn : chipOff}`}
                >
                  {BASE_LAYERS[k].label}
                </button>
              ))}
              {view.base === "satellite" && (
                <button
                  type="button"
                  aria-pressed={view.showLabels}
                  onClick={() => onChange({ showLabels: !view.showLabels })}
                  className={`${chip} ${view.showLabels ? chipOn : chipOff}`}
                >
                  Names
                </button>
              )}
            </div>

            <fieldset className="space-y-0.5">
              <legend className="mb-0.5 sm:mb-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-500">Show on map</legend>
              {[{ key: null, label: "Nothing extra", mission: "", resolution: "" } as const, ...NASA_LAYERS].map((l) => (
                <label key={l.key ?? "none"} className="flex cursor-pointer items-start gap-1.5 sm:gap-2 rounded px-1.5 py-0.5 sm:py-1 hover:bg-slate-100">
                  <input
                    type="radio"
                    name="overlay"
                    checked={view.overlay === l.key}
                    onChange={() => onChange({ overlay: l.key })}
                    className="mt-0.5 size-3.5 sm:size-4 accent-leaf-700 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs sm:text-sm font-medium leading-snug">{l.label}</span>
                    {l.mission && (
                      <span className="block text-[10px] sm:text-[11px] leading-tight text-slate-500">
                        {l.mission} · {l.resolution}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>

            {active && (
              <div className="space-y-2 sm:space-y-3 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
                <p className="text-[11px] sm:text-xs leading-snug text-slate-700">{active.description}</p>
                {active.legend && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={active.legend} alt={`${active.label} colour scale`} className="w-full max-h-10 object-contain sm:max-h-none" />
                )}
                <label className="flex items-center gap-2 text-[11px] sm:text-xs font-medium text-slate-600">
                  See-through
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={view.opacity}
                    onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                    className="flex-1 accent-leaf-700"
                  />
                  <span className="w-7 sm:w-8 text-right tabular-nums text-[11px] sm:text-xs">{Math.round(view.opacity * 100)}%</span>
                </label>
                <DateControls layer={active} view={view} onChange={onChange} />
              </div>
            )}

            <div className="pt-1 border-t border-slate-200 sm:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-lg bg-slate-100 py-1 text-center text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
