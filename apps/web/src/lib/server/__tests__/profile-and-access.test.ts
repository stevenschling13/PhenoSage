import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();
const getServerUser = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));

import { getAuthorizedPlantContext } from "../plant-access";
import { getCurrentProfile } from "../profile";

const ORIGINAL_ENV = process.env;

function makeMaybeSingleMock(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return { client: { from }, eq, from, maybeSingle, select };
}

describe("profile and plant access helpers", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    createSupabaseServerClient.mockReset();
    getServerUser.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns null for profile and plant context when no user is authenticated", async () => {
    getServerUser.mockResolvedValue(null);

    await expect(getCurrentProfile()).resolves.toBeNull();
    await expect(getAuthorizedPlantContext("plant-1")).resolves.toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps the authenticated user's profile with nullable display name and email", async () => {
    getServerUser.mockResolvedValue({
      email: "grower@example.com",
      id: "user-1",
    });
    const { client, eq, from, select } = makeMaybeSingleMock({
      data: { display_name: "Casey" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(getCurrentProfile()).resolves.toEqual({
      displayName: "Casey",
      email: "grower@example.com",
      id: "user-1",
    });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("display_name");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("throws a stable profile error when the profile lookup fails", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const { client } = makeMaybeSingleMock({
      data: null,
      error: { message: "profile table offline" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(getCurrentProfile()).rejects.toThrow(
      "Failed to load current profile: profile table offline",
    );
  });

  it("maps authorized plant context used by analysis and timeline routes", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const { client, eq, from, select } = makeMaybeSingleMock({
      data: {
        grow_id: "grow-1",
        grows: {
          id: "grow-1",
          light_type: "LED",
          medium: "soil",
          stage: "flower",
          start_date: "2026-04-01",
        },
        id: "plant-1",
        name: "Blue Dream #1",
        notes: "Watch lower leaves",
        strain: "Blue Dream",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(getAuthorizedPlantContext("plant-1")).resolves.toEqual({
      growId: "grow-1",
      growStage: "flower",
      lightType: "LED",
      medium: "soil",
      notes: "Watch lower leaves",
      plantId: "plant-1",
      plantName: "Blue Dream #1",
      startDate: "2026-04-01",
      strain: "Blue Dream",
      userId: "user-1",
    });
    expect(from).toHaveBeenCalledWith("plants");
    expect(select).toHaveBeenCalledWith(
      "id,name,strain,notes,grow_id,grows!inner(id,stage,medium,light_type,start_date)",
    );
    expect(eq).toHaveBeenCalledWith("id", "plant-1");
  });

  it("returns null when the requested plant is not accessible", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const { client } = makeMaybeSingleMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(getAuthorizedPlantContext("missing")).resolves.toBeNull();
  });
});
