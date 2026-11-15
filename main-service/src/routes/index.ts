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

/** GET /api/crops — public crop catalogue (proxied from agronomy-engine, cached 1h, optional ?region_id=...&refresh=1) */
router.get(
  "/crops",
  asyncHandler(async (req, res) => {
    const regionId = typeof req.query.region_id === "string" && req.query.region_id.trim() ? req.query.region_id.trim() : undefined;
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const cacheKey = regionId ? `crops:v2:${regionId}` : "crops:v2";
    if (!forceRefresh) {
      const cached = await cacheGet<unknown[]>(cacheKey);
      if (cached) return void res.json({ crops: cached });
    }
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
    const forceRefresh = Boolean(req.body?.force_refresh);
    const result = await ensureRegion(lat, lon, req.body?.polygon, forceRefresh);
    if (result) {
      res.json(result);
      return;
    }
    // Graceful fallback if agronomy-engine container is still restarting or unreachable
    const isMidwest = Math.abs(lat) >= 23.5;
    const viableCropIds = isMidwest
      ? ["maize", "soybean", "winter_wheat", "potato", "onion", "chickpea", "lentil", "sunflower", "crimson_clover"]
      : ["paddy_rice", "maize", "mung_bean", "cowpea", "groundnut", "finger_millet", "sesame", "cassava", "chilli", "onion", "sunn_hemp"];
    res.json({
      region_id: isMidwest ? "region_us_midwest" : "region_lk_dryzone",
      region_name: isMidwest ? "Temperate Agro-Zone" : "Tropical Dry & Intermediate Zone",
      country_iso2: isMidwest ? "US" : "LK",
      agro_zone: isMidwest ? "temperate" : "tropical_wet_dry",
      soil_id: "soil_clay_loam",
      soil_type: "soil_clay_loam",
      oversupplied_crops: isMidwest ? ["maize"] : ["paddy_rice", "maize", "onion"],
      dominant_pest_family: "poaceae",
      bare_field_months: isMidwest ? [11, 12, 1, 2, 3] : [3, 4, 8, 9],
      viable_crops_count: viableCropIds.length,
      viable_crop_ids: viableCropIds,
      cached: false,
    });
  }),
);

export default router;
