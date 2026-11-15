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
  planting_month: z.number().int().min(1).max(12).optional(),
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

export const farmPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  polygon: polygonSchema.optional(),
  centroid: centroidSchema.optional(),
  region_id: z.string().trim().optional(),
  soil_type: soilTypeSchema.optional(),
  current_crop: z.string().trim().min(1).optional(),
  default_priority: prioritySchema.optional(),
  planting_month: z.number().int().min(1).max(12).optional(),
}).refine((obj: Record<string, unknown>) => Object.keys(obj).length > 0, { message: "At least one field required" });

const strategyIdMap: Record<string, "A_BASELINE" | "B_SOIL_WATER_RESILIENCE" | "C_COST_MARKET_OPTIMIZED"> = {
  A: "A_BASELINE",
  B: "B_SOIL_WATER_RESILIENCE",
  C: "C_COST_MARKET_OPTIMIZED",
  A_BASELINE: "A_BASELINE",
  B_SOIL_WATER_RESILIENCE: "B_SOIL_WATER_RESILIENCE",
  C_COST_MARKET_OPTIMIZED: "C_COST_MARKET_OPTIMIZED",
};

export const projectCreateSchema = z.object({
  report_id: z.string().trim().min(1),
  selected_strategy: z
    .string()
    .trim()
    .transform((val: string) => strategyIdMap[val] ?? val)
    .pipe(z.enum(["A_BASELINE", "B_SOIL_WATER_RESILIENCE", "C_COST_MARKET_OPTIMIZED"])),
  name: z.string().trim().min(1).max(120),
});

export const projectPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  seasons: z.array(z.object({
    crop_id: z.string().trim().min(1),
    target_water_mm: z.number().positive().nullable().optional(),
    input_cost_usd_ha: z.number().nonnegative().nullable().optional(),
  })).length(3).optional(),
}).refine((obj: Record<string, unknown>) => Object.keys(obj).length > 0, { message: "At least one field required" });

export const projectRecalcSchema = z.object({
  seasons: z.array(z.object({
    crop_id: z.string().trim().min(1),
    target_water_mm: z.number().positive().nullable().optional(),
    input_cost_usd_ha: z.number().nonnegative().nullable().optional(),
  })).length(3),
});

export type FarmPatch = z.infer<typeof farmPatchSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ProjectRecalc = z.infer<typeof projectRecalcSchema>;
