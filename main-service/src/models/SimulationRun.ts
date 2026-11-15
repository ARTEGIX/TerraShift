import { Schema, model } from "mongoose";
import type { Explanation, PredictRequest, PredictResponse, StrategyId } from "../types/contract";

export interface ISimulationRun {
  farm_id?: string;
  owner?: string;
  request: PredictRequest;
  prediction: PredictResponse;
  explanation: Explanation;
  recommended_strategy: StrategyId;
  climate_source: "nasa_power" | "nasa_power+appeears" | "fallback";
  created_at: Date;
  updated_at: Date;
}

const simulationRunSchema = new Schema<ISimulationRun>(
  {
    farm_id: { type: String, index: true },
    owner: { type: String, index: true },
    request: { type: Schema.Types.Mixed, required: true },
    prediction: { type: Schema.Types.Mixed, required: true },
    explanation: { type: Schema.Types.Mixed, required: true },
    recommended_strategy: {
      type: String,
      enum: ["A_BASELINE", "B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"],
      required: true,
    },
    climate_source: { type: String, enum: ["nasa_power", "nasa_power+appeears", "fallback"], required: true },
  },
  {
    collection: "simulation_runs",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    minimize: false,
  },
);

simulationRunSchema.index({ farm_id: 1, created_at: -1 }, { name: "idx_simulation_runs_farm_id" });

export const SimulationRun = model<ISimulationRun>("SimulationRun", simulationRunSchema);
