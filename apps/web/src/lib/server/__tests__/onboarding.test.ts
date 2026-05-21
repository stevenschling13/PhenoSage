import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbClient = vi.fn();

vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { reconcileOnboarding, seedDefaultGrowForUser } from "../onboarding";

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

describe("reconcileOnboarding", () => {
  function makeReconcileClient(opts: {
    rpcResult: { data: unknown; error: { message: string } | null };
    perUserCounts?: Array<{
      count: number | null;
      error: { message: string } | null;
    }>;
    perUserInserts?: Array<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  }) {
    const rpc = vi.fn().mockResolvedValue(opts.rpcResult);

    let countCall = 0;
    let insertCall = 0;

    const growsCountEq = vi.fn().mockImplementation(() => {
      const result = opts.perUserCounts?.[countCall] ?? {
        count: 0,
        error: null,
      };
      countCall++;
      return Promise.resolve(result);
    });
    const growsSelect = vi.fn(() => ({ eq: growsCountEq }));

    const insertSingle = vi.fn().mockImplementation(() => {
      const result = opts.perUserInserts?.[insertCall] ?? {
        data: { id: `grow-${insertCall}` },
        error: null,
      };
      insertCall++;
      return Promise.resolve(result);
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));

    const from = vi.fn(() => ({ select: growsSelect, insert }));
    return { from, rpc };
  }

  it("returns zeros when the RPC reports no orphans", async () => {
    const db = makeReconcileClient({ rpcResult: { data: [], error: null } });
    getDbClient.mockReturnValue(db);
    const report = await reconcileOnboarding();
    expect(report).toEqual({ scanned: 0, seeded: 0, errored: 0 });
    expect(db.rpc).toHaveBeenCalledWith("find_users_without_default_grow", {
      p_limit: 200,
    });
  });

  it("throws when the RPC returns an error", async () => {
    const db = makeReconcileClient({
      rpcResult: { data: null, error: { message: "rpc boom" } },
    });
    getDbClient.mockReturnValue(db);
    await expect(reconcileOnboarding()).rejects.toThrow(
      /Failed to enumerate orphan users: rpc boom/,
    );
  });

  it("seeds each orphan and reports counts", async () => {
    const orphans = ["u1", "u2", "u3"];
    const db = makeReconcileClient({
      rpcResult: { data: orphans, error: null },
    });
    getDbClient.mockReturnValue(db);
    const report = await reconcileOnboarding();
    expect(report).toEqual({ scanned: 3, seeded: 3, errored: 0 });
  });

  it("counts a per-user insert failure as errored, not abort", async () => {
    const orphans = ["u1", "u2"];
    const db = makeReconcileClient({
      rpcResult: { data: orphans, error: null },
      perUserCounts: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
      perUserInserts: [
        { data: null, error: { message: "insert boom" } },
        { data: { id: "g2" }, error: null },
      ],
    });
    getDbClient.mockReturnValue(db);
    const report = await reconcileOnboarding();
    expect(report).toEqual({ scanned: 2, seeded: 1, errored: 1 });
  });

  it("treats a webhook race (user gained a grow between enumerate and seed) as no-op", async () => {
    const orphans = ["u1"];
    const db = makeReconcileClient({
      rpcResult: { data: orphans, error: null },
      perUserCounts: [{ count: 1, error: null }],
    });
    getDbClient.mockReturnValue(db);
    const report = await reconcileOnboarding();
    expect(report).toEqual({ scanned: 1, seeded: 0, errored: 0 });
  });

  it("accepts row-object shape from the RPC ({ id })", async () => {
    const db = makeReconcileClient({
      rpcResult: { data: [{ id: "u1" }, { id: "u2" }], error: null },
    });
    getDbClient.mockReturnValue(db);
    const report = await reconcileOnboarding();
    expect(report.scanned).toBe(2);
  });
});
