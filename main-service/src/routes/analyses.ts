import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { Analysis } from "../models/Analysis";
import { Farm } from "../models/Farm";
import { predict } from "../services/agronomyClient";
import { explain } from "../services/gemini";
import type { Polygon, PredictRequest } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { analysisInputSchema, type AnalysisInput } from "./schemas";

const router = Router();
router.use(requireAuth);

/**
 * POST /api/analyses
 * Body: { farm_id, priority? } | { polygon, centroid?, current_crop, soil_type, priority }
 * Calls agronomy-engine → Gemini explainability → persists → returns the full analysis.
 */
router.post(
  "/",
  validateBody(analysisInputSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as AnalysisInput;
    let engineReq: PredictRequest;
    let farmId: string | undefined;

    if ("farm_id" in body) {
      const farm = await Farm.findOne({ _id: body.farm_id, owner: req.user!.id }).lean();
      if (!farm) throw HttpError.notFound("Farm not found");
      farmId = String(farm._id);
      engineReq = {
        polygon: farm.polygon,
        centroid: farm.centroid,
        current_crop: farm.currentCrop,
        soil_type: farm.soilType,
        priority: body.priority ?? farm.defaultPriority,
        area_ha: farm.areaHa,
        ...(body.planting_month ? { planting_month: body.planting_month } : {}),
      };
    } else {
      const polygon = body.polygon as Polygon;
      engineReq = {
        polygon,
        centroid: body.centroid ?? polygonCentroid(polygon),
        current_crop: body.current_crop,
        soil_type: body.soil_type,
        priority: body.priority,
        area_ha: Number(polygonAreaHa(polygon).toFixed(3)) || undefined,
        ...(body.planting_month ? { planting_month: body.planting_month } : {}),
      };
    }

    const prediction = await predict(engineReq);
    const explanation = await explain(prediction);

    const analysis = await Analysis.create({
      owner: req.user!.id,
      farm: farmId,
      request: engineReq,
      prediction,
      explanation,
      recommendedStrategy: prediction.recommended_strategy,
      climateSource: prediction.climate.source,
    });

    res.status(201).json({ id: analysis.id, prediction, explanation, createdAt: analysis.createdAt });
  }),
);

/** GET /api/analyses — summaries for the current user (?farm_id= to filter) */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { owner: req.user!.id };
    if (typeof req.query.farm_id === "string") filter.farm = req.query.farm_id;
    const analyses = await Analysis.find(filter)
      .select("farm recommendedStrategy climateSource createdAt request.current_crop request.priority")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ analyses });
  }),
);

/** GET /api/analyses/:id — full payload */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const analysis = await Analysis.findOne({ _id: req.params.id, owner: req.user!.id }).lean();
    if (!analysis) throw HttpError.notFound("Analysis not found");
    res.json({
      id: String(analysis._id),
      farm: analysis.farm,
      prediction: analysis.prediction,
      explanation: analysis.explanation,
      createdAt: analysis.createdAt,
    });
  }),
);

export default router;
