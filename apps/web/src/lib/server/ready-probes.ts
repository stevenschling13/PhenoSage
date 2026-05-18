import "server-only";

/**
 * Connectivity probes used by the readiness endpoint.
 *
 * Each probe is bounded by an internal timeout so a single slow
 * dependency cannot stretch the whole readiness response. Probes run
 * in parallel from the route handler — order here doesn't imply order
 * of execution.
 *
 * Error messages from upstream are intentionally NOT surfaced — the
 * readiness endpoint is unauthenticated by design (load balancers
 * call it without credentials), so any field we put in `detail` is
 * effectively public. Only opaque codes like "timeout" / "unreachable"
 * / "bad-status" are emitted.
 */

export type ProbeResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  /**
   * Opaque short code when `ok=false` (e.g. "timeout", "unreachable",
   * "bad-status", "not-configured"). Never includes raw error text
   * from the upstream because this surface is unauthenticated.
   */
  detail?: string;
};

/**
 * Wrap a fetch in an `AbortController` so the probe can't outlive the
 * configured timeout. Returns a discriminated `{ ok, response }` /
 * `{ ok, reason }` so callers don't have to re-classify the failure.
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<
  | { ok: true; status: number }
  | { ok: false; reason: "timeout" | "unreachable" }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { ok: true, status: res.status };
  } catch (err) {
    // AbortError surfaces as DOMException on edge; check name to
    // distinguish from a real transport error so on-call gets the
    // useful signal.
    const name = (err as Error & { name?: string })?.name ?? "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function notConfigured(name: string): ProbeResult {
  return { name, ok: false, latencyMs: 0, detail: "not-configured" };
}

function timed(
  name: string,
  started: number,
  status: "ok" | "bad-status",
): ProbeResult {
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  if (status === "ok") return { name, ok: true, latencyMs };
  return { name, ok: false, latencyMs, detail: "bad-status" };
}

function failed(name: string, started: number, reason: string): ProbeResult {
  const latencyMs = Math.max(0, Math.round(performance.now() - started));
  return { name, ok: false, latencyMs, detail: reason };
}

/**
 * Supabase: hit the public `/auth/v1/health` endpoint with the anon
 * key. 200 = the project is reachable and not paused. We deliberately
 * don't issue a privileged query (e.g. `select 1` via PostgREST) so
 * the readiness endpoint can stay unauthenticated and so a brief RLS
 * misconfiguration can't mark the whole app as unready.
 */
export async function probeSupabase(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1500,
): Promise<ProbeResult> {
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anon) return notConfigured("supabase");
  const started = performance.now();
  const result = await probeFetch(
    `${url.replace(/\/$/, "")}/auth/v1/health`,
    { headers: { apikey: anon } },
    timeoutMs,
  );
  if (!result.ok) return failed("supabase", started, result.reason);
  return timed(
    "supabase",
    started,
    result.status === 200 ? "ok" : "bad-status",
  );
}

/**
 * Upstash Redis: REST `/ping` returns `PONG`. We skip the probe when
 * Upstash isn't configured (dev / preview environments use the
 * in-memory rate-limit fallback by design) rather than reporting it
 * as failed — the route's `ok` calculation excludes probes whose
 * detail is `not-configured`.
 */
export async function probeUpstash(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1500,
): Promise<ProbeResult> {
  const url = env["UPSTASH_REDIS_REST_URL"];
  const token = env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) return notConfigured("upstash");
  const started = performance.now();
  const result = await probeFetch(
    `${url.replace(/\/$/, "")}/ping`,
    { headers: { Authorization: `Bearer ${token}` } },
    timeoutMs,
  );
  if (!result.ok) return failed("upstash", started, result.reason);
  return timed("upstash", started, result.status === 200 ? "ok" : "bad-status");
}

/**
 * Analysis service: hit its `/health` endpoint with the shared bearer
 * token so a forgotten / rotated key fails the readiness check too,
 * not just a network outage.
 */
export async function probeAnalysisService(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1500,
): Promise<ProbeResult> {
  const url = env["ANALYSIS_SERVICE_URL"];
  const apiKey = env["ANALYSIS_SERVICE_API_KEY"];
  if (!url || !apiKey) return notConfigured("analysis-service");
  const started = performance.now();
  const result = await probeFetch(
    `${url.replace(/\/$/, "")}/health`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    timeoutMs,
  );
  if (!result.ok) return failed("analysis-service", started, result.reason);
  return timed(
    "analysis-service",
    started,
    result.status === 200 ? "ok" : "bad-status",
  );
}

/**
 * Decide whether a single probe counts toward the overall readiness
 * verdict. `not-configured` probes are reported but excluded — a dev
 * machine without Upstash configured should still be "ready" because
 * the rate limiter has an in-memory fallback.
 */
export function probeBlocksReadiness(probe: ProbeResult): boolean {
  if (probe.ok) return false;
  return probe.detail !== "not-configured";
}
