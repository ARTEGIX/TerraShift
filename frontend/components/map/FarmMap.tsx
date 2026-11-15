"use client";

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { BASE_LAYERS, LABELS_LAYER_URL, NASA_LAYERS, gibsTileUrl, type BaseLayerKey } from "@/lib/layers";
import type { Polygon } from "@/lib/types";
import LayerPanel, { type MapView } from "./LayerPanel";
import PlaceSearch, { type BBox } from "./PlaceSearch";

/**
 * Interactive field map: draw / edit / delete one field polygon (Leaflet-Geoman),
 * switch NASA GIBS overlays, and search for a village.
 *
 * Load it with `next/dynamic` and `ssr: false` (Leaflet needs `window`), e.g. via FarmMapLazy.
 */
export interface FarmMapProps {
  polygon: Polygon | null;
  onPolygonChange: (polygon: Polygon | null) => void;
  /** Increment to start polygon drawing from an outside button. */
  drawSignal?: number;
  /** Read-only map (results page): no drawing tools. */
  readOnly?: boolean;
}

const FIELD_STYLE: L.PathOptions = { color: "#facc15", weight: 3, fillColor: "#facc15", fillOpacity: 0.15 };
const TRANSPARENT_PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const DEFAULT_CENTER: [number, number] = [
  Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT ?? 7.87),
  Number(process.env.NEXT_PUBLIC_MAP_CENTER_LON ?? 80.77),
];

function toPolygon(layer: L.Polygon): Polygon {
  const gj = layer.toGeoJSON(6).geometry as GeoJSON.Polygon;
  return { type: "Polygon", coordinates: gj.coordinates as [number, number][][] };
}

function toLatLngs(p: Polygon) {
  return p.coordinates[0].map(([lon, lat]) => L.latLng(lat, lon));
}

function DrawingTools({ polygon, onPolygonChange, drawSignal, readOnly }: FarmMapProps) {
  const map = useMap();
  const fieldRef = useRef<L.Polygon | null>(null);
  const onChangeRef = useRef(onPolygonChange);
  onChangeRef.current = onPolygonChange;

  // Show the saved / initial polygon once.
  useEffect(() => {
    if (!polygon || fieldRef.current) return;
    const layer = L.polygon(toLatLngs(polygon), FIELD_STYLE).addTo(map);
    fieldRef.current = layer;
    if (!readOnly) {
      layer.on("pm:edit", () => onChangeRef.current(toPolygon(layer)));
      layer.on("pm:dragend", () => onChangeRef.current(toPolygon(layer)));
    }
    map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (readOnly) return;
    map.pm.setGlobalOptions({
      pathOptions: FIELD_STYLE,
      templineStyle: { color: "#facc15" },
      hintlineStyle: { color: "#facc15", dashArray: "5,5" },
      snappable: true,
      allowSelfIntersection: false,
    });
    map.pm.addControls({
      position: "topleft",
      drawPolygon: true,
      drawRectangle: true,
      editMode: true,
      dragMode: true,
      removalMode: true,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });

    const onCreate = (e: { layer: L.Layer }) => {
      if (!(e.layer instanceof L.Polygon)) return;
      const layer = e.layer;
      if (fieldRef.current && fieldRef.current !== layer) fieldRef.current.remove();
      fieldRef.current = layer;
      layer.setStyle(FIELD_STYLE);
      layer.on("pm:edit", () => onChangeRef.current(toPolygon(layer)));
      layer.on("pm:dragend", () => onChangeRef.current(toPolygon(layer)));
      map.pm.disableDraw();
      onChangeRef.current(toPolygon(layer));
    };
    const onRemove = (e: { layer: L.Layer }) => {
      if (e.layer === fieldRef.current) {
        fieldRef.current = null;
        onChangeRef.current(null);
      }
    };
    map.on("pm:create", onCreate);
    map.on("pm:remove", onRemove);
    return () => {
      map.off("pm:create", onCreate);
      map.off("pm:remove", onRemove);
      map.pm.removeControls();
    };
  }, [map, readOnly]);

  useEffect(() => {
    if (!readOnly && drawSignal) map.pm.enableDraw("Polygon");
  }, [drawSignal, map, readOnly]);

  return null;
}

function FlyTo({ target }: { target: { bbox: BBox; at: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const [w, s, e, n] = target.bbox;
    map.flyToBounds([[s, w], [n, e]], { maxZoom: 16, duration: 1.2 });
  }, [target, map]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}

function ZoomControl() {
  const map = useMap();
  useEffect(() => {
    const ctl = L.control.zoom({ position: "bottomright" }).addTo(map);
    return () => {
      ctl.remove();
    };
  }, [map]);
  return null;
}

function MapResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);

    const container = map.getContainer();
    if (!container) return () => { clearTimeout(t1); clearTimeout(t2); };

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(container);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [map]);
  return null;
}

