import Redis from "ioredis";
import { env } from "../config/env";

/** Shared Redis client. All helpers fail soft so a Redis outage never breaks a request. */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on("ready", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.warn("Redis error:", err.message));

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
  } catch (err) {
    console.warn("Redis unavailable, continuing without cache:", (err as Error).message);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = env.CACHE_TTL_SECONDS): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    /* ignore */
  }
}

export function redisReady(): boolean {
  return redis.status === "ready";
}
