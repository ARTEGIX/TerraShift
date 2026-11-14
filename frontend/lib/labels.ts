/**
 * Farmer-facing words for every enum in the API contract, plus number formatting.
 * Keep technical names (NDVI, AR(1), HHI…) out of the main UI; put them in "How we worked this out".
 */
import type { CropInfo, Priority, RiskLevel, SoilType } from "./types";

export const SOIL_OPTIONS: { value: SoilType; label: string; hint: string; color: string }[] = [
  { value: "clay", label: "Clay", hint: "Sticky when wet, cracks when dry", color: "#b5562f" },
  { value: "loam", label: "Loam", hint: "Soft, dark and crumbly", color: "#6b4a2b" },
  { value: "sandy", label: "Sandy", hint: "Gritty, water drains fast", color: "#e2c48a" },
  { value: "silt", label: "Silt", hint: "Smooth like flour, near rivers", color: "#a89276" },
  { value: "laterite", label: "Laterite (red soil)", hint: "Red or orange, hard when dry", color: "#c0471f" },
];

export const PRIORITY_OPTIONS: { value: Priority; label: string; hint: string }[] = [
  { value: "cost", label: "Earn more, spend less", hint: "Best profit for the money you put in" },
  { value: "water", label: "Save water", hint: "Grow well even in dry seasons" },
  { value: "soil", label: "Healthier soil", hint: "Richer soil for the years ahead" },
];

export const priorityLabel = (p: Priority | undefined) => PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? "—";
export const soilLabel = (s: SoilType | undefined) => SOIL_OPTIONS.find((o) => o.value === s)?.label ?? "—";

export const CATEGORY_LABEL: Record<CropInfo["category"], string> = {
  cash_crop: "Cash crop",
  legume: "Bean / pulse (adds nitrogen)",
  cover_crop: "Cover crop (feeds the soil)",
  drought_tolerant: "Handles dry weather",
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Common planting starts in Sri Lanka. The engine labels Sep–Feb starts as Maha. */
export const PLANTING_PRESETS = [
  { month: 10, label: "Maha season", hint: "Start in October" },
  { month: 4, label: "Yala season", hint: "Start in April" },
];

export const RISK_WORD: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };

export function riskBand(score: number): { word: string; tone: "good" | "warn" | "bad" } {
  if (score < 34) return { word: "Low", tone: "good" };
  if (score < 67) return { word: "Medium", tone: "warn" };
  return { word: "High", tone: "bad" };
}

/** "2026-04" → "Apr 2026" */
export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const usd = (n: number) => usdFmt.format(Math.round(n));
export const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usdFmt.format(Math.abs(Math.round(n)))}`;
export const mm = (n: number) => `${Math.round(n).toLocaleString("en-US")} mm`;
export const kg = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n))} kg/ha`;
export const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

/** Short crop name for tight spaces: "Sunn Hemp (cover crop)" → "Sunn Hemp". */
export const shortCrop = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");
