import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserClientSentinel = { __browserClient: true } as const;
const createBrowserClient = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createBrowserClient,
}));

const ORIGINAL_ENV = process.env;

describe("createSupabaseBrowserClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    createBrowserClient.mockReset();
    createBrowserClient.mockReturnValue(browserClientSentinel);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
    const { createSupabaseBrowserClient } = await import("../browser");
    expect(() => createSupabaseBrowserClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    const { createSupabaseBrowserClient } = await import("../browser");
    expect(() => createSupabaseBrowserClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("returns a client built from the public env vars", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
    const { createSupabaseBrowserClient } = await import("../browser");
    const client = createSupabaseBrowserClient();
    expect(client).toBe(browserClientSentinel);
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "anon",
    );
  });
});
