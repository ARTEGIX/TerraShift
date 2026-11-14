import mongoose from "mongoose";
import { env } from "../config/env";

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);
  mongoose.connection.on("connected", () => console.log("✅ MongoDB connected"));
  mongoose.connection.on("error", (err) => console.error("MongoDB error:", err.message));
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
}

export function mongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
