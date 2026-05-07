import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Avoid hitting the real Supabase SDK; we only assert wiring behavior.
const createClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

const ORIGINAL_ENV = process.env;

describe("getDbClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    createClient.mockReset();
    createClient.mockReturnValue({ __db: true });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role";
    const { getDbClient } = await import("../db");
    expect(() => getDbClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    const { getDbClient } = await import("../db");
    expect(() => getDbClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("constructs a client with the service role key and disables session persistence", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role";
    const { getDbClient } = await import("../db");
    const client = getDbClient();
    expect(client).toEqual({ __db: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "service-role",
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
  });
});
