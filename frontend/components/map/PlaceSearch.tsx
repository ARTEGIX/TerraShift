"use client";

import { LocateFixed, Search } from "lucide-react";
import { useState } from "react";

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

interface Place {
  display_name: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
}

/** Village search (OpenStreetMap Nominatim, free, light use) and "use my location". */
export default function PlaceSearch({ onPlace }: { onPlace: (bbox: BBox) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setStatus("loading");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=lk&q=${encodeURIComponent(q.trim())}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Place[];
      setResults(data);
      setStatus(data.length ? "idle" : "empty");
    } catch {
      setStatus("error");
    }
  }

  function go(p: Place) {
    const [s, n, w, e] = p.boundingbox.map(Number);
    onPlace([w, s, e, n]);
    setResults([]);
  }

  function locate() {
    if (!navigator.geolocation) return setStatus("error");
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const d = 0.004;
        onPlace([coords.longitude - d, coords.latitude - d, coords.longitude + d, coords.latitude + d]);
        setStatus("idle");
      },
      () => setStatus("error"),
      { timeout: 10_000 },
    );
  }

  return (
    <div className="absolute left-3 top-3 z-[1001] w-[calc(100%-1.5rem)] sm:w-[20rem] max-w-sm">
      <form onSubmit={search} className="flex gap-1 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-black/5 backdrop-blur">
        <label htmlFor="place-search" className="sr-only">
          Find your village or town
        </label>
        <input
          id="place-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search village or town…"
          className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm outline-none bg-transparent text-slate-800 placeholder:text-slate-400"
        />
        <button type="submit" aria-label="Search" className="grid size-7 sm:size-8 place-items-center rounded-lg bg-leaf-700 text-white hover:bg-leaf-800 transition">
          <Search className="size-3.5" aria-hidden />
        </button>
        <button type="button" onClick={locate} aria-label="Use my location" title="Use my location" className="grid size-7 sm:size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 transition">
          <LocateFixed className="size-3.5" aria-hidden />
        </button>
      </form>
      {(results.length > 0 || status === "empty" || status === "error" || status === "loading") && (
        <ul className="mt-1 overflow-hidden rounded-xl bg-white text-sm shadow-lg ring-1 ring-black/5">
          {status === "loading" && <li className="px-3 py-2 text-slate-500">Searching…</li>}
          {results.map((p) => (
            <li key={p.display_name}>
              <button type="button" onClick={() => go(p)} className="block w-full px-3 py-2 text-left hover:bg-slate-100">
                {p.display_name}
              </button>
            </li>
          ))}
          {status === "empty" && <li className="px-3 py-2 text-slate-500">No places found. Try a nearby town.</li>}
          {status === "error" && <li className="px-3 py-2 text-red-700">Search or location didn&apos;t work. Move the map by hand.</li>}
        </ul>
      )}
    </div>
  );
}
