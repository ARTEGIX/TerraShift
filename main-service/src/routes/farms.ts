import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { validateBody } from "../middleware/validate";
import { Farm, type IFarm } from "../models/Farm";
import { Project } from "../models/Project";
import { SimulationRun } from "../models/SimulationRun";
import type { Polygon } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { deleteRunsByFarmIdFromMemory } from "./analyses";
import { deleteProjectsByFarmIdFromMemory } from "./projects";
import { farmInputSchema, farmPatchSchema, type FarmInput, type FarmPatch } from "./schemas";

const router = Router();

export const DEMO_FARM_FALLBACK: IFarm = {
  _id: "farm_demo_01",
  name: "Mahaweli Block-4 Demo Paddy Field",
  region_id: "region_lk_dryzone",
  soil_type: "soil_clay_loam",
  current_crop: "paddy_rice",
  planting_month: 10,
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

/** GET /api/farms — list farms with reports_count and projects_count */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    if (mongoReady()) {
      const farms = await Farm.find({}).sort({ updated_at: -1 }).lean<IFarm[]>();
      const farmIds = farms.map((f: IFarm) => f._id);
      const [runCounts, projectCounts] = await Promise.all([
        SimulationRun.aggregate([
          { $match: { farm_id: { $in: farmIds } } },
          { $group: { _id: "$farm_id", count: { $sum: 1 } } },
        ]),
        Project.aggregate([
          { $match: { farm_id: { $in: farmIds } } },
          { $group: { _id: "$farm_id", count: { $sum: 1 } } },
        ]),
      ]);
      const runCountMap = Object.fromEntries(runCounts.map((r: any) => [r._id, r.count]));
      const projectCountMap = Object.fromEntries(projectCounts.map((r: any) => [r._id, r.count]));
      const farmsWithCounts = farms.map((f: IFarm) => ({
        ...f,
        reports_count: runCountMap[f._id] ?? 0,
        projects_count: projectCountMap[f._id] ?? 0,
      }));
      res.json({ farms: farmsWithCounts.length ? farmsWithCounts : Array.from(memoryFarms.values()).map((f: IFarm) => ({ ...f, reports_count: 0, projects_count: 0 })) });
      return;
    }
    res.json({ farms: Array.from(memoryFarms.values()).map((f: IFarm) => ({ ...f, reports_count: 0, projects_count: 0 })) });
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
      ...(body.planting_month !== undefined && { planting_month: body.planting_month }),
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

/** GET /api/farms/:id — with linked report summaries and project counts */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const farm = await findFarmById(req.params.id);
    if (!farm) throw HttpError.notFound(`Farm '${req.params.id}' not found`);

    if (mongoReady()) {
      const [reports, totalReportsCount, totalProjectsCount] = await Promise.all([
        SimulationRun.find({ farm_id: farm._id })
          .select("_id recommended_strategy climate_source created_at request.current_crop")
          .sort({ created_at: -1 })
          .limit(50)
          .lean(),
        SimulationRun.countDocuments({ farm_id: farm._id }),
        Project.countDocuments({ farm_id: farm._id }),
      ]);

      const reportIds = reports.map((r: any) => String(r._id));
      const projectCounts = await Project.aggregate([
        { $match: { report_id: { $in: reportIds } } },
        { $group: { _id: "$report_id", count: { $sum: 1 } } },
      ]);
      const projectCountMap = Object.fromEntries(projectCounts.map((r: any) => [r._id, r.count]));

      const reportsWithCounts = reports.map((r: any) => ({
        id: String(r._id),
        _id: String(r._id),
        recommended_strategy: r.recommended_strategy,
        climate_source: r.climate_source,
        created_at: r.created_at,
        current_crop: (r.request as any)?.current_crop,
        projects_count: projectCountMap[String(r._id)] ?? 0,
      }));

      res.json({
        farm: {
          ...farm,
          reports_count: totalReportsCount,
          projects_count: totalProjectsCount,
        },
        reports: reportsWithCounts,
      });
      return;
    }

    res.json({ farm: { ...farm, reports_count: 0, projects_count: 0 }, reports: [] });
  }),
);

/** PATCH /api/farms/:id — update editable fields, cascade-delete SimulationRun + Project */
router.patch(
  "/:id",
  validateBody(farmPatchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as FarmPatch;
    const existing = await findFarmById(req.params.id);
    if (!existing) throw HttpError.notFound(`Farm '${req.params.id}' not found`);

    // Recalculate area_ha and centroid if polygon changed
    let areaHa = existing.area_ha;
    let centroid = existing.centroid;
    if (body.polygon) {
      areaHa = Number(polygonAreaHa(body.polygon as Polygon).toFixed(3)) || existing.area_ha;
      centroid = body.centroid ?? polygonCentroid(body.polygon as Polygon);
    }

    const updated: IFarm = {
      ...existing,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.region_id !== undefined && { region_id: body.region_id }),
      ...(body.soil_type !== undefined && { soil_type: body.soil_type }),
      ...(body.current_crop !== undefined && { current_crop: body.current_crop }),
      ...(body.default_priority !== undefined && { default_priority: body.default_priority }),
      ...(body.planting_month !== undefined && { planting_month: body.planting_month }),
      ...(body.polygon !== undefined && { polygon: body.polygon as Polygon }),
      area_ha: areaHa,
      centroid: body.centroid ?? centroid,
    };

    // Cascade delete all simulation_runs and projects for this farm
    if (mongoReady()) {
      await SimulationRun.deleteMany({ farm_id: req.params.id });
      await Project.deleteMany({ farm_id: req.params.id });
      await Farm.findByIdAndUpdate(req.params.id, updated, { new: true });
    }
    deleteRunsByFarmIdFromMemory(req.params.id);
    deleteProjectsByFarmIdFromMemory(req.params.id);
    memoryFarms.set(req.params.id, updated);

    res.json({ farm: updated });
  }),
);

/** DELETE /api/farms/:id — cascade-delete SimulationRun + Project + Farm */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await findFarmById(req.params.id);
    if (!existing) throw HttpError.notFound("Farm not found");
    memoryFarms.delete(req.params.id);
    deleteRunsByFarmIdFromMemory(req.params.id);
    deleteProjectsByFarmIdFromMemory(req.params.id);
    if (mongoReady()) {
      await SimulationRun.deleteMany({ farm_id: req.params.id });
      await Project.deleteMany({ farm_id: req.params.id });
      await Farm.deleteOne({ _id: req.params.id });
    }
    res.status(204).end();
  }),
);

export default router;
