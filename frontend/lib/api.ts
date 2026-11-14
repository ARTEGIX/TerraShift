import { MOCK_ANALYSIS, MOCK_CROPS } from "./mock";
import type { AnalysisRecord, Centroid, CropInfo, Polygon, Priority, SoilType, UserProfile } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost/api";
const TOKEN_KEY = "terrashift_token";

export function getToken(): string | null {
  return typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<{ token: string; user: UserProfile }> {
  const data = await request<{ token: string; user: UserProfile }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function register(name: string, email: string, password: string): Promise<{ token: string; user: UserProfile }> {
  const data = await request<{ token: string; user: UserProfile }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  setToken(data.token);
  return data;
}

export async function fetchCrops(): Promise<CropInfo[]> {
  try {
    const { crops } = await request<{ crops: CropInfo[] }>("/crops");
    return crops;
  } catch {
    return MOCK_CROPS;
  }
}

export async function createAnalysis(input: {
  polygon: Polygon;
  centroid?: Centroid;
  current_crop: string;
  soil_type: SoilType;
  priority: Priority;
}): Promise<AnalysisRecord> {
  return request<AnalysisRecord>("/analyses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchAnalysis(id: string): Promise<AnalysisRecord> {
  if (id === "demo") return MOCK_ANALYSIS;
  try {
    return await request<AnalysisRecord>(`/analyses/${id}`);
  } catch {
    return MOCK_ANALYSIS;
  }
}