export default function FarmMap(props: FarmMapProps) {
  const [view, setView] = useState<MapView>({ base: "satellite", overlay: null, opacity: 0.7, date: null, showLabels: true });
  const [zoom, setZoom] = useState(7);
  const [flyTarget, setFlyTarget] = useState<{ bbox: BBox; at: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const onZoom = useCallback((z: number) => setZoom(z), []);

  const base = BASE_LAYERS[view.base as BaseLayerKey];
  const overlay = NASA_LAYERS.find((l) => l.key === view.overlay) ?? null;
  const overlayUrl = overlay ? gibsTileUrl(overlay, view.date) : null;
  const coarseNotice = overlay?.coarse && zoom > overlay.maxNativeZoom + 3;

  // On mobile, auto-expand to fullscreen when the user triggers "Start drawing"
  useEffect(() => {
    if (props.drawSignal && typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsExpanded(true);
    }
  }, [props.drawSignal]);

  return (
    <div
      className={`ts-map relative w-full overflow-hidden [container-type:size] transition-all duration-300 ${
        isExpanded
          ? "fixed inset-0 z-[1050] h-[100dvh] w-screen"
          : "h-full min-h-[inherit]"
      }`}
    >
      <MapContainer center={DEFAULT_CENTER} zoom={7} minZoom={2} maxZoom={19} zoomControl={false} worldCopyJump className="h-full w-full min-h-[inherit]">
        <TileLayer key={view.base} url={base.url} attribution={base.attribution} maxNativeZoom={base.maxNativeZoom} maxZoom={19} />
        {overlay && overlayUrl && (
          <TileLayer
            key={overlayUrl}
            url={overlayUrl}
            opacity={view.opacity}
            maxNativeZoom={overlay.maxNativeZoom}
            maxZoom={19}
            errorTileUrl={TRANSPARENT_PX}
            attribution={`NASA GIBS · ${overlay.mission}`}
            zIndex={5}
          />
        )}
        {view.base === "satellite" && view.showLabels && <TileLayer url={LABELS_LAYER_URL} maxZoom={19} zIndex={10} />}
        <DrawingTools {...props} />
        <FlyTo target={flyTarget} />
        <ZoomWatcher onZoom={onZoom} />
        <ZoomControl />
        <MapResizeWatcher />
      </MapContainer>

      {!props.readOnly && <PlaceSearch onPlace={(bbox) => setFlyTarget({ bbox, at: Date.now() })} />}
      <LayerPanel
        view={view}
        onChange={(patch) => setView((v) => ({ ...v, ...patch }))}
        compact={props.readOnly}
        drawSignal={props.drawSignal}
      />

      {/* Expand map button when in embedded mode */}
      {!props.readOnly && !isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          aria-label="Expand map for free drawing"
          title="Expand map for free drawing"
          className="absolute bottom-4 left-3 z-[1001] flex items-center gap-1.5 rounded-xl bg-white/95 px-3 py-2 text-xs font-semibold text-slate-800 shadow-md ring-1 ring-black/10 backdrop-blur hover:bg-slate-50 transition active:scale-95"
        >
          <Maximize2 className="size-4 text-leaf-700" />
          <span>Full map</span>
        </button>
      )}

      {/* Floating guidance bar when in expanded drawing mode */}
      {isExpanded && !props.readOnly && (
        <div className="animate-fade-up absolute bottom-4 left-1/2 -translate-x-1/2 z-[1002] flex max-w-[calc(100vw-2rem)] items-center gap-2 sm:gap-3 rounded-full bg-white/95 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-medium text-slate-800 shadow-lg ring-1 ring-black/5 backdrop-blur">
          <span className="truncate">{props.polygon ? "Field outline saved!" : "Tap corners on map to trace field"}</span>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="shrink-0 flex items-center gap-1 rounded-full bg-leaf-700 px-3 py-1 font-semibold text-white shadow hover:bg-leaf-800 transition"
          >
            <Minimize2 className="size-3.5" />
            <span>Done</span>
          </button>
        </div>
      )}

      {coarseNotice && overlay && (
        <div className="pointer-events-none absolute bottom-12 left-1/2 z-[1000] w-[min(92%,26rem)] -translate-x-1/2 rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-white">
          Each &ldquo;{overlay.label.toLowerCase()}&rdquo; square is about {overlay.resolution} wide, bigger than most
          fields. Read it as your area, not your exact field.
        </div>
      )}
    </div>
  );
}