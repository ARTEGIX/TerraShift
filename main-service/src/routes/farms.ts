import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { validateBody } from "../middleware/validate";
import { Farm, type IFarm } from "../models/Farm";
import type { Polygon } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { farmInputSchema, type FarmInput } from "./schemas";

const router = Router();

export const DEMO_FARM_FALLBACK: IFarm = {
  _id: "farm_demo_01",
  name: "Mahaweli Block-4 Demo Paddy Field",
  region_id: "region_lk_dryzone",
  soil_type: "soil_clay_loam",
  current_crop: "paddy_rice",
  default_priority: "water",
  area_ha: 2.45,
  centroid: { lat: 8.3114, lon: 80.4037 },
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [80.3987, 8.3064],
        [80.4087, 8.3064],
        [80.4087, 8.3164],
        [80.3987, 8.3164],
        [80.3987, 8.3064],
      ],
    ],
  },
};

const memoryFarms = new Map<string, IFarm>([[DEMO_FARM_FALLBACK._id, DEMO_FARM_FALLBACK]]);

export async function findFarmById(id: string): Promise<IFarm | null> {
  if (mongoReady()) {
    const doc = await Farm.findById(id).lean<IFarm>();
    if (doc) return doc;
  }
  return memoryFarms.get(id) ?? null;
}

/** GET /api/farms — list farms in general_db.farms */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    if (mongoReady()) {
      const farms = await Farm.find({}).sort({ updated_at: -1 }).lean();
      res.json({ farms: farms.length ? farms : Array.from(memoryFarms.values()) });
      return;
    }
    res.json({ farms: Array.from(memoryFarms.values()) });
  }),
);

/** POST /api/farms — create or upsert a farm in general_db.farms */
router.post(
  "/",
  validateBody(farmInputSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as FarmInput;
    const polygon = body.polygon as Polygon;
    const farmDoc: IFarm = {
      _id: body._id ?? `farm_${randomUUID().slice(0, 8)}`,
      name: body.name,
      region_id: body.region_id ?? "region_lk_dryzone",
      soil_type: body.soil_type,
      current_crop: body.current_crop,
      default_priority: body.default_priority,
      area_ha: Number(polygonAreaHa(polygon).toFixed(3)) || 1.0,
      centroid: body.centroid ?? polygonCentroid(polygon),
      polygon,
    };

    memoryFarms.set(farmDoc._id, farmDoc);
    if (mongoReady()) {
      await Farm.findByIdAndUpdate(farmDoc._id, farmDoc, { upsert: true, new: true });
    }
    res.status(201).json({ farm: farmDoc });
  }),
);

/** GET /api/farms/:id */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const farm = await findFarmById(req.params.id);
    if (!farm) throw HttpError.notFound(`Farm '${req.params.id}' not found`);
    res.json({ farm });
  }),
);

/** DELETE /api/farms/:id */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existedMem = memoryFarms.delete(req.params.id);
    let deletedDb = 0;
    if (mongoReady()) {
      const result = await Farm.deleteOne({ _id: req.params.id });
      deletedDb = result.deletedCount ?? 0;
    }
    if (!existedMem && deletedDb === 0) throw HttpError.notFound("Farm not found");
    res.status(204).end();
  }),
);

export default router;
