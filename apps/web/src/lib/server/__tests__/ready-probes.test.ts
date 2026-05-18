import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  probeAnalysisService,
  probeBlocksReadiness,
  probeSupabase,
  probeUpstash,
} from "../ready-probes";

function envWith(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    ANALYSIS_SERVICE_URL: "https://x.railway.app",
    ANALYSIS_SERVICE_API_KEY: "service-key",
    UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "rest-token",
  };
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

let fetchSpy: MockInstance;

beforeEach(() => {
  // `vi.spyOn(globalThis, "fetch")` returns the EXISTING spy on a
  // re-spy, so call history accumulates across tests within a file.
  // Restoring + re-spying every test gives each case a clean
  // `mock.calls[0]` to assert against.
  fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockReset();
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("probeSupabase", () => {
  it("returns ok when /auth/v1/health responds 200", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const result = await probeSupabase(envWith({}));
    expect(result.ok).toBe(true);
    expect(result.name).toBe("supabase");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // Verify we hit the correct URL with the apikey header so a probe
    // doesn't quietly stop validating the project's own identity.
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/auth/v1/health");
    expect(new Headers(init.headers).get("apikey")).toBe("anon-key");
  });

  it("returns bad-status when /auth/v1/health responds non-200", async () => {
    // A 503 from Supabase means the project is paused or experiencing
    // an outage — readiness must reflect that, otherwise traffic gets
    // routed to a degraded backend.
    fetchSpy.mockResolvedValue(new Response(null, { status: 503 }));
    const result = await probeSupabase(envWith({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("bad-status");
  });

  it("returns unreachable on transport error", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    const result = await probeSupabase(envWith({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("unreachable");
  });

  it("returns timeout when the fetch is aborted by the internal deadline", async () => {
    // Synthesize the same error the abort path produces. Verifying the
    // discrimination matters because on-call distinguishes "supabase
    // is slow" from "supabase is down" through this field.
    const abortErr = new Error("aborted");
    (abortErr as Error & { name?: string }).name = "AbortError";
    fetchSpy.mockRejectedValue(abortErr);
    const result = await probeSupabase(envWith({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("timeout");
  });

  it("returns not-configured when the URL or key is absent", async () => {
    // Probes that aren't configured must NOT leak through as failures
    // — `probeBlocksReadiness` returns false for this case so the
    // overall readiness verdict isn't tainted.
    const result = await probeSupabase(
      envWith({
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("probeUpstash", () => {
  it("returns ok when /ping responds 200", async () => {
    fetchSpy.mockResolvedValue(new Response("PONG", { status: 200 }));
    const result = await probeUpstash(envWith({}));
    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.upstash.io/ping");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer rest-token",
    );
  });

  it("returns not-configured when Upstash isn't wired up", async () => {
    // Dev / preview deploys use the in-memory rate-limit fallback by
    // design. Not configuring Upstash is a normal state, not a
    // readiness failure.
    const result = await probeUpstash(
      envWith({
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      }),
    );
    expect(result.detail).toBe("not-configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("probeAnalysisService", () => {
  it("hits /health with the bearer key", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const result = await probeAnalysisService(envWith({}));
    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.railway.app/health");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer service-key",
    );
  });

  it("returns bad-status when /health responds non-200", async () => {
    // A 401 here means our API key was rotated and we forgot to sync
    // it — readiness must reflect that, otherwise the proxy will fail
    // every analyze call with no warning at the platform layer.
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
    const result = await probeAnalysisService(envWith({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("bad-status");
  });
});

describe("probeBlocksReadiness", () => {
  it("does not block when the probe is ok", () => {
    expect(probeBlocksReadiness({ name: "x", ok: true, latencyMs: 12 })).toBe(
      false,
    );
  });

  it("does not block when the probe is not-configured", () => {
    // Critical invariant: a dev box without Upstash configured must
    // still report ready. Reversing this would make every preview
    // deploy mark itself unready and refuse traffic.
    expect(
      probeBlocksReadiness({
        name: "upstash",
        ok: false,
        latencyMs: 0,
        detail: "not-configured",
      }),
    ).toBe(false);
  });

  it("blocks when the probe failed for any other reason", () => {
    for (const detail of ["timeout", "unreachable", "bad-status"]) {
      expect(
        probeBlocksReadiness({
          name: "supabase",
          ok: false,
          latencyMs: 1500,
          detail,
        }),
      ).toBe(true);
    }
  });
});
