import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { redisReady } from "../db/redis";
import { engineHealthy } from "../services/agronomyClient";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

/** Liveness — process is up (used by Docker HEALTHCHECK). */
router.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

/** Readiness — dependencies. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const deps = { mongo: mongoReady(), redis: redisReady(), agronomyEngine: await engineHealthy() };
    const ok = deps.mongo && deps.agronomyEngine; // Redis is optional (cache only)
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", service: "main-service", deps });
  }),
);

export default router;
