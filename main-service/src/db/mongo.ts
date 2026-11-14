import mongoose from "mongoose";
import { resolveGeneralMongoUri } from "../config/env";

function maskUri(uri: string): string {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

export async function connectMongo(): Promise<void> {
  const uri = resolveGeneralMongoUri();
  if (!uri) {
    console.warn(
      "⚠️ [DEGRADED] GENERAL_MONGO_URI / ATLAS_MONGO_URI is not configured — running in-memory fallback (data will NOT persist to Atlas).",
    );
    return;
  }

  console.log(`🔌 Connecting to MongoDB Atlas (general_db): ${maskUri(uri)}`);
  mongoose.set("strictQuery", true);
  mongoose.connection.on("connected", () => console.log("✅ MongoDB Atlas (general_db) connected"));
  mongoose.connection.on("disconnected", () => console.warn("⚠️ MongoDB Atlas (general_db) disconnected"));
  mongoose.connection.on("error", (err) => console.error("❌ MongoDB Atlas error:", err.message));

  try {
    await mongoose.connect(uri, { dbName: "general_db", serverSelectionTimeoutMS: 8_000 });
  } catch (err) {
    console.error(
      `❌ [DB CONNECTION FAILED] Could not connect to MongoDB Atlas (general_db): ${(err as Error).message}\n` +
        "   ↳ Running in DEGRADED in-memory mode. Check:\n" +
        "     1. MongoDB Atlas → Network Access → Add your local IP (or 0.0.0.0/0 for dev)\n" +
        "     2. ATLAS_MONGO_URI username/password in root .env\n" +
        "     3. Local Docker DNS / VPN blocking mongodb+srv:// SRV lookups",
    );
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
