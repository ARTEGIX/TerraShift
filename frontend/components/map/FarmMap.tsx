"use client";

import type { Centroid, Polygon } from "@/lib/types";

interface Props {
  centroid: Centroid;
  onChange: (centroid: Centroid, polygon: Polygon) => void;
}

const PRESET_LOCATIONS: { label: string; lat: number; lon: number }[] = [
  { label: "Kandy / Mahaweli (Intermediate)", lat: 7.295, lon: 80.635 },
  { label: "Anuradhapura (Dry Zone)", lat: 8.311, lon: 80.403 },
  { label: "Jaffna Peninsula", lat: 9.661, lon: 80.025 },
  { label: "Hambantota (Arid South)", lat: 6.124, lon: 81.118 },
];

export function boxPolygon(lat: number, lon: number, halfDeg = 0.005): Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [Number((lon - halfDeg).toFixed(5)), Number((lat - halfDeg).toFixed(5))],
        [Number((lon + halfDeg).toFixed(5)), Number((lat - halfDeg).toFixed(5))],
        [Number((lon + halfDeg).toFixed(5)), Number((lat + halfDeg).toFixed(5))],
        [Number((lon - halfDeg).toFixed(5)), Number((lat + halfDeg).toFixed(5))],
        [Number((lon - halfDeg).toFixed(5)), Number((lat - halfDeg).toFixed(5))],
      ],
    ],
  };
}

export default function FarmMap({ centroid, onChange }: Props) {
  function update(lat: number, lon: number) {
    onChange({ lat, lon }, boxPolygon(lat, lon));
  }

  return (
    <div className="bg-white rounded-xl border border-soil-100 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-slate-900">1. Farm Geofence &amp; Centroid</h2>
        <span className="text-xs text-slate-500">GeoJSON Polygon (2dsphere)</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESET_LOCATIONS.map((loc) => (
          <button
            key={loc.label}
            type="button"
            onClick={() => update(loc.lat, loc.lon)}
            className="text-xs px-2.5 py-1 rounded-full border border-leaf-100 bg-leaf-50 text-leaf-700 hover:bg-leaf-100"
          >
            📍 {loc.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-600 mb-1">Latitude (°N)</label>
          <input
            type="number"
            step="0.001"
            value={centroid.lat}
            onChange={(e) => update(Number(e.target.value), centroid.lon)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Longitude (°E)</label>
          <input
            type="number"
            step="0.001"
            value={centroid.lon}
            onChange={(e) => update(centroid.lat, Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg bg-leaf-50/60 border border-dashed border-leaf-600/40 p-4 text-xs text-slate-600">
        🗺️ <strong>Frontend module hook:</strong> Replace or augment this box-polygon selector with interactive
        React-Leaflet polygon drawing inside <code>components/map/FarmMap.tsx</code> without touching any other file.
      </div>
    </div>
  );
}
