import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock probe helpers so the route test isn't an integration test of
// the probes themselves (those are exercised by ready-probes.test.ts).
const mocks = vi.hoisted(() => ({
  probeSupabase: vi.fn(),
  probeUpstash: vi.fn(),
  probeAnalysisService: vi.fn(),
}));
vi.mock("@/lib/server/ready-probes", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/server/ready-probes")
  >("@/lib/server/ready-probes");
  return {
    ...actual,
    probeSupabase: mocks.probeSupabase,
    probeUpstash: mocks.probeUpstash,
    probeAnalysisService: mocks.probeAnalysisService,
  };
});

import { GET } from "../route";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mocks.probeSupabase.mockReset();
  mocks.probeUpstash.mockReset();
  mocks.probeAnalysisService.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function envOk() {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
  process.env["ANALYSIS_SERVICE_URL"] = "https://x.railway.app";
  process.env["ANALYSIS_SERVICE_API_KEY"] = "key";
}

function probesAllOk() {
  mocks.probeSupabase.mockResolvedValue({
    name: "supabase",
    ok: true,
    latencyMs: 12,
  });
  mocks.probeUpstash.mockResolvedValue({
    name: "upstash",
    ok: true,
    latencyMs: 8,
  });
  mocks.probeAnalysisService.mockResolvedValue({
    name: "analysis-service",
    ok: true,
    latencyMs: 34,
  });
}

describe("GET /api/ready", () => {
  it("returns 200 when env is complete and every probe is ok", async () => {
    envOk();
    probesAllOk();

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
    expect(body.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(body.probes).toHaveLength(3);
    expect(body.probes.every((p: { ok: boolean }) => p.ok)).toBe(true);
  });

  it("returns 503 when required env is missing (preserves legacy behaviour)", async () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    delete process.env["ANALYSIS_SERVICE_URL"];
    delete process.env["ANALYSIS_SERVICE_API_KEY"];
    probesAllOk();

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
  });

  it("returns 503 when env is fine but a probe failed for a real reason", async () => {
    // Crucial signal: a Supabase outage must mark the app unready so
    // the load balancer takes us out of rotation. The legacy version
    // of this endpoint missed this entirely — it would have stayed
    // green even with Supabase down hard.
    envOk();
    mocks.probeSupabase.mockResolvedValue({
      name: "supabase",
      ok: false,
      latencyMs: 1500,
      detail: "timeout",
    });
    mocks.probeUpstash.mockResolvedValue({
      name: "upstash",
      ok: true,
      latencyMs: 8,
    });
    mocks.probeAnalysisService.mockResolvedValue({
      name: "analysis-service",
      ok: true,
      latencyMs: 34,
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("not_ready");
    // The failing probe is still surfaced so on-call can see WHY.
    const failed = body.probes.find(
      (p: { name: string }) => p.name === "supabase",
    );
    expect(failed.ok).toBe(false);
    expect(failed.detail).toBe("timeout");
  });

  it("stays ready when only an OPTIONAL probe (not-configured) is missing", async () => {
    // Pins the dev-mode contract: a preview deploy without Upstash
    // configured uses the in-memory rate-limit fallback and must
    // still report ready.
    envOk();
    mocks.probeSupabase.mockResolvedValue({
      name: "supabase",
      ok: true,
      latencyMs: 12,
    });
    mocks.probeUpstash.mockResolvedValue({
      name: "upstash",
      ok: false,
      latencyMs: 0,
      detail: "not-configured",
    });
    mocks.probeAnalysisService.mockResolvedValue({
      name: "analysis-service",
      ok: true,
      latencyMs: 34,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("runs the three probes in parallel (not sequentially)", async () => {
    // The route must not stack probe latencies — if each takes 500ms
    // serial would make the readiness call >1500ms. Parallel keeps
    // it ~500ms. We assert this by spying on the call timestamps.
    envOk();
    const startTimes: number[] = [];
    const slowProbe = (name: string) => async () => {
      startTimes.push(performance.now());
      await new Promise((r) => setTimeout(r, 50));
      return { name, ok: true, latencyMs: 50 };
    };
    mocks.probeSupabase.mockImplementation(slowProbe("supabase"));
    mocks.probeUpstash.mockImplementation(slowProbe("upstash"));
    mocks.probeAnalysisService.mockImplementation(
      slowProbe("analysis-service"),
    );

    await GET();
    expect(startTimes).toHaveLength(3);
    // All three should start within a few ms of each other — much
    // less than the 50ms each probe sleeps.
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(20);
  });
});
