import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  ATLAS_MONGO_URI: z.string().optional().default(""),
  GENERAL_MONGO_URI: z.string().optional().default(""),
  MONGO_URI: z.string().optional().default(""),
  REDIS_URL: z.string().default("redis://redis-cache:6379"),
  AGRONOMY_ENGINE_URL: z.string().url().default("http://agronomy-engine:8000"),
  AGRONOMY_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-32chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(14).default(10),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function resolveGeneralMongoUri(): string {
  const candidates = [
    env.GENERAL_MONGO_URI,
    env.ATLAS_MONGO_URI ? `${env.ATLAS_MONGO_URI.replace(/\/$/, "")}/general_db?retryWrites=true&w=majority` : "",
    env.MONGO_URI,
  ];
  for (const c of candidates) {
    if (c && !c.includes("<username>") && !c.startsWith("/")) {
      return c;
    }
  }
  return "";
}

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
