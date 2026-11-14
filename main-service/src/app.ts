import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { corsOrigins, env } from "./config/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import apiRouter from "./routes";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // behind nginx
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || corsOrigins.includes("*") || corsOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/", (_req, res) => {
    res.json({ service: "terrashift-main-service", docs: "/api/health" });
  });
  app.use("/api", apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
