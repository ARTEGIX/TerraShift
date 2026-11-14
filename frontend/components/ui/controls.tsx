"use client";

import { Check, CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";

/** A question with a big label, optional help and an inline error. */
export function Question({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="flex w-full items-center gap-2 text-base font-semibold text-slate-900">
        <span>{label}</span>
        {help && (
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            aria-label={`Help: ${label}`}
            className="ml-auto rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <CircleHelp className="size-5" aria-hidden />
          </button>
        )}
      </legend>
      {help && showHelp && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{help}</p>}
      {children}
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export interface CardOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  swatch?: string;
}

/** Large tap targets for a single choice (radio group). */
export function ChoiceCards<T extends string>({
  name,
  options,
  value,
  onChange,
  columns = "grid-cols-1 sm:grid-cols-2",
}: {
  name: string;
  options: CardOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: string;
}) {
  return (
    <div role="radiogroup" className={`grid gap-2.5 ${columns}`}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label
            key={o.value}
            className={`relative flex min-h-[4rem] cursor-pointer items-center gap-3 rounded-xl border-2 bg-white px-3.5 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-leaf-600 ${
              on ? "border-leaf-600 bg-leaf-50" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input type="radio" name={name} className="sr-only" checked={on} onChange={() => onChange(o.value)} />
            {o.swatch && <span aria-hidden className="size-10 shrink-0 rounded-lg ring-1 ring-black/10" style={{ background: o.swatch }} />}
            {o.icon && (
              <span aria-hidden className={`shrink-0 ${on ? "text-leaf-700" : "text-slate-500"}`}>
                {o.icon}
              </span>
            )}
            <span className="min-w-0 pr-4">
              <span className="block text-[15px] font-semibold leading-tight text-slate-900">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-sm leading-snug text-slate-600">{o.hint}</span>}
            </span>
            {on && <Check className="absolute right-2.5 top-2.5 size-5 text-leaf-700" aria-hidden />}
          </label>
        );
      })}
    </div>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Notice({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "warn" | "error" | "sample";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-800 ring-red-200",
    sample: "bg-violet-50 text-violet-900 ring-violet-200",
  };
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
