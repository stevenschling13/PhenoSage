import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbClient = vi.fn();

vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { seedDefaultGrowForUser } from "../onboarding";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface MakeClientOpts {
  userLookup: {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  growCount?: {
    count: number | null;
    error: { message: string } | null;
  };
  insertResult?: {
    data: { id: string } | null;
    error: { message: string } | null;
  };
}

function makeClient(opts: MakeClientOpts) {
  // auth.users lookup: db.schema("auth").from("users").select("id").eq("id", ...).maybeSingle()
  const userMaybeSingle = vi.fn().mockResolvedValue(opts.userLookup);
  const userEq = vi.fn(() => ({ maybeSingle: userMaybeSingle }));
  const userSelect = vi.fn(() => ({ eq: userEq }));
  const authFrom = vi.fn(() => ({ select: userSelect }));
  const schema = vi.fn(() => ({ from: authFrom }));

  // grows count: db.from("grows").select(..., { count, head }).eq(...)
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

  // Branch on whether the call is a count select or an insert
  const growsSelect = vi.fn(() => ({ eq: growsCountEq }));
  const publicFrom = vi.fn(() => ({ select: growsSelect, insert }));

  const from = vi.fn((table: string) => {
    if (table === "grows") return publicFrom();
    return { select: vi.fn() };
  });

  return {
    schema,
    from,
    publicFrom,
    growsCountEq,
    insert,
    insertSingle,
    userMaybeSingle,
  };
}

beforeEach(() => {
  getDbClient.mockReset();
});

describe("seedDefaultGrowForUser", () => {
  it("returns user_not_found when the auth.users row is missing", async () => {
    const db = makeClient({ userLookup: { data: null, error: null } });
    getDbClient.mockReturnValue(db);
    const result = await seedDefaultGrowForUser({ userId: USER_ID });
    expect(result).toEqual({ kind: "user_not_found" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws when the auth lookup errors", async () => {
    const db = makeClient({
      userLookup: { data: null, error: { message: "auth boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(seedDefaultGrowForUser({ userId: USER_ID })).rejects.toThrow(
      /Failed to look up auth user: auth boom/,
    );
  });

  it("skips insert when the user already owns at least one grow", async () => {
    const db = makeClient({
      userLookup: { data: { id: USER_ID }, error: null },
      growCount: { count: 2, error: null },
    });
    getDbClient.mockReturnValue(db);
    const result = await seedDefaultGrowForUser({ userId: USER_ID });
    expect(result).toEqual({ kind: "already_has_grow", growCount: 2 });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws when the grow count errors", async () => {
    const db = makeClient({
      userLookup: { data: { id: USER_ID }, error: null },
      growCount: { count: null, error: { message: "count boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(seedDefaultGrowForUser({ userId: USER_ID })).rejects.toThrow(
      /Failed to count existing grows: count boom/,
    );
  });

  it("inserts a default grow when the user has none", async () => {
    const db = makeClient({
      userLookup: { data: { id: USER_ID }, error: null },
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
      userLookup: { data: { id: USER_ID }, error: null },
      growCount: { count: 0, error: null },
      insertResult: { data: null, error: { message: "insert boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(seedDefaultGrowForUser({ userId: USER_ID })).rejects.toThrow(
      /Failed to seed default grow: insert boom/,
    );
  });
});
