import area from "@turf/area";
import kinks from "@turf/kinks";
import type { Centroid, Polygon } from "./types";

/** Fields larger than this are probably a mistake (a whole district drawn). */
export const MAX_FIELD_HA = 2000;
export const MIN_FIELD_HA = 0.01;

export interface FieldCheck {
  ok: boolean;
  error?: string;
  areaHa?: number;
  centroid?: Centroid;
}

/** Validate a drawn field and measure it. main-service recomputes area/centroid itself. */
export function checkField(polygon: Polygon): FieldCheck {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return { ok: false, error: "A field needs at least 3 corners." };
  const feature = { type: "Feature" as const, properties: {}, geometry: polygon };
  if (kinks(feature).features.length > 0) {
    return { ok: false, error: "The outline crosses itself. Redraw it without overlapping edges." };
  }
  const ha = area(feature) / 10_000;
  if (ha < MIN_FIELD_HA) return { ok: false, error: "That field is too small. Zoom in and draw around the whole field." };
  if (ha > MAX_FIELD_HA) {
    return { ok: false, error: `That outline covers ${Math.round(ha).toLocaleString()} ha. Draw one field only.` };
  }
  const pts = ring.slice(0, -1);
  const centroid = {
    lon: Number((pts.reduce((s, p) => s + p[0], 0) / pts.length).toFixed(6)),
    lat: Number((pts.reduce((s, p) => s + p[1], 0) / pts.length).toFixed(6)),
  };
  return { ok: true, areaHa: Math.round(ha * 100) / 100, centroid };
}

export const haToAcres = (ha: number) => ha * 2.47105;

export function formatLatLon({ lat, lon }: Centroid) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}
