import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbClient = vi.fn();

vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { seedDefaultGrowForUser } from "../onboarding";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface MakeClientOpts {
  growCount?: {
    count: number | null;
    error: { message: string } | null;
  };
  insertResult?: {
    data: { id: string } | null;
    error: { message: string } | null;
  };
}

function makeClient(opts: MakeClientOpts = {}) {
  // grows count: db.from("grows").select("id", { count, head }).eq(...)
  const countResult = opts.growCount ?? { count: 0, error: null };
  const growsCountEq = vi.fn().mockResolvedValue(countResult);

  // grows insert: db.from("grows").insert({...}).select("id").single()
  const insertSingle = vi
    .fn()
    .mockResolvedValue(
      opts.insertResult ?? { data: { id: "g1" }, error: null },
    );
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const growsSelect = vi.fn(() => ({ eq: growsCountEq }));
  const from = vi.fn(() => ({ select: growsSelect, insert }));

  return { from, growsCountEq, insert, insertSingle };
}

beforeEach(() => {
  getDbClient.mockReset();
});

describe("seedDefaultGrowForUser", () => {
  it("skips insert when the user already owns at least one grow", async () => {
    const db = makeClient({ growCount: { count: 2, error: null } });
    getDbClient.mockReturnValue(db);
    const result = await seedDefaultGrowForUser({ userId: USER_ID });
    expect(result).toEqual({ kind: "already_has_grow", growCount: 2 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws when the grow count errors", async () => {
    const db = makeClient({
      growCount: { count: null, error: { message: "count boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(seedDefaultGrowForUser({ userId: USER_ID })).rejects.toThrow(
      /Failed to count existing grows: count boom/,
    );
  });

  it("inserts a default grow when the user has none", async () => {
    const db = makeClient({
      growCount: { count: 0, error: null },
      insertResult: { data: { id: "grow-new" }, error: null },
    });
    getDbClient.mockReturnValue(db);
    const result = await seedDefaultGrowForUser({ userId: USER_ID });
    expect(result).toEqual({ kind: "seeded", growId: "grow-new" });
    expect(db.insert).toHaveBeenCalledWith({
      owner_id: USER_ID,
      name: "My First Grow",
    });
  });

  it("throws when the insert errors", async () => {
    const db = makeClient({
      growCount: { count: 0, error: null },
      insertResult: { data: null, error: { message: "insert boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(seedDefaultGrowForUser({ userId: USER_ID })).rejects.toThrow(
      /Failed to seed default grow: insert boom/,
    );
  });
});
