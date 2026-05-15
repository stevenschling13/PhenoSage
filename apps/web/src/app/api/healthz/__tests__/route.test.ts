import { describe, expect, it } from "vitest";
import { GET as healthzGET, runtime as healthzRuntime } from "../route";
import { GET as healthGET } from "../../health/route";

// /api/healthz is intentionally a thin re-export of /api/health so that
// uptime probers and load balancers using the conventional `/healthz`
// path get the same body and status as `/api/health`. These tests pin
// that contract so an accidental divergence (e.g. someone replacing the
// re-export with a different handler) would fail CI.
describe("GET /api/healthz", () => {
  it("re-exports the same GET handler as /api/health", () => {
    expect(healthzGET).toBe(healthGET);
  });

  it("returns 200 with the same shape as /api/health", async () => {
    const res = healthzGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("declares edge runtime (route-segment config can't be re-exported)", () => {
    expect(healthzRuntime).toBe("edge");
  });
});
