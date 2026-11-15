import { Router } from "express";
import { cacheGet, cacheSet } from "../db/redis";
import { ensureRegion, listCrops } from "../services/agronomyClient";
import { HttpError } from "../utils/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import analysesRouter from "./analyses";
import authRouter from "./auth";
import farmsRouter from "./farms";
import healthRouter from "./health";
import projectsRouter from "./projects";

const router = Router();

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/farms", farmsRouter);
router.use("/projects", projectsRouter);

// Primary endpoint requested by specification + REST collection aliases
router.use("/analyze", analysesRouter);
router.use("/simulation-runs", analysesRouter);
router.use("/analyses", analysesRouter);

/** GET /api/crops — public crop catalogue (proxied from agronomy-engine, cached 1h, optional ?region_id=...) */
router.get(
  "/crops",
  asyncHandler(async (req, res) => {
    const regionId = typeof req.query.region_id === "string" && req.query.region_id.trim() ? req.query.region_id.trim() : undefined;
    const cacheKey = regionId ? `crops:v2:${regionId}` : "crops:v2";
    const cached = await cacheGet<unknown[]>(cacheKey);
    if (cached) return void res.json({ crops: cached });
    const crops = await listCrops(regionId);
    await cacheSet(cacheKey, crops, 3600);
    res.json({ crops });
  }),
);

/** POST /api/regions/ensure — resolve & ingest regional soil, crop catalog & saturation for a geofence coordinate */
router.post(
  "/regions/ensure",
  asyncHandler(async (req, res) => {
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw HttpError.badRequest("Valid lat and lon are required");
    }
    const result = await ensureRegion(lat, lon, req.body?.polygon);
    if (!result) {
      throw HttpError.badGateway("Could not resolve regional lookup data");
    }
    res.json(result);
  }),
);

export default router;
