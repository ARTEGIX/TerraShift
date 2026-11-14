"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import FarmMap, { boxPolygon } from "@/components/map/FarmMap";
import { createAnalysis, fetchCrops } from "@/lib/api";
import { MOCK_CROPS } from "@/lib/mock";
import type { Centroid, CropInfo, Polygon, Priority, SoilType } from "@/lib/types";

const SOIL_OPTIONS: { id: SoilType; label: string }[] = [
  { id: "soil_clay_loam", label: "Clay Loam (FAO Luvisol / Fine-Loamy)" },
  { id: "soil_sandy_loam", label: "Sandy Loam (FAO Lixisol / Coarse-Loamy)" },
  { id: "soil_degraded_dry", label: "Degraded Dryland Soil (Low-SOM Aridisol)" },
];

export default function FarmPage() {
  const router = useRouter();
  const [crops, setCrops] = useState<CropInfo[]>(MOCK_CROPS);
  const [centroid, setCentroid] = useState<Centroid>({ lat: 8.311, lon: 80.404 });
  const [polygon, setPolygon] = useState<Polygon>(() => boxPolygon(8.311, 80.404));
  const [currentCrop, setCurrentCrop] = useState("paddy_rice");
  const [soilType, setSoilType] = useState<SoilType>("soil_clay_loam");
  const [priority, setPriority] = useState<Priority>("water");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCrops().then(setCrops);
  }, []);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await createAnalysis({
        polygon,
        centroid,
        current_crop: currentCrop,
        soil_type: soilType,
        region_id: centroid.lat > 23.5 ? "region_us_midwest" : "region_lk_dryzone",
        priority,
      });
      router.push(`/results/${res.id}`);
    } catch {
      router.push("/results/demo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configure Your Field Simulation</h1>
        <p className="text-sm text-slate-600">
          Select your field geofence, current crop, USDA/FAO soil profile, and primary adaptation priority.
        </p>
      </div>

      <form onSubmit={handleAnalyze} className="grid md:grid-cols-2 gap-6">
        <FarmMap
          centroid={centroid}
          onChange={(c, p) => {
            setCentroid(c);
            setPolygon(p);
          }}
        />

        <div className="bg-white rounded-xl border border-soil-100 p-4 space-y-4">
          <h2 className="font-semibold text-sm text-slate-900">2. Agronomy &amp; Lookup Inputs</h2>

          <div>
            <label className="block text-xs text-slate-600 mb-1">Current Crop (`lookup_db.crops_catalog`)</label>
            <select
              value={currentCrop}
              onChange={(e) => setCurrentCrop(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category.replace("_", " ")})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">Soil Profile (`lookup_db.soil_profiles`)</label>
            <select
              value={soilType}
              onChange={(e) => setSoilType(e.target.value as SoilType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {SOIL_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">Primary Optimization Priority</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "water", label: "💧 Water" },
                  { id: "soil", label: "🌱 Soil Health" },
                  { id: "cost", label: "💰 Cost & Profit" },
                ] as { id: Priority; label: string }[]
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border ${
                    priority === p.id
                      ? "bg-leaf-600 text-white border-leaf-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-leaf-600 text-white font-semibold hover:bg-leaf-700 transition disabled:opacity-50"
          >
            {loading ? "Running In-Memory NumPy GA…" : "Run 3-Season Rotation Simulation →"}
          </button>
        </div>
      </form>
    </div>
  );
}
