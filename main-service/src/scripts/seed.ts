import Redis from "ioredis";
import mongoose from "mongoose";
import { env } from "../config/env";
import { connectMongo, disconnectMongo, mongoReady } from "../db/mongo";
import { Farm } from "../models/Farm";
import { Project } from "../models/Project";
import { SimulationRun } from "../models/SimulationRun";
import { User } from "../models/User";

const SEED_FARMERS = [
  {
    name: "Sunil Perera",
    email: "farmer1@terrashift.com",
    password: "Farmer@123",
    role: "farmer" as const,
  },
  {
    name: "Kamal Bandara",
    email: "farmer2@terrashift.com",
    password: "Farmer@123",
    role: "farmer" as const,
  },
];

const LEGACY_USER_COLLECTIONS = new Set(["analyses", "reports", "processes", "farmlands"]);

async function restoreAppeearsSeriesFromRedis(): Promise<number> {
  if (!mongoose.connection.db) return 0;

  const redisUrl = env.REDIS_URL.includes("redis-cache")
    ? env.REDIS_URL.replace("redis-cache", "localhost")
    : env.REDIS_URL;

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => {
    /* ignore connection errors during optional Redis restore */
  });

  try {
    await client.connect();
    const keys = await client.keys("appeears:grid:*");
    if (keys.length === 0) return 0;

    const coll = mongoose.connection.db.collection<{ _id: string } & Record<string, unknown>>("appeears_series");
    let synced = 0;

    for (const gridKey of keys) {
      const parts = gridKey.split(":");
      if (parts.length < 4) continue;
      const lat = Number(parts[2]);
      const lon = Number(parts[3]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const raw = await client.get(gridKey);
      if (!raw) continue;

      const data = JSON.parse(raw) as { months?: unknown };
      const months = Array.isArray(data.months) ? (data.months as string[]) : [];
      if (months.length === 0) continue;

      const startYear = Number(String(months[0]).slice(0, 4));
      const endYear = Number(String(months[months.length - 1]).slice(0, 4));
      if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) continue;

      const docId = `${gridKey}:${startYear}:${endYear}`;
      await coll.replaceOne(
        { _id: docId },
        {
          _id: docId,
          grid_key: gridKey,
          lat: Number(lat.toFixed(2)),
          lon: Number(lon.toFixed(2)),
          start_year: startYear,
          end_year: endYear,
          data,
          updated_at: new Date(),
        },
        { upsert: true },
      );
      synced += 1;
    }
    return synced;
  } catch (err) {
    console.warn("⚠️ Redis AppEEARS restore skipped:", (err as Error).message);
    return 0;
  } finally {
    client.disconnect();
  }
}

async function runSeed() {
  await connectMongo();
  if (!mongoReady() || !mongoose.connection.db) {
    throw new Error("Could not connect to MongoDB Atlas (general_db). Check ATLAS_MONGO_URI / GENERAL_MONGO_URI.");
  }

  // 1. Delete user-related collections in general_db while preserving environment collections (e.g. appeears_series)
  const [farmsRes, runsRes, projectsRes, usersRes] = await Promise.all([
    Farm.deleteMany({}),
    SimulationRun.deleteMany({}),
    Project.deleteMany({}),
    User.deleteMany({}),
  ]);

  const deletedCounts: Record<string, number> = {
    farms: farmsRes.deletedCount ?? 0,
    simulation_runs: runsRes.deletedCount ?? 0,
    projects: projectsRes.deletedCount ?? 0,
    users: usersRes.deletedCount ?? 0,
  };

  const existingCollections = await mongoose.connection.db.listCollections().toArray();
  for (const col of existingCollections) {
    if (!LEGACY_USER_COLLECTIONS.has(col.name)) continue;
    const res = await mongoose.connection.db.collection(col.name).deleteMany({});
    deletedCounts[col.name] = res.deletedCount ?? 0;
  }

  console.log("🧹 Deleted user-related data from general_db:", deletedCounts);

  // 2. Restore any cached AppEEARS satellite grids from Redis into general_db.appeears_series
  const restoredAppeears = await restoreAppeearsSeriesFromRedis();
  if (restoredAppeears > 0) {
    console.log(`🛰️ Restored ${restoredAppeears} AppEEARS grid(s) from Redis into general_db.appeears_series`);
  }

  // 3. Verify environment/reference data in lookup_db and general_db.appeears_series
  const lookupDb = mongoose.connection.useDb("lookup_db");
  const [cropsCount, soilsCount, regionsCount, appeearsCount] = await Promise.all([
    lookupDb.collection("crops_catalog").countDocuments({}),
    lookupDb.collection("soil_profiles").countDocuments({}),
    lookupDb.collection("regional_saturation").countDocuments({}),
    mongoose.connection.db.collection("appeears_series").countDocuments({}),
  ]);
  console.log("🌱 Preserved environment data:", {
    "lookup_db.crops_catalog": cropsCount,
    "lookup_db.soil_profiles": soilsCount,
    "lookup_db.regional_saturation": regionsCount,
    "general_db.appeears_series": appeearsCount,
  });

  // 4. Seed two farmer accounts in general_db.users
  const seededUsers = [];
  for (const farmer of SEED_FARMERS) {
    const passwordHash = await User.hashPassword(farmer.password);
    const created = await User.create({
      name: farmer.name,
      email: farmer.email,
      passwordHash,
      role: farmer.role,
    });
    seededUsers.push({
      ...created.toPublic(),
      password: farmer.password,
    });
  }

  console.log("✅ Seeded farmer accounts:", seededUsers);
}

runSeed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
