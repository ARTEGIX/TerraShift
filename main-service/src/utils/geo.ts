import type { Polygon } from "../types/contract";

/** Area-weighted centroid of a GeoJSON polygon's outer ring (planar approximation — fine at farm scale). */
export function polygonCentroid(polygon: Polygon): { lat: number; lon: number } {
  const ring = polygon.coordinates[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const pts = ring.slice(0, -1);
    return {
      lon: pts.reduce((s, p) => s + p[0], 0) / pts.length,
      lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    };
  }
  a *= 0.5;
  return { lon: cx / (6 * a), lat: cy / (6 * a) };
}

/** Approximate polygon area in hectares (equirectangular projection). */
export function polygonAreaHa(polygon: Polygon): number {
  const ring = polygon.coordinates[0];
  const R = 6_371_008.8;
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const X0 = (x0 * Math.PI) / 180 * R * Math.cos(lat0);
    const Y0 = (y0 * Math.PI) / 180 * R;
    const X1 = (x1 * Math.PI) / 180 * R * Math.cos(lat0);
    const Y1 = (y1 * Math.PI) / 180 * R;
    area += X0 * Y1 - X1 * Y0;
  }
  return Math.abs(area / 2) / 10_000;
}
