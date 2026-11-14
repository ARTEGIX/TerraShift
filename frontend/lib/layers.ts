/**
 * NASA GIBS (Global Imagery Browse Services) overlay layers.
 * Layer ids, tile matrix levels and legends were checked against
 * https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
 * No API key is needed.
 */

export type LayerPeriod = "daily" | "16day" | "monthly" | "static";

export interface NasaLayer {
  key: string;
  label: string;
  /** Plain-language explanation shown to farmers. */
  description: string;
  gibsId: string;
  mission: string;
  /** Highest zoom the tiles exist at; Leaflet upscales beyond this. */
  maxNativeZoom: number;
  format: "png" | "jpg";
  period: LayerPeriod;
  /** Earliest available date (YYYY-MM-DD). */
  minDate?: string;
  /** Approximate ground size of one pixel. */
  resolution: string;
  /** True when one pixel is much larger than a typical field. */
  coarse: boolean;
  legend?: string;
}

const LEGEND = "https://gibs.earthdata.nasa.gov/legends";

export const NASA_LAYERS: NasaLayer[] = [
  {
    key: "ndvi",
    label: "Plant health",
    description:
      "How green and healthy plants are (NDVI). Brown means bare soil or stressed crops.",
    gibsId: "MODIS_Terra_L3_NDVI_16Day",
    mission: "MODIS Terra",
    maxNativeZoom: 9,
    format: "png",
    period: "16day",
    minDate: "2000-03-05",
    resolution: "250 m",
    coarse: false,
    legend: `${LEGEND}/MODIS_L3_NDVI_H.svg`,
  },
  {
    key: "soil_root",
    label: "Soil water (root depth)",
    description:
      "Water held in the top metre of soil, where most crop roots are.",
    gibsId: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture",
    mission: "SMAP L4",
    maxNativeZoom: 6,
    format: "png",
    period: "daily",
    minDate: "2015-03-31",
    resolution: "9 km",
    coarse: true,
    legend: `${LEGEND}/SMAP_Analyzed_Soil_Moisture_H.svg`,
  },
  {
    key: "soil_surface",
    label: "Soil water (top layer)",
    description: "Water in the top 5 cm of soil. Reacts quickly to rain and drought.",
    gibsId: "SMAP_L4_Analyzed_Surface_Soil_Moisture",
    mission: "SMAP L4",
    maxNativeZoom: 6,
    format: "png",
    period: "daily",
    minDate: "2015-03-31",
    resolution: "9 km",
    coarse: true,
    legend: `${LEGEND}/SMAP_Analyzed_Soil_Moisture_H.svg`,
  },
  {
    key: "rain",
    label: "Rain",
    description: "Daily rainfall estimated from the GPM satellite constellation.",
    gibsId: "IMERG_Precipitation_Rate",
    mission: "GPM IMERG",
    maxNativeZoom: 6,
    format: "png",
    period: "daily",
    minDate: "2000-06-01",
    resolution: "10 km",
    coarse: true,
    legend: `${LEGEND}/GPM_Precipitation_Rate_H.svg`,
  },
  {
    key: "heat",
    label: "Heat on the ground",
    description: "Daytime ground temperature. Hot spots show heat stress on crops.",
    gibsId: "MODIS_Terra_Land_Surface_Temp_Day",
    mission: "MODIS Terra",
    maxNativeZoom: 7,
    format: "png",
    period: "daily",
    minDate: "2000-02-24",
    resolution: "1 km",
    coarse: false,
    legend: `${LEGEND}/MODIS_Land_Surface_Temp_H.svg`,
  },
  {
    key: "water_storage",
    label: "Groundwater",
    description:
      "Change in all water stored on and under the land. Shows long-term drying or wetting.",
    gibsId: "GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI",
    mission: "GRACE / GRACE-FO",
    maxNativeZoom: 6,
    format: "png",
    period: "monthly",
    minDate: "2002-04-04",
    resolution: "~300 km",
    coarse: true,
    legend: `${LEGEND}/GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI_H.svg`,
  },
  {
    key: "elevation",
    label: "Land height and slope",
    description: "Height of the land. Steep areas lose more soil to erosion.",
    gibsId: "SRTM_Color_Index",
    mission: "SRTM",
    maxNativeZoom: 12,
    format: "png",
    period: "static",
    resolution: "30 m",
    coarse: false,
    legend: `${LEGEND}/SRTM_Color_Index_H.svg`,
  },
];

/** `date` null means "latest available" (GIBS `default` time). */
export function gibsTileUrl(layer: NasaLayer, date: string | null): string {
  const tms = `GoogleMapsCompatible_Level${layer.maxNativeZoom}`;
  const base = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  if (layer.period === "static") {
    return `${base}/${layer.gibsId}/default/${tms}/{z}/{y}/{x}.${layer.format}`;
  }
  const time = date ?? "default";
  return `${base}/${layer.gibsId}/default/${time}/${tms}/{z}/{y}/{x}.${layer.format}`;
}

export const BASE_LAYERS = {
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxNativeZoom: 19,
  },
  streets: {
    label: "Streets",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxNativeZoom: 19,
  },
} as const;

export type BaseLayerKey = keyof typeof BASE_LAYERS;

export const LABELS_LAYER_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
