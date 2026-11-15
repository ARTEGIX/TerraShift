import { env } from "../config/env";
import type { PredictRequest, PredictResponse, ProjectRecalcRequest, ProjectRecalcResponse } from "../types/contract";
import { HttpError } from "../utils/HttpError";

/** HTTP client for the Python agronomy-engine. */
export async function predict(body: PredictRequest): Promise<PredictResponse> {
  let res: Response;
  try {
    res = await fetch(`${env.AGRONOMY_ENGINE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.AGRONOMY_TIMEOUT_MS),
    });
  } catch (err) {
    throw HttpError.badGateway("Agronomy engine unreachable", (err as Error).message);
  }

  if (res.status === 422) {
    throw HttpError.badRequest("Agronomy engine rejected the request", await res.json().catch(() => undefined));
  }
  if (!res.ok) {
    throw HttpError.badGateway(`Agronomy engine returned ${res.status}`, await res.text().catch(() => undefined));
  }
  return (await res.json()) as PredictResponse;
}

export async function listCrops(): Promise<unknown[]> {
  const res = await fetch(`${env.AGRONOMY_ENGINE_URL}/crops`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw HttpError.badGateway(`Agronomy engine returned ${res.status}`);
  return (await res.json()) as unknown[];
}

export async function engineHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${env.AGRONOMY_ENGINE_URL}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function projectRecalculate(body: ProjectRecalcRequest): Promise<ProjectRecalcResponse> {
  let res: Response;
  try {
    res = await fetch(`${env.AGRONOMY_ENGINE_URL}/predict/project-recalculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.AGRONOMY_TIMEOUT_MS),
    });
  } catch (err) {
    throw HttpError.badGateway("Agronomy engine unreachable", (err as Error).message);
  }

  if (res.status === 422) {
    throw HttpError.badRequest("Agronomy engine rejected the request", await res.json().catch(() => undefined));
  }
  if (!res.ok) {
    throw HttpError.badGateway(`Agronomy engine returned ${res.status}`, await res.text().catch(() => undefined));
  }
  return (await res.json()) as ProjectRecalcResponse;
}

export async function prefetchSatellite(lat: number, lon: number): Promise<void> {
  try {
    await fetch(`${env.AGRONOMY_ENGINE_URL}/prefetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Non-blocking best-effort prefetch
  }
}

export async function getSatelliteStatus(
  lat: number,
  lon: number,
): Promise<{ status: "ready" | "pending" | "not_started"; grid_key?: string }> {
  try {
    const res = await fetch(
      `${env.AGRONOMY_ENGINE_URL}/prefetch/status?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return { status: "not_started" };
    return (await res.json()) as { status: "ready" | "pending" | "not_started"; grid_key?: string };
  } catch {
    return { status: "not_started" };
  }
}
