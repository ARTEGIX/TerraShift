import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { Farm } from "../models/Farm";
import type { Polygon } from "../types/contract";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import { polygonAreaHa, polygonCentroid } from "../utils/geo";
import { farmInputSchema, type FarmInput } from "./schemas";

const router = Router();
router.use(requireAuth);

/** GET /api/farms — current user's farms */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const farms = await Farm.find({ owner: req.user!.id }).sort({ createdAt: -1 }).lean();
    res.json({ farms });
  }),
);

/** POST /api/farms */
router.post(
  "/",
  validateBody(farmInputSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as FarmInput;
    const polygon = body.polygon as Polygon;
    const farm = await Farm.create({
      owner: req.user!.id,
      name: body.name,
      polygon,
      centroid: body.centroid ?? polygonCentroid(polygon),
      areaHa: Number(polygonAreaHa(polygon).toFixed(3)),
      soilType: body.soil_type,
      currentCrop: body.current_crop,
      defaultPriority: body.default_priority,
    });
    res.status(201).json({ farm });
  }),
);

/** GET /api/farms/:id */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const farm = await Farm.findOne({ _id: req.params.id, owner: req.user!.id }).lean();
    if (!farm) throw HttpError.notFound("Farm not found");
    res.json({ farm });
  }),
);

/** DELETE /api/farms/:id */
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await Farm.deleteOne({ _id: req.params.id, owner: req.user!.id });
    if (result.deletedCount === 0) throw HttpError.notFound("Farm not found");
    res.status(204).end();
  }),
);

export default router;
