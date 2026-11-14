import { Schema, Types, model } from "mongoose";
import type { Explanation, PredictRequest, PredictResponse, StrategyId } from "../types/contract";

export interface IAnalysis {
  owner: Types.ObjectId;
  farm?: Types.ObjectId;
  request: PredictRequest;
  prediction: PredictResponse;
  explanation: Explanation;
  recommendedStrategy: StrategyId;
  climateSource: "nasa_power" | "fallback";
  createdAt: Date;
  updatedAt: Date;
}

const analysisSchema = new Schema<IAnalysis>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    farm: { type: Schema.Types.ObjectId, ref: "Farm", index: true },
    request: { type: Schema.Types.Mixed, required: true },
    prediction: { type: Schema.Types.Mixed, required: true },
    explanation: { type: Schema.Types.Mixed, required: true },
    recommendedStrategy: { type: String, enum: ["A", "B", "C"], required: true },
    climateSource: { type: String, enum: ["nasa_power", "fallback"], required: true },
  },
  { timestamps: true, minimize: false },
);

analysisSchema.index({ owner: 1, createdAt: -1 });

export const Analysis = model<IAnalysis>("Analysis", analysisSchema);
