import { Router } from "express";
import { cacheGet, cacheSet } from "../db/redis";
import { listCrops } from "../services/agronomyClient";
import { asyncHandler } from "../utils/asyncHandler";
import analysesRouter from "./analyses";
import authRouter from "./auth";
import farmsRouter from "./farms";
import healthRouter from "./health";

const router = Router();

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/farms", farmsRouter);

// Primary endpoint requested by specification + REST collection aliases
router.use("/analyze", analysesRouter);
router.use("/simulation-runs", analysesRouter);
router.use("/analyses", analysesRouter);

/** GET /api/crops — public crop catalogue (proxied from agronomy-engine, cached 1h) */
router.get(
  "/crops",
  asyncHandler(async (_req, res) => {
    const cached = await cacheGet<unknown[]>("crops:v2");
    if (cached) return void res.json({ crops: cached });
    const crops = await listCrops();
    await cacheSet("crops:v2", crops, 3600);
    res.json({ crops });
  }),
);

export default router;
