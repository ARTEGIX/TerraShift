import { Schema, model } from "mongoose";
import type { Polygon, Priority } from "../types/contract";

export interface IFarm {
  _id: string;
  owner?: string;
  name: string;
  region_id: string;
  soil_type: string;
  current_crop: string;
  planting_month?: number;
  default_priority: Priority;
  area_ha: number;
  centroid: { lat: number; lon: number };
  polygon: Polygon;
  created_at?: Date;
  updated_at?: Date;
}

const farmSchema = new Schema<IFarm>(
  {
    _id: { type: String, required: true },
    owner: { type: String, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    region_id: { type: String, default: "region_lk_dryzone" },
    soil_type: { type: String, required: true, default: "soil_clay_loam" },
    current_crop: { type: String, required: true },
    planting_month: { type: Number, min: 1, max: 12 },
    default_priority: { type: String, enum: ["cost", "water", "soil"], default: "water" },
    area_ha: { type: Number, required: true },
    centroid: {
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
    polygon: {
      type: { type: String, enum: ["Polygon"], required: true },
      coordinates: { type: [[[Number]]], required: true },
    },
  },
  {
    collection: "farms",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

farmSchema.index({ polygon: "2dsphere" }, { name: "idx_farms_polygon_2dsphere" });

export const Farm = model<IFarm>("Farm", farmSchema);
