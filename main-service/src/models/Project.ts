import { Schema, model } from "mongoose";
import type { StrategyId, SeasonMetrics } from "../types/contract";

export interface IProjectSeason {
  season_number: number; // 1 | 2 | 3
  season?: number;       // alias for UI compatibility
  season_label?: string; // e.g. "Season 1 (Maha)"
  crop_id: string;
  crop_name?: string;
  target_water_mm?: number;   // user override
  input_cost_usd_ha?: number; // user override
  metrics: SeasonMetrics;     // computed by engine
}

export interface IProject {
  _id: string;
  owner?: string;
  name: string;
  farm_id: string;
  report_id: string;
  selected_strategy: StrategyId;
  seasons: IProjectSeason[];
  totals: Record<string, number>;
  objectives: { f_soil: number; f_water: number; f_cost: number };
  warnings: string[];
  recalculation_count: number;
  created_at?: Date;
  updated_at?: Date;
}

const projectSeasonSchema = new Schema<IProjectSeason>(
  {
    season_number: { type: Number, required: true },
    season: { type: Number },
    season_label: { type: String },
    crop_id: { type: String, required: true },
    crop_name: { type: String },
    target_water_mm: { type: Number },
    input_cost_usd_ha: { type: Number },
    metrics: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const projectSchema = new Schema<IProject>(
  {
    _id: { type: String, required: true },
    owner: { type: String, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    farm_id: { type: String, required: true, index: true },
    report_id: { type: String, required: true, index: true },
    selected_strategy: {
      type: String,
      enum: ["A_BASELINE", "B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"],
      required: true,
    },
    seasons: { type: [projectSeasonSchema], required: true },
    totals: { type: Schema.Types.Mixed, required: true },
    objectives: { type: Schema.Types.Mixed, required: true },
    warnings: { type: [String], default: [] },
    recalculation_count: { type: Number, default: 0 },
  },
  {
    collection: "projects",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    minimize: false,
  }
);

projectSchema.index({ farm_id: 1, created_at: -1 }, { name: "idx_projects_farm_id" });
projectSchema.index({ report_id: 1 }, { name: "idx_projects_report_id" });

export const Project = model<IProject>("Project", projectSchema);
