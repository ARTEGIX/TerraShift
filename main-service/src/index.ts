import { createApp } from "./app";
import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./db/mongo";
import { connectRedis, redis } from "./db/redis";

async function main() {
  await Promise.all([connectMongo(), connectRedis()]);

  const server = createApp().listen(env.PORT, () => {
    console.log(`🚜 main-service listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    server.close();
    await Promise.allSettled([disconnectMongo(), redis.quit()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
