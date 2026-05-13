import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

describe("GET /api/chat/diag", () => {
  const origEnv = process.env;
  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.COMMIT_SHA;
    delete process.env.GITHUB_SHA;
  });
  afterEach(() => {
    process.env = origEnv;
    vi.restoreAllMocks();
  });

  it("returns ok=false and a clear hint when no Gemini alias is set", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      buildSha: string;
      buildShaShort: string;
      aliases: Record<string, boolean>;
      aiEnvInventory: string[];
      hint: string;
    };
    expect(body.ok).toBe(false);
    expect(body.aliases).toEqual({
      GEMINI_API_KEY: false,
      GOOGLE_GENERATIVE_AI_API_KEY: false,
      GOOGLE_API_KEY: false,
    });
    expect(body.hint).toMatch(/No Gemini key alias/i);
  });

  it("returns ok=true when GEMINI_API_KEY is set, without leaking the value", async () => {
    process.env.GEMINI_API_KEY = "AIza-secret-value";
    const res = await GET();
    const body = (await res.json()) as {
      ok: boolean;
      aliases: Record<string, boolean>;
      aiEnvInventory: string[];
      hint: string;
    };
    expect(body.ok).toBe(true);
    expect(body.aliases.GEMINI_API_KEY).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("AIza-secret-value");
    expect(body.hint).toMatch(/At least one Gemini key alias is set/i);
  });

  it("recognises GOOGLE_GENERATIVE_AI_API_KEY and GOOGLE_API_KEY aliases", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "v1";
    process.env.GOOGLE_API_KEY = "v2";
    const res = await GET();
    const body = (await res.json()) as {
      ok: boolean;
      aliases: Record<string, boolean>;
    };
    expect(body.ok).toBe(true);
    expect(body.aliases.GOOGLE_GENERATIVE_AI_API_KEY).toBe(true);
    expect(body.aliases.GOOGLE_API_KEY).toBe(true);
  });

  it("includes the build SHA from VERCEL_GIT_COMMIT_SHA", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const res = await GET();
    const body = (await res.json()) as {
      buildSha: string;
      buildShaShort: string;
    };
    expect(body.buildSha).toBe("abcdef1234567890");
    expect(body.buildShaShort).toBe("abcdef1");
  });

  it("falls back to 'unknown' when no SHA env is set", async () => {
    const res = await GET();
    const body = (await res.json()) as { buildSha: string };
    expect(body.buildSha).toBe("unknown");
  });

  it("lists key-shaped env names but never their values", async () => {
    process.env.GEMINI_API_KEY = "secret-gemini";
    process.env.SOME_OTHER_API_KEY = "secret-other";
    process.env.UNRELATED_VAR = "ignored";
    const res = await GET();
    const body = (await res.json()) as { aiEnvInventory: string[] };
    expect(body.aiEnvInventory).toContain("GEMINI_API_KEY");
    expect(body.aiEnvInventory).toContain("SOME_OTHER_API_KEY");
    expect(body.aiEnvInventory).not.toContain("UNRELATED_VAR");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("secret-gemini");
    expect(raw).not.toContain("secret-other");
  });

  it("sets no-store cache header so a stale CDN copy can never mask reality", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control") || "").toMatch(/no-store/i);
  });
});
