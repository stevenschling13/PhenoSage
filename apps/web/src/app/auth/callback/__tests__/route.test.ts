import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();
const createSupabaseServerClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));

import { GET } from "../route";
import { AuthConfigError } from "@/lib/server/auth-errors";

function makeRequest(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/auth/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function locationOf(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("no Location header");
  return new URL(loc);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    (createSupabaseServerClient as Mock).mockReset();
    exchangeCodeForSession.mockReset();
    createSupabaseServerClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
  });

  it("redirects to /auth?error=... when provider returns error_description", async () => {
    const res = await GET(
      makeRequest({ error_description: "Email link expired" }),
    );
    expect(res.status).toBeGreaterThanOrEqual(300);
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth");
    expect(loc.searchParams.get("error")).toBe("Email link expired");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("falls back to error param when only `error` is provided", async () => {
    const res = await GET(makeRequest({ error: "access_denied" }));
    expect(locationOf(res).searchParams.get("error")).toBe("access_denied");
  });

  it("redirects to /auth with friendly copy when code is missing", async () => {
    const res = await GET(makeRequest({}));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth");
    expect(loc.searchParams.get("error")).toMatch(/missing information/i);
  });

  it("exchanges the code and redirects to /dashboard by default", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(makeRequest({ code: "abc" }));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/dashboard");
    expect(loc.searchParams.get("error")).toBeNull();
  });

  it("honours a same-origin `next` redirect target", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(makeRequest({ code: "abc", next: "/plants" }));
    expect(locationOf(res).pathname).toBe("/plants");
  });

  // Open-redirect protection — these inputs MUST collapse to /dashboard.
  it.each([
    ["protocol-relative", "//evil.com/steal"],
    ["protocol-relative-backslash", "/\\evil.com"],
    ["full url", "https://evil.com/steal"],
    ["scheme-only", "javascript:alert(1)"],
    ["empty", ""],
  ])(
    "rejects unsafe `next` value (%s) and uses /dashboard",
    async (_, next) => {
      exchangeCodeForSession.mockResolvedValue({ error: null });
      const res = await GET(makeRequest({ code: "abc", next }));
      const loc = locationOf(res);
      expect(loc.origin).toBe("http://localhost");
      expect(loc.pathname).toBe("/dashboard");
    },
  );

  it("redirects with friendly copy when exchange returns an error", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { name: "AuthApiError", code: "invalid_credentials", status: 400 },
    });
    const res = await GET(makeRequest({ code: "abc" }));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth");
    // describeAuthError maps invalid_credentials -> friendly copy
    expect(loc.searchParams.get("error")).toMatch(/email and password/i);
  });

  it("redirects with AUTH_MISCONFIGURED when AuthConfigError is thrown", async () => {
    createSupabaseServerClient.mockRejectedValueOnce(
      new AuthConfigError(["NEXT_PUBLIC_SUPABASE_URL"]),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest({ code: "abc" }));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth");
    expect(loc.searchParams.get("error")).toMatch(/temporarily unavailable/i);
    errSpy.mockRestore();
  });

  it("redirects with AUTH_SERVICE_UNREACHABLE when supabase throws an unknown error", async () => {
    createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest({ code: "abc" }));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth");
    expect(loc.searchParams.get("error")).toMatch(
      /couldn't reach the authentication service/i,
    );
    errSpy.mockRestore();
  });

  it("never includes raw provider error text directly in the redirect when exchange fails with network", async () => {
    // AuthRetryableFetchError -> AUTH_SERVICE_UNREACHABLE
    exchangeCodeForSession.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", message: "fetch failed" },
    });
    const res = await GET(makeRequest({ code: "abc" }));
    const errorParam = locationOf(res).searchParams.get("error") ?? "";
    expect(errorParam).not.toContain("fetch failed");
    expect(errorParam).toMatch(/couldn't reach/i);
  });
});
