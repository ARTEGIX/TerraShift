/**
 * Typed client for main-service (`/api/*`). Mirrors docs/api-contract.md (v0.2.0).
 *
 * v0.2.0: farms and simulation runs no longer need a login; the auth routes still exist.
 * There is no mock data: every screen shows what the live backend returns.
 */
import type {
  AnalysisRecord,
  AnalysisSummary,
  Centroid,
  CropInfo,
  Farm,
  FarmDetailResponse,
  Polygon,
  Priority,
  Project,
  ProjectDetailResponse,
  SoilType,
  StrategyId,
  UserProfile,
} from "./types";

/**
 * Set NEXT_PUBLIC_API_BASE_URL in Vercel (and in .env.local for local dev).
 * Falls back to the team's deployed gateway so a missing setting never points the live site at localhost.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "https://168.144.100.73.sslip.io/api").replace(/\/$/, "");
const TOKEN_KEY = "terrashift_token";
const USER_KEY = "terrashift_user";
const AUTH_EVENT = "terrashift-auth";

/* ------------------------------------------------------------------ auth storage */

export function getToken(): string | null {
  return typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
}

export function getStoredUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function saveSession(token: string | null, user: UserProfile | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** Kept for compatibility with older imports. */
export function setToken(token: string | null): void {
  saveSession(token, token ? getStoredUser() : null);
}

export function onAuthChange(cb: () => void): () => void {
  window.addEventListener(AUTH_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(AUTH_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/* ------------------------------------------------------------------ errors */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isAuth() {
    return this.status === 401;
  }
}

/** Turn backend messages into words a farmer understands. */
function friendly(status: number, message: string | undefined): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "We couldn't find that. It may have been deleted.";
  if (status === 409) return message ?? "That already exists.";
  if (status === 429) return "Too many tries. Wait a few minutes and try again.";
  if (status === 502 || status === 503 || status === 504)
    return "The analysis service is busy or offline. Try again in a minute.";
  if (status >= 500) return "Something went wrong on our side. Try again in a minute.";
  return message ?? `Request failed (${status}).`;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiError(
      timedOut
        ? "This is taking too long. Check your internet and try again."
        : "Can't reach the TerraShift server. Check your internet and try again.",
      0,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const fieldErrors = (body?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>;
    if (res.status === 401) saveSession(null, null);
    throw new ApiError(friendly(res.status, body?.error?.message), res.status, fieldErrors);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ auth */

export async function login(email: string, password: string): Promise<UserProfile> {
  const data = await request<{ token: string; user: UserProfile }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveSession(data.token, data.user);
  return data.user;
}

export async function register(name: string, email: string, password: string): Promise<UserProfile> {
  const data = await request<{ token: string; user: UserProfile }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  saveSession(data.token, data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    if (getToken()) await request<void>("/auth/logout", { method: "POST" }, 5_000);
  } catch {
    /* token is dropped locally either way */
  }
  saveSession(null, null);
}

/* ------------------------------------------------------------------ reference data */

const cropsCache = new Map<string, Promise<CropInfo[]>>();

/** Built-in general crop set used when the regional crop API returns empty or is unreachable. */
export const GENERAL_CROPS_FALLBACK: CropInfo[] = [
  { id: "paddy_rice", name: "Paddy Rice", category: "cash_crop", water_demand_mm: 1200, nitrogen_impact_kg_ha: -90, root_depth_cm: 30, growth_days: 120 },
  { id: "maize", name: "Maize", category: "cash_crop", water_demand_mm: 550, nitrogen_impact_kg_ha: -110, root_depth_cm: 120, growth_days: 110 },
  { id: "mung_bean", name: "Mung Bean", category: "legume", water_demand_mm: 350, nitrogen_impact_kg_ha: 42, root_depth_cm: 60, growth_days: 70 },
  { id: "cowpea", name: "Cowpea", category: "legume", water_demand_mm: 380, nitrogen_impact_kg_ha: 50, root_depth_cm: 90, growth_days: 80 },
  { id: "groundnut", name: "Groundnut", category: "legume", water_demand_mm: 480, nitrogen_impact_kg_ha: 58, root_depth_cm: 55, growth_days: 110 },
  { id: "chickpea", name: "Chickpea", category: "legume", water_demand_mm: 340, nitrogen_impact_kg_ha: 45, root_depth_cm: 100, growth_days: 100 },
  { id: "finger_millet", name: "Finger Millet", category: "drought_tolerant", water_demand_mm: 340, nitrogen_impact_kg_ha: -35, root_depth_cm: 75, growth_days: 100 },
  { id: "sesame", name: "Sesame", category: "drought_tolerant", water_demand_mm: 300, nitrogen_impact_kg_ha: -30, root_depth_cm: 120, growth_days: 90 },
  { id: "cassava", name: "Cassava", category: "drought_tolerant", water_demand_mm: 680, nitrogen_impact_kg_ha: -65, root_depth_cm: 110, growth_days: 240 },
  { id: "chilli", name: "Chilli", category: "cash_crop", water_demand_mm: 600, nitrogen_impact_kg_ha: -115, root_depth_cm: 60, growth_days: 150 },
  { id: "onion", name: "Onion", category: "cash_crop", water_demand_mm: 450, nitrogen_impact_kg_ha: -95, root_depth_cm: 30, growth_days: 110 },
  { id: "sunn_hemp", name: "Sunn Hemp", category: "cover_crop", water_demand_mm: 280, nitrogen_impact_kg_ha: 110, root_depth_cm: 150, growth_days: 60 },
];

/** Crop list from lookup_db (via main-service), optionally filtered to a region's viable crops. */
export function fetchCrops(regionId?: string, forceRefresh = false): Promise<CropInfo[]> {
  const key = regionId?.trim() || "__global__";
  if (forceRefresh) {
    cropsCache.delete(key);
  }
  let p = cropsCache.get(key);
  if (!p) {
    const params = new URLSearchParams();
    if (regionId?.trim()) params.set("region_id", regionId.trim());
    if (forceRefresh) params.set("refresh", "1");
    const qs = params.toString() ? `?${params.toString()}` : "";
    p = request<{ crops: CropInfo[] }>(`/crops${qs}`, {}, 15_000)
      .then(({ crops }) => crops.map((c) => ({ ...c, id: c.id ?? String(c._id) })))
      .catch((err) => {
        cropsCache.delete(key); // allow a retry
        throw err;
      });
    cropsCache.set(key, p);
  }
  return p;
}

export interface EnsureRegionResult {
  region_id: string;
  region_name: string;
  soil_type: SoilType;
  oversupplied_crops: string[];
  viable_crop_ids: string[];
}

export async function ensureRegion(
  lat: number,
  lon: number,
  polygon?: Polygon,
  forceRefresh = false,
): Promise<EnsureRegionResult | null> {
  try {
    return await request<EnsureRegionResult>(
      "/regions/ensure",
      {
        method: "POST",
        body: JSON.stringify({
          lat,
          lon,
          ...(polygon ? { polygon } : {}),
          ...(forceRefresh ? { force_refresh: true } : {}),
        }),
      },
      15_000,
    );
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ farms */

export interface NewFarm {
  name: string;
  polygon: Polygon;
  centroid?: Centroid;
  region_id?: string;
  soil_type: SoilType;
  current_crop: string;
  default_priority?: Priority;
  planting_month?: number;
}

export interface FarmPatch {
  name?: string;
  polygon?: Polygon;
  centroid?: Centroid;
  region_id?: string;
  soil_type?: SoilType | string;
  current_crop?: string;
  default_priority?: Priority;
  planting_month?: number;
}

export async function listFarms(): Promise<Farm[]> {
  return (await request<{ farms: Farm[] }>("/farms")).farms;
}

export async function getFarmDetail(id: string): Promise<FarmDetailResponse> {
  return request<FarmDetailResponse>(`/farms/${encodeURIComponent(id)}`);
}

export async function createFarm(input: NewFarm): Promise<Farm> {
  return (await request<{ farm: Farm }>("/farms", { method: "POST", body: JSON.stringify(input) })).farm;
}

export async function updateFarm(id: string, patch: FarmPatch): Promise<Farm> {
  return (await request<{ farm: Farm }>(`/farms/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).farm;
}

export async function deleteFarm(id: string): Promise<void> {
  await request<void>(`/farms/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ analyses */

/** NASA fetch + Layer 1 + Layer 2 GA + Gemini; can take a while (nginx allows 60 s). */
const ANALYSIS_TIMEOUT_MS = 70_000;

/** POST /api/analyze with a saved farm. */
export async function analyseFarm(farmId: string, priority?: Priority, plantingMonth?: number): Promise<AnalysisRecord> {
  return request<AnalysisRecord>(
    "/analyze",
    {
      method: "POST",
      body: JSON.stringify({
        farm_id: farmId,
        ...(priority ? { priority } : {}),
        ...(plantingMonth ? { planting_month: plantingMonth } : {}),
      }),
    },
    ANALYSIS_TIMEOUT_MS,
  );
}

/** Ad-hoc analysis without saving a farm (POST /api/analyze). */
export async function createAnalysis(input: {
  farm_id?: string;
  polygon: Polygon;
  centroid?: Centroid;
  current_crop: string;
  soil_type: SoilType;
  region_id?: string;
  priority: Priority;
  planting_month?: number;
}): Promise<AnalysisRecord> {
  return request<AnalysisRecord>("/analyze", { method: "POST", body: JSON.stringify(input) }, ANALYSIS_TIMEOUT_MS);
}

/** GET /api/simulation-runs (optionally for one farm). */
export async function listAnalyses(farmId?: string): Promise<AnalysisSummary[]> {
  const q = farmId ? `?farm_id=${encodeURIComponent(farmId)}` : "";
  const body = await request<{ simulation_runs?: AnalysisSummary[]; analyses?: AnalysisSummary[] }>(`/simulation-runs${q}`);
  return body.simulation_runs ?? body.analyses ?? [];
}

export async function fetchAnalysis(id: string): Promise<AnalysisRecord> {
  return request<AnalysisRecord>(`/simulation-runs/${encodeURIComponent(id)}`);
}

export async function deleteAnalysis(id: string): Promise<void> {
  await request<void>(`/simulation-runs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function prefetchSatellite(lat: number, lon: number): void {
  request<{ ok: boolean }>("/analyses/prefetch", {
    method: "POST",
    body: JSON.stringify({ lat, lon }),
  }).catch(() => undefined);
}

export async function fetchSatelliteStatus(id: string): Promise<{
  status: "ready" | "pending" | "not_started";
  climate_source: string;
}> {
  return request(`/simulation-runs/${encodeURIComponent(id)}/satellite-status`);
}

export async function upgradeAnalysis(id: string): Promise<AnalysisRecord> {
  return request<AnalysisRecord>(
    `/simulation-runs/${encodeURIComponent(id)}/upgrade`,
    { method: "POST" },
    ANALYSIS_TIMEOUT_MS,
  );
}

/* ------------------------------------------------------------------ projects */

export interface ProjectSeasonInput {
  crop_id: string;
  target_water_mm?: number | null;
  input_cost_usd_ha?: number | null;
}

export async function createProject(input: {
  report_id: string;
  selected_strategy: "A" | "B" | "C" | StrategyId;
  name: string;
}): Promise<Project> {
  return (await request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify(input) })).project;
}

export async function listProjects(params?: { farm_id?: string; report_id?: string }): Promise<Project[]> {
  const qs = new URLSearchParams();
  if (params?.farm_id) qs.set("farm_id", params.farm_id);
  if (params?.report_id) qs.set("report_id", params.report_id);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return (await request<{ projects: Project[] }>(`/projects${q}`)).projects;
}

export async function getProject(id: string): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(`/projects/${encodeURIComponent(id)}`);
}

export async function updateProject(id: string, patch: { name?: string; seasons?: ProjectSeasonInput[] }): Promise<Project> {
  return (await request<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })).project;
}

export async function recalculateProject(id: string, seasons: ProjectSeasonInput[]): Promise<Project> {
  return (
    await request<{ project: Project }>(
      `/projects/${encodeURIComponent(id)}/recalculate`,
      { method: "POST", body: JSON.stringify({ seasons }) },
      ANALYSIS_TIMEOUT_MS,
    )
  ).project;
}

export async function deleteProject(id: string): Promise<void> {
  await request<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
