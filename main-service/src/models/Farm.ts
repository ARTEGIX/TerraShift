import { Schema, Types, model } from "mongoose";
import type { Polygon, Priority, SoilType } from "../types/contract";

export interface IFarm {
  owner: Types.ObjectId;
  name: string;
  polygon: Polygon;
  centroid: { lat: number; lon: number };
  areaHa: number;
  soilType: SoilType;
  currentCrop: string;
  defaultPriority: Priority;
  createdAt: Date;
  updatedAt: Date;
}

const farmSchema = new Schema<IFarm>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    polygon: {
      type: { type: String, enum: ["Polygon"], required: true },
      coordinates: { type: [[[Number]]], required: true },
    },
    centroid: {
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
    areaHa: { type: Number, required: true },
    soilType: { type: String, enum: ["clay", "loam", "sandy", "silt", "laterite"], required: true },
    currentCrop: { type: String, required: true },
    defaultPriority: { type: String, enum: ["cost", "water", "soil"], default: "soil" },
  },
  { timestamps: true },
);

farmSchema.index({ polygon: "2dsphere" });

export const Farm = model<IFarm>("Farm", farmSchema);
