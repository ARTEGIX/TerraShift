import { env } from "../config/env";
import type { PredictRequest, PredictResponse } from "../types/contract";
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
