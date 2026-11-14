import { z } from "zod";

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const polygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(position).min(4)).min(1),
  })
  .refine(
    (p) => {
      const ring = p.coordinates[0];
      const [f, l] = [ring[0], ring[ring.length - 1]];
      return f[0] === l[0] && f[1] === l[1];
    },
    { message: "Polygon outer ring must be closed (first == last position)" },
  );

export const centroidSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const soilTypeSchema = z.enum([
  "soil_sandy_loam",
  "soil_clay_loam",
  "soil_degraded_dry",
  "clay",
  "loam",
  "sandy",
  "silt",
  "laterite",
]);

export const prioritySchema = z.enum(["cost", "water", "soil"]);

export const farmInputSchema = z.object({
  _id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  polygon: polygonSchema,
  centroid: centroidSchema.optional(),
  region_id: z.string().trim().optional().default("region_lk_dryzone"),
  soil_type: soilTypeSchema.default("soil_clay_loam"),
  current_crop: z.string().trim().min(1),
  default_priority: prioritySchema.default("water"),
});

export const analyzeInputSchema = z.union([
  // Analyse a saved farm from general_db.farms (e.g., "farm_demo_01")
  z.object({
    farm_id: z.string().trim().min(1),
    priority: prioritySchema.optional(),
    planting_month: z.number().int().min(1).max(12).optional(),
  }),
  // Ad-hoc geofence analysis
  z.object({
    farm_id: z.string().trim().optional(),
    polygon: polygonSchema,
    centroid: centroidSchema.optional(),
    current_crop: z.string().trim().min(1),
    soil_type: soilTypeSchema.default("soil_clay_loam"),
    region_id: z.string().trim().optional(),
    priority: prioritySchema.default("water"),
    planting_month: z.number().int().min(1).max(12).optional(),
  }),
]);

export type FarmInput = z.infer<typeof farmInputSchema>;
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
