import { Bean, CloudSun, Sprout, Wheat } from "lucide-react";
import type { CropInfo } from "@/lib/types";

const ICON: Record<CropInfo["category"], typeof Wheat> = {
  cash_crop: Wheat,
  legume: Bean,
  cover_crop: Sprout,
  drought_tolerant: CloudSun,
};

const TONE: Record<CropInfo["category"], string> = {
  cash_crop: "bg-amber-100 text-amber-900",
  legume: "bg-emerald-100 text-emerald-900",
  cover_crop: "bg-lime-100 text-lime-900",
  drought_tolerant: "bg-orange-100 text-orange-900",
};

export default function CropIcon({ category, size = "sm" }: { category: string; size?: "sm" | "md" }) {
  const cat = (category in ICON ? category : "cash_crop") as CropInfo["category"];
  const Icon = ICON[cat];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full ${TONE[cat]} ${size === "md" ? "size-10" : "size-7"}`}>
      <Icon className={size === "md" ? "size-5" : "size-4"} />
    </span>
  );
}
