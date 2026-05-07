import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the Supabase SDK; getStorageClient should return its `.storage` accessor.
const storageSentinel = { __storage: true } as const;
const createClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

const ORIGINAL_ENV = process.env;

describe("getStorageClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    createClient.mockReset();
    createClient.mockReturnValue({ storage: storageSentinel });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role";
    const { getStorageClient } = await import("../storage");
    expect(() => getStorageClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    const { getStorageClient } = await import("../storage");
    expect(() => getStorageClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns the storage client built with the service role key", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role";
    const { getStorageClient } = await import("../storage");
    const storage = getStorageClient();
    expect(storage).toBe(storageSentinel);
    expect(createClient).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "service-role",
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
  });
});
