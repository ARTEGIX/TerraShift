"use client";

import dynamic from "next/dynamic";

/** Client-only wrapper: Leaflet touches `window`, so the map never renders on the server. */
const FarmMapLazy = dynamic(() => import("./FarmMap"), {
  ssr: false,
  loading: () => <div className="grid h-full w-full place-items-center bg-slate-200 text-sm text-slate-500">Loading map…</div>,
});

export default FarmMapLazy;
