import { randomUUID } from "node:crypto";
import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { validateBody } from "../middleware/validate";
import { SimulationRun, type ISimulationRun } from "../models/SimulationRun";
import { predict } from "../services/agronomyClient";
import { explainSimulation } from "../services/llmExplainer";
import type { Polygon, PredictRequest } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { findFarmById } from "./farms";
import { analyzeInputSchema, type AnalyzeInput } from "./schemas";

const router = Router();

interface StoredSimulation extends ISimulationRun {
  id: string;
}

const memoryRuns = new Map<string, StoredSimulation>();

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
        ...(body.planting_month ? { planting_month: body.planting_month } : {}),
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

export default router;
