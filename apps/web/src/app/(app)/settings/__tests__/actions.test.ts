import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const upsert = vi.fn();
  const from = vi.fn(() => ({ upsert }));
  const dbStub = { from };
  const getDbClient = vi.fn(() => dbStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
    upsert,
    from,
    dbStub,
    getDbClient,
    getServerUser,
    revalidatePath,
    logServerEvent,
  };
});

vi.mock("@/lib/server/auth", () => ({
  getServerUser: mocks.getServerUser,
}));

vi.mock("@/lib/server/db", () => ({
  getDbClient: mocks.getDbClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/server/request-id", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { updateDisplayNameAction, updateTimezoneAction } from "../actions";

function buildFormData(displayName: string): FormData {
  const fd = new FormData();
  fd.set("displayName", displayName);
  return fd;
}

function buildTzFormData(timezone: string): FormData {
  const fd = new FormData();
  fd.set("timezone", timezone);
  return fd;
}

describe("updateDisplayNameAction", () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
    mocks.from.mockClear();
    mocks.getDbClient.mockReset().mockReturnValue(mocks.dbStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("upserts and returns success", async () => {
    mocks.upsert.mockResolvedValue({ error: null });
    const result = await updateDisplayNameAction(buildFormData("Steve"));
    expect(result.status).toBe("success");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { display_name: "Steve", id: "user-1" },
      { onConflict: "id" },
    );
  });

  it("returns structured error (does NOT throw) when service-role env is missing", async () => {
    mocks.getDbClient.mockImplementationOnce(() => {
      throw new Error("supabase service-role credential is required");
    });
    const result = await updateDisplayNameAction(buildFormData("Steve"));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't save your display name/i);
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("returns structured error when supabase upsert returns an error", async () => {
    mocks.upsert.mockResolvedValue({
      error: { message: "boom", code: "XX000" },
    });
    const result = await updateDisplayNameAction(buildFormData("Steve"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("boom");
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/settings;307;";
    mocks.getDbClient.mockImplementationOnce(() => {
      throw e;
    });
    await expect(updateDisplayNameAction(buildFormData("Steve"))).rejects.toBe(
      e,
    );
  });

  it("rejects display names over 60 characters without touching the db", async () => {
    const result = await updateDisplayNameAction(buildFormData("x".repeat(61)));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/under 60/i);
    expect(mocks.getDbClient).not.toHaveBeenCalled();
  });

  it("requires the user to be signed in", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await updateDisplayNameAction(buildFormData("Steve"));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
  });
});

describe("updateTimezoneAction", () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
    mocks.from.mockClear();
    mocks.getDbClient.mockReset().mockReturnValue(mocks.dbStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("upserts a valid IANA timezone and reports success", async () => {
    mocks.upsert.mockResolvedValue({ error: null });
    const result = await updateTimezoneAction(
      buildTzFormData("America/Los_Angeles"),
    );
    expect(result.status).toBe("success");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", timezone: "America/Los_Angeles" },
      { onConflict: "user_id" },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects unrecognised IANA names without touching the db", async () => {
    const result = await updateTimezoneAction(
      buildTzFormData("Mars/Olympus_Mons"),
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/don't recognise/i);
    expect(mocks.getDbClient).not.toHaveBeenCalled();
  });

  it("rejects an empty timezone without touching the db", async () => {
    const result = await updateTimezoneAction(buildTzFormData(""));
    expect(result.status).toBe("error");
    expect(mocks.getDbClient).not.toHaveBeenCalled();
  });

  it("maps SQLSTATE 22023 from the trigger to friendly copy", async () => {
    mocks.upsert.mockResolvedValue({
      error: { message: "raw provider text", code: "22023" },
    });
    const result = await updateTimezoneAction(buildTzFormData("UTC"));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/don't recognise/i);
    expect(result.message).not.toMatch(/raw provider text/);
  });

  it("falls back to generic copy for unmapped SQLSTATEs", async () => {
    mocks.upsert.mockResolvedValue({
      error: { message: "boom", code: "XX000" },
    });
    const result = await updateTimezoneAction(buildTzFormData("UTC"));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't save your timezone/i);
    expect(result.message).not.toMatch(/boom/);
  });

  it("requires the user to be signed in", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await updateTimezoneAction(buildTzFormData("UTC"));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
  });
});
