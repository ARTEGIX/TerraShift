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

export const soilTypeSchema = z.enum(["clay", "loam", "sandy", "silt", "laterite"]);
export const prioritySchema = z.enum(["cost", "water", "soil"]);

export const farmInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  polygon: polygonSchema,
  centroid: centroidSchema.optional(),
  soil_type: soilTypeSchema,
  current_crop: z.string().trim().min(1),
  default_priority: prioritySchema.default("soil"),
});

export const analysisInputSchema = z.union([
  // Analyse a saved farm
  z.object({
    farm_id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid farm_id"),
    priority: prioritySchema.optional(),
    planting_month: z.number().int().min(1).max(12).optional(),
  }),
  // Ad-hoc analysis (not tied to a saved farm)
  z.object({
    polygon: polygonSchema,
    centroid: centroidSchema.optional(),
    current_crop: z.string().trim().min(1),
    soil_type: soilTypeSchema,
    priority: prioritySchema,
    planting_month: z.number().int().min(1).max(12).optional(),
  }),
]);

export type FarmInput = z.infer<typeof farmInputSchema>;
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
