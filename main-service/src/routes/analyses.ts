import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { validateBody } from "../middleware/validate";
import { Project } from "../models/Project";
import { SimulationRun, type ISimulationRun } from "../models/SimulationRun";
import { getSatelliteStatus, predict, prefetchSatellite } from "../services/agronomyClient";
import { explainSimulation } from "../services/llmExplainer";
import type { Polygon, PredictRequest } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { findFarmById } from "./farms";
import { deleteProjectsByReportIdFromMemory } from "./projects";
import { analyzeInputSchema, type AnalyzeInput } from "./schemas";

const router = Router();

interface StoredSimulation extends ISimulationRun {
  id: string;
}

const memoryRuns = new Map<string, StoredSimulation>();

export function deleteRunsByFarmIdFromMemory(farmId: string): void {
  for (const [id, r] of memoryRuns.entries()) {
    if (r.farm_id === farmId) memoryRuns.delete(id);
  }
}

export async function findRunById(id: string): Promise<StoredSimulation | null> {
  const mem = memoryRuns.get(id);
  if (mem) return mem;
  if (mongoReady()) {
    try {
      const doc = await SimulationRun.findById(id).lean<ISimulationRun>();
      if (doc) return { ...doc, id: String((doc as any)._id) } as StoredSimulation;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * POST /api/analyze (and POST /api/analyses, POST /api/simulation-runs)
 * 1. Resolves farm geofence (from `general_db.farms` if `farm_id` is passed, or inline polygon)
 * 2. Calls `http://agronomy-engine:8000/predict`
 * 3. Passes deterministic JSON output to `llmExplainer.ts` (Gemini with template fallback)
 * 4. Saves final simulation document to `general_db.simulation_runs`
 * 5. Returns `{ id, farm_id, prediction, explanation, createdAt }`
 */
router.post(
  "/",
  validateBody(analyzeInputSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as AnalyzeInput;
    let engineReq: PredictRequest;
    let farmId: string | undefined;

    if (!("polygon" in body)) {
      const farm = await findFarmById(body.farm_id);
      if (!farm) throw HttpError.notFound(`Farm '${body.farm_id}' not found`);
      farmId = farm._id;
      engineReq = {
        polygon: farm.polygon,
        centroid: farm.centroid,
        current_crop: farm.current_crop,
        soil_type: farm.soil_type,
        region_id: farm.region_id,
        priority: body.priority ?? farm.default_priority,
        area_ha: farm.area_ha,
        ...((body.planting_month ?? farm.planting_month) ? { planting_month: body.planting_month ?? farm.planting_month } : {}),
      };
    } else {
      const polygon = body.polygon as Polygon;
      farmId = body.farm_id;
      engineReq = {
        polygon,
        centroid: body.centroid ?? polygonCentroid(polygon),
        current_crop: body.current_crop,
        soil_type: body.soil_type,
        region_id: body.region_id,
        priority: body.priority,
        area_ha: Number(polygonAreaHa(polygon).toFixed(3)) || undefined,
        ...(body.planting_month ? { planting_month: body.planting_month } : {}),
      };
    }

    const prediction = await predict(engineReq);
    const explanation = await explainSimulation(prediction);

    const now = new Date();
    let runId: string = randomUUID();

    if (mongoReady()) {
      const doc = await SimulationRun.create({
        farm_id: farmId,
        request: engineReq,
        prediction,
        explanation,
        recommended_strategy: prediction.recommended_strategy,
        climate_source: prediction.climate.source,
      });
      runId = String(doc._id);
    } else {
      console.warn(`⚠️ [DEGRADED] MongoDB Atlas disconnected — saved simulation_run ${runId} in RAM only.`);
      memoryRuns.set(runId, {
        id: runId,
        farm_id: farmId,
        request: engineReq,
        prediction,
        explanation,
        recommended_strategy: prediction.recommended_strategy,
        climate_source: prediction.climate.source,
        created_at: now,
        updated_at: now,
      });
    }

    res.status(201).json({
      id: runId,
      farm_id: farmId ?? null,
      prediction,
      explanation,
      createdAt: now.toISOString(),
    });
  }),
);

/** GET /api/simulation-runs (and GET /api/analyses) */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const farmId = typeof req.query.farm_id === "string" ? req.query.farm_id : undefined;
    if (mongoReady()) {
      const filter = farmId ? { farm_id: farmId } : {};
      const runs = await SimulationRun.find(filter)
        .select("farm_id recommended_strategy climate_source created_at request.current_crop request.priority")
        .sort({ created_at: -1 })
        .limit(50)
        .lean();
      res.json({ simulation_runs: runs, analyses: runs });
      return;
    }
    const list = Array.from(memoryRuns.values()).filter((r) => !farmId || r.farm_id === farmId);
    res.json({ simulation_runs: list, analyses: list });
  }),
);

