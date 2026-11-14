import mongoose from "mongoose";
import { resolveGeneralMongoUri } from "../config/env";

export async function connectMongo(): Promise<void> {
  const uri = resolveGeneralMongoUri();
  if (!uri) {
    console.warn("⚠️ GENERAL_MONGO_URI / ATLAS_MONGO_URI not configured; running with in-memory fallback store.");
    return;
  }
  mongoose.set("strictQuery", true);
  mongoose.connection.on("connected", () => console.log("✅ MongoDB Atlas (general_db) connected"));
  mongoose.connection.on("error", (err) => console.error("MongoDB error:", err.message));
  try {
    await mongoose.connect(uri, { dbName: "general_db", serverSelectionTimeoutMS: 8_000 });
  } catch (err) {
    console.warn("⚠️ MongoDB Atlas unreachable, continuing in degraded mode:", (err as Error).message);
  }
}

export function mongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