/** POST /api/analyses/prefetch — trigger non-blocking satellite prefetch for a coordinate */
router.post(
  "/prefetch",
  asyncHandler(async (req, res) => {
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw HttpError.badRequest("Valid lat and lon are required");
    }
    void prefetchSatellite(lat, lon);
    res.status(202).json({ ok: true });
  }),
);

/** GET /api/simulation-runs/:id/satellite-status */
router.get(
  "/:id/satellite-status",
  asyncHandler(async (req, res) => {
    const existing = await findRunById(req.params.id);
    if (!existing) throw HttpError.notFound(`Simulation run '${req.params.id}' not found`);
    const { lat, lon } = existing.prediction.location;
    const sat = await getSatelliteStatus(lat, lon);
    res.json({
      status: sat.status,
      climate_source: existing.prediction.climate.source,
    });
  }),
);

/** POST /api/simulation-runs/:id/upgrade — re-run with cached satellite data and update in place */
router.post(
  "/:id/upgrade",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = await findRunById(id);
    if (!existing) throw HttpError.notFound(`Simulation run '${id}' not found`);

    const { lat, lon } = existing.prediction.location;
    const sat = await getSatelliteStatus(lat, lon);
    if (sat.status !== "ready") {
      throw HttpError.conflict(`Satellite data is not ready yet (status: ${sat.status})`);
    }

    const prediction = await predict(existing.request);
    const explanation = await explainSimulation(prediction);
    const now = new Date();

    if (memoryRuns.has(id)) {
      const mem = memoryRuns.get(id)!;
      memoryRuns.set(id, {
        ...mem,
        prediction,
        explanation,
        recommended_strategy: prediction.recommended_strategy,
        climate_source: prediction.climate.source,
        updated_at: now,
      });
    }
    if (mongoReady()) {
      await SimulationRun.findByIdAndUpdate(id, {
        prediction,
        explanation,
        recommended_strategy: prediction.recommended_strategy,
        climate_source: prediction.climate.source,
      });
    }

    res.json({
      id,
      farm_id: existing.farm_id ?? null,
      prediction,
      explanation,
      createdAt: existing.created_at instanceof Date ? existing.created_at.toISOString() : String(existing.created_at),
    });
  }),
);

/** GET /api/simulation-runs/:id (and GET /api/analyses/:id) */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const mem = memoryRuns.get(id);
    if (mem) {
      res.json({
        id: mem.id,
        farm_id: mem.farm_id,
        prediction: mem.prediction,
        explanation: mem.explanation,
        createdAt: mem.created_at,
      });
      return;
    }
    if (mongoReady()) {
      const doc = await SimulationRun.findById(id).lean();
      if (doc) {
        res.json({
          id: String(doc._id),
          farm_id: doc.farm_id,
          prediction: doc.prediction,
          explanation: doc.explanation,
          createdAt: doc.created_at,
        });
        return;
      }
    }
    throw HttpError.notFound(`Simulation run '${id}' not found`);
  }),
);

/** DELETE /api/simulation-runs/:id — cascade deletes linked projects */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = await findRunById(id);
    if (!existing) throw HttpError.notFound("Simulation run not found");
    memoryRuns.delete(id);
    deleteProjectsByReportIdFromMemory(id);
    if (mongoReady()) {
      await Project.deleteMany({ report_id: id });
      await SimulationRun.deleteOne({ _id: id });
    }
    res.status(204).end();
  }),
);

export default router;
