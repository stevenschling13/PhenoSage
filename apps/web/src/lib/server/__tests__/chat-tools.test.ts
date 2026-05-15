import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();
const logServerEvent = vi.fn();
const getPlantTimeline = vi.fn();
const runAndPersistPlantAnalysis = vi.fn();
const rateLimit = vi.fn();
const persistSingleFindingEmbeddingBestEffort = vi.fn();
const executeSearchSimilarFindingsTool = vi.fn();

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));
vi.mock("../plants", () => ({
  getPlantTimeline: (...args: unknown[]) => getPlantTimeline(...args),
  runAndPersistPlantAnalysis: (...args: unknown[]) =>
    runAndPersistPlantAnalysis(...args),
}));
vi.mock("../chat-tool-policies", () => ({
  // Default: allow every call. Suite-specific tests override via
  // `rateLimit.mockResolvedValueOnce(...)` to exercise the limit branch.
  // We use the existing `rateLimit` symbol to map onto the policy check
  // so the per-tool rate-limit test continues to look natural.
  checkPerToolRateLimit: async (
    name: string,
    ctx: { userId: string | null; requestId: string },
  ) => {
    // Only consult the mock if a per-tool policy exists for this tool;
    // otherwise allow unconditionally (matches the real helper).
    const policied = new Set([
      "trigger_plant_analysis",
      "create_plants",
      "create_grow",
      "record_image_finding",
      "search_similar_findings",
    ]);
    if (!policied.has(name)) return { ok: true };
    const r = await rateLimit({
      key: `chat-tool:${name}:${ctx.userId ?? "anonymous"}`,
      limit: 1,
      windowMs: 1,
    });
    if (r.ok) return { ok: true };
    return {
      ok: false,
      error: `rate limit: too many ${name} calls in a row; retry in ~1s`,
    };
  },
}));
vi.mock("../embeddings", () => ({
  persistSingleFindingEmbeddingBestEffort: (...args: unknown[]) =>
    persistSingleFindingEmbeddingBestEffort(...args),
}));
vi.mock("../semantic-findings", () => ({
  executeSearchSimilarFindingsTool: (...args: unknown[]) =>
    executeSearchSimilarFindingsTool(...args),
}));

// Default behavior for the mocked rateLimit: always permit. Tests that
// need to assert the limited branch override per-test with mockResolvedValueOnce.
rateLimit.mockResolvedValue({
  ok: true,
  remaining: 99,
  resetAt: Date.now() + 60_000,
});

import { CHAT_TOOL_DEFINITIONS, executeChatTool } from "../chat-tools";

type SingleResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type ListResult = {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
};

// Builds a flexible select-chain mock for list-style queries:
//   .from(t).select(...).order(...).order(...).limit(...).eq(...).in(...)
// The final awaited value is `result`. Chain methods are all idempotent
// (return the same chainable proxy) so callers can mix and match.
type SelectChainKey = "select" | "order" | "limit" | "eq" | "in" | "or";
type SelectChain = Record<SelectChainKey, ReturnType<typeof vi.fn>> &
  PromiseLike<ListResult>;

function makeSelectChainMock(result: ListResult) {
  const calls: Record<SelectChainKey, unknown[][]> = {
    eq: [],
    in: [],
    limit: [],
    or: [],
    order: [],
    select: [],
  };
  const chain = {} as SelectChain;
  const KEYS: SelectChainKey[] = ["select", "order", "limit", "eq", "in", "or"];
  for (const key of KEYS) {
    chain[key] = vi.fn((...args: unknown[]) => {
      calls[key].push(args);
      return chain;
    });
  }
  // Make the chain awaitable: callers do `await q` after the last filter.
  chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  const from = vi.fn(() => chain);
  return { calls, chain, client: { from }, from };
}

function makeInsertMock(result: SingleResult) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from }, from, insert, select, single };
}

// Bulk insert chain: .from(t).insert(rows).select(...) → thenable yielding
// { data: rows[], error }. Mirrors the chain used by createPlantAction.
function makeBulkInsertMock(result: ListResult) {
  const select = vi.fn(
    (..._args: unknown[]) =>
      ({
        then: (
          onFulfilled: (_v: ListResult) => unknown,
          onRejected?: (_e: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      }) as PromiseLike<ListResult>,
  );
  let lastRows: unknown[] = [];
  const insert = vi.fn((rows: unknown) => {
    lastRows = Array.isArray(rows) ? rows : [rows];
    return { select };
  });
  const from = vi.fn(() => ({ insert }));
  return {
    client: { from },
    from,
    insert,
    select,
    lastRows: () => lastRows,
  };
}

// Per-table mock: from(table) returns a chain that records every method
// call and resolves to the configured value for that table. Chains support
// the full surface used by the new analytics tools — select/eq/in/is/gte/
// order/limit/maybeSingle — and are awaitable for the count-only form.
type CountResult = {
  // Either a list result (for awaitable count queries) or a single object
  // for maybeSingle() reads. The router mock branches on which terminal
  // the executor uses, so callers can configure either shape per table.
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type LazyChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
} & PromiseLike<CountResult>;

function makeTableRouterMock(byTable: Record<string, CountResult>) {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {};
  const from = vi.fn((table: string) => {
    const result = byTable[table] ?? {
      data: null,
      error: { message: `no mock for table ${table}` },
    };
    calls[table] = calls[table] ?? [];
    const log =
      (method: string) =>
      (...args: unknown[]) => {
        calls[table]!.push({ method, args });
        return chain;
      };
    const chain = {} as LazyChain;
    chain.select = vi.fn(log("select"));
    chain.eq = vi.fn(log("eq"));
    chain.in = vi.fn(log("in"));
    chain.is = vi.fn(log("is"));
    chain.gte = vi.fn(log("gte"));
    chain.order = vi.fn(log("order"));
    chain.limit = vi.fn(log("limit"));
    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: result.data, error: result.error });
    chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
    return chain;
  });
  return { client: { from }, from, calls };
}

// .update(payload).eq(col, val).select(...).maybeSingle()
function makeUpdateEqMaybeSingleMock(result: SingleResult) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from }, eq, from, maybeSingle, select, update };
}

// Note: `supabase` is intentionally omitted (not set to undefined) because
// the project's `exactOptionalPropertyTypes: true` rejects explicit-undefined
// assignment to optional fields. Tool executor falls back to constructing a
// client via the mocked `createSupabaseServerClient`.
const CTX_AUTHED = {
  requestId: "req-123",
  userId: "user-1",
};

describe("chat-tools — write tool definitions", () => {
  it("exposes log_grow_event and log_plant_observation in the OpenAI tool list", () => {
    const names = CHAT_TOOL_DEFINITIONS.map((t) => t.function.name).sort();
    expect(names).toContain("log_grow_event");
    expect(names).toContain("log_plant_observation");
    expect(names).toContain("search_similar_findings");
  });

  it("log_grow_event declares required growId + eventType only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "log_grow_event",
    );
    expect(def?.function.parameters?.required).toEqual(["growId", "eventType"]);
  });

  it("log_plant_observation declares required plantId + growId only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "log_plant_observation",
    );
    expect(def?.function.parameters?.required).toEqual(["plantId", "growId"]);
  });
});

describe("chat-tools — log_grow_event", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inserts a row attributed to the current user and returns the new id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));

    const { client, from, insert } = makeInsertMock({
      data: {
        event_type: "feed",
        grow_id: "grow-1",
        id: "evt-1",
        notes: "FloraNova @ 800 EC",
        occurred_at: "2026-05-14T12:00:00.000Z",
        plant_id: "plant-3",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_grow_event",
      {
        eventType: "feed",
        growId: "grow-1",
        notes: "FloraNova @ 800 EC",
        plantId: "plant-3",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      data: expect.objectContaining({ event_type: "feed", id: "evt-1" }),
      ok: true,
    });
    expect(from).toHaveBeenCalledWith("grow_events");
    expect(insert).toHaveBeenCalledWith({
      event_type: "feed",
      grow_id: "grow-1",
      notes: "FloraNova @ 800 EC",
      occurred_at: "2026-05-14T12:00:00.000Z",
      plant_id: "plant-3",
      user_id: "user-1",
    });

    const audit = logServerEvent.mock.calls.at(-1)?.[2];
    expect(audit).toMatchObject({
      argKeys: ["eventType", "growId", "notes", "plantId"],
      ok: true,
      rowId: "evt-1",
      tool: "log_grow_event",
      write: true,
    });
  });

  it("defaults occurred_at to now and plant_id to null when omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));

    const { client, insert } = makeInsertMock({
      data: { id: "evt-2" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "log_grow_event",
      { eventType: "water", growId: "grow-1" },
      CTX_AUTHED,
    );

    expect(insert).toHaveBeenCalledWith({
      event_type: "water",
      grow_id: "grow-1",
      notes: null,
      occurred_at: "2026-05-14T12:00:00.000Z",
      plant_id: null,
      user_id: "user-1",
    });
  });

  it("rejects when the user is not authenticated and never inserts", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_grow_event",
      { eventType: "water", growId: "grow-1" },
      { requestId: "req-x", userId: null },
    );
    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown event_type without touching the database", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_grow_event",
      { eventType: "smoke_break", growId: "grow-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid arguments/);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an occurred_at more than a minute in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    const future = new Date("2026-05-14T12:05:00.000Z").toISOString();

    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_grow_event",
      { eventType: "feed", growId: "grow-1", occurredAt: future },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("translates an RLS denial into a user-friendly access error", async () => {
    const { client } = makeInsertMock({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table grow_events",
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_grow_event",
      { eventType: "feed", growId: "someone-elses-grow" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error: "you do not have access to this grow",
      ok: false,
    });

    const audit = logServerEvent.mock.calls.at(-1);
    expect(audit?.[0]).toBe("warn");
    expect(audit?.[2]).toMatchObject({
      ok: false,
      tool: "log_grow_event",
      write: true,
    });
  });
});

describe("chat-tools — log_plant_observation", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inserts an observation with height + notes and returns the new id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));

    const { client, from, insert } = makeInsertMock({
      data: {
        grow_id: "grow-1",
        height_cm: 45.5,
        id: "obs-1",
        notes: "Pistils fattening",
        observed_at: "2026-05-14T12:00:00.000Z",
        plant_id: "plant-3",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_plant_observation",
      {
        growId: "grow-1",
        heightCm: 45.5,
        notes: "Pistils fattening",
        plantId: "plant-3",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      data: expect.objectContaining({ id: "obs-1" }),
      ok: true,
    });
    expect(from).toHaveBeenCalledWith("plant_observations");
    expect(insert).toHaveBeenCalledWith({
      grow_id: "grow-1",
      height_cm: 45.5,
      notes: "Pistils fattening",
      observed_at: "2026-05-14T12:00:00.000Z",
      plant_id: "plant-3",
      user_id: "user-1",
    });
  });

  it("requires at least one of heightCm or notes", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_plant_observation",
      { growId: "grow-1", plantId: "plant-3" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/heightCm|notes/);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a negative or zero height", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_plant_observation",
      { growId: "grow-1", heightCm: 0, notes: "x", plantId: "plant-3" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("translates an RLS denial into a user-friendly access error", async () => {
    const { client } = makeInsertMock({
      data: null,
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "log_plant_observation",
      { growId: "g", notes: "x", plantId: "p" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error: "you do not have access to this plant",
      ok: false,
    });
  });
});

describe("chat-tools — mark_finding_resolved", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is exposed in the tool list and requires findingId + resolved", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "mark_finding_resolved",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters?.required).toEqual([
      "findingId",
      "resolved",
    ]);
  });

  it("sets resolved_at to now when resolved=true and no resolvedAt supplied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));

    const { client, from, update, eq, select } = makeUpdateEqMaybeSingleMock({
      data: {
        category: "nutrient_deficiency",
        grow_id: "grow-1",
        id: "finding-1",
        plant_id: "plant-3",
        resolved_at: "2026-05-14T12:00:00.000Z",
        severity: "medium",
        title: "Nitrogen deficiency",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "mark_finding_resolved",
      { findingId: "finding-1", resolved: true },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      data: expect.objectContaining({
        id: "finding-1",
        resolved_at: "2026-05-14T12:00:00.000Z",
      }),
      ok: true,
    });
    expect(from).toHaveBeenCalledWith("plant_findings");
    expect(update).toHaveBeenCalledWith({
      resolved_at: "2026-05-14T12:00:00.000Z",
    });
    expect(eq).toHaveBeenCalledWith("id", "finding-1");
    expect(select).toHaveBeenCalled();

    const audit = logServerEvent.mock.calls.at(-1)?.[2];
    expect(audit).toMatchObject({
      ok: true,
      rowId: "finding-1",
      tool: "mark_finding_resolved",
      write: true,
    });
  });

  it("clears resolved_at when resolved=false (re-open)", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "finding-1", resolved_at: null },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "mark_finding_resolved",
      { findingId: "finding-1", resolved: false },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({ resolved_at: null });
  });

  it("ignores resolvedAt when resolved=false", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "finding-1", resolved_at: null },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "mark_finding_resolved",
      {
        findingId: "finding-1",
        resolved: false,
        resolvedAt: "2026-05-13T08:00:00.000Z",
      },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({ resolved_at: null });
  });

  it("rejects a future resolvedAt and does not call the database", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
    const future = new Date("2026-05-14T12:05:00.000Z").toISOString();

    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "mark_finding_resolved",
      { findingId: "finding-1", resolved: true, resolvedAt: future },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 'not found or not accessible' when zero rows match", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "mark_finding_resolved",
      { findingId: "missing", resolved: true },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error: "finding not found or not accessible",
      ok: false,
    });
  });

  it("translates an RLS denial into a permission error", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table plant_findings",
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "mark_finding_resolved",
      { findingId: "f", resolved: true },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error:
        "you do not have permission to update this finding (owner or collaborator only)",
      ok: false,
    });
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "mark_finding_resolved",
      { findingId: "f", resolved: true },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("chat-tools — update_grow_stage", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  it("is exposed in the tool list and requires growId + stage", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "update_grow_stage",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters?.required).toEqual(["growId", "stage"]);
  });

  it("updates grows.stage and returns the new row", async () => {
    const { client, from, update, eq } = makeUpdateEqMaybeSingleMock({
      data: { id: "grow-1", name: "Tent A", stage: "flower" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow_stage",
      { growId: "grow-1", stage: "flower" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      data: { id: "grow-1", name: "Tent A", stage: "flower" },
      ok: true,
    });
    expect(from).toHaveBeenCalledWith("grows");
    expect(update).toHaveBeenCalledWith({ stage: "flower" });
    expect(eq).toHaveBeenCalledWith("id", "grow-1");
  });

  it("rejects an invalid stage without touching the database", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow_stage",
      { growId: "grow-1", stage: "blooming" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 'not found or not accessible' when zero rows match", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow_stage",
      { growId: "missing", stage: "flower" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error: "grow not found or not accessible",
      ok: false,
    });
  });

  it("translates an RLS denial into an owner-only permission error", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: {
        code: "42501",
        message: "row-level security blocks update",
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow_stage",
      { growId: "g", stage: "flower" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error:
        "you do not have permission to change this grow's stage (owners only)",
      ok: false,
    });
  });
});

describe("chat-tools — list_open_tasks", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  it("is exposed in the tool list with no required args (growId or plantId at runtime)", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "list_open_tasks",
    );
    expect(def).toBeDefined();
    // OpenAI schema doesn't list either as required, because EITHER is allowed
    // (zod refine validates at runtime).
    expect(def?.function.parameters?.required).toBeUndefined();
  });

  it("filters by grow + open|in_progress when includeCompleted is false (default)", async () => {
    const tasks = [
      {
        created_at: "2026-05-14T00:00:00.000Z",
        finding_id: "f-1",
        grow_id: "grow-1",
        id: "t-1",
        plant_id: "p-3",
        priority: "urgent",
        status: "open",
        title: "Address: nitrogen deficiency",
      },
    ];
    const { calls, client, from } = makeSelectChainMock({
      data: tasks,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "list_open_tasks",
      { growId: "grow-1" },
      CTX_AUTHED,
    );

    expect(result).toEqual({ data: tasks, ok: true });
    expect(from).toHaveBeenCalledWith("grow_tasks");
    expect(calls.eq).toContainEqual(["grow_id", "grow-1"]);
    expect(calls.in).toContainEqual(["status", ["open", "in_progress"]]);
  });

  it("filters by plant when plantId is supplied", async () => {
    const { calls, client } = makeSelectChainMock({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "list_open_tasks",
      { plantId: "plant-3" },
      CTX_AUTHED,
    );

    expect(calls.eq).toContainEqual(["plant_id", "plant-3"]);
  });

  it("includes completed tasks when includeCompleted=true", async () => {
    const { calls, client } = makeSelectChainMock({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "list_open_tasks",
      { growId: "grow-1", includeCompleted: true },
      CTX_AUTHED,
    );

    // No status filter when includeCompleted is true.
    expect(calls.in).toEqual([]);
  });

  it("rejects when neither growId nor plantId is supplied", async () => {
    const { calls, client } = makeSelectChainMock({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool("list_open_tasks", {}, CTX_AUTHED);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/growId|plantId/);
    }
    expect(calls.eq).toEqual([]);
  });
});

describe("chat-tools — update_task_status", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });

  it("is exposed in the tool list and requires taskId + status", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "update_task_status",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters?.required).toEqual(["taskId", "status"]);
  });

  it("flips status and returns the updated row", async () => {
    const { client, from, update, eq } = makeUpdateEqMaybeSingleMock({
      data: {
        completed_at: "2026-05-14T12:00:00.000Z",
        grow_id: "grow-1",
        id: "t-1",
        priority: "urgent",
        status: "done",
        title: "Address: nitrogen deficiency",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_task_status",
      { status: "done", taskId: "t-1" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      data: expect.objectContaining({ id: "t-1", status: "done" }),
      ok: true,
    });
    expect(from).toHaveBeenCalledWith("grow_tasks");
    expect(update).toHaveBeenCalledWith({ status: "done" });
    expect(eq).toHaveBeenCalledWith("id", "t-1");

    const audit = logServerEvent.mock.calls.at(-1)?.[2];
    expect(audit).toMatchObject({
      ok: true,
      rowId: "t-1",
      tool: "update_task_status",
      write: true,
    });
  });

  it("rejects an invalid status without touching the database", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_task_status",
      { status: "blocked", taskId: "t-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 'not found or not accessible' when zero rows match", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_task_status",
      { status: "done", taskId: "missing" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error: "task not found or not accessible",
      ok: false,
    });
  });

  it("translates an RLS denial into a contributor-only permission error", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: {
        code: "42501",
        message: "row-level security blocks update",
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_task_status",
      { status: "done", taskId: "t-1" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      error:
        "you do not have permission to update this task (owner or collaborator only)",
      ok: false,
    });
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_task_status",
      { status: "done", taskId: "t-1" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("chat-tools — create_grow", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires name+stage+medium+lightType", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "create_grow",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({
      required: ["name", "stage", "medium", "lightType"],
    });
  });

  it("inserts a grow owned by the current user and returns the new row", async () => {
    const { client, insert } = makeInsertMock({
      data: {
        id: "g-1",
        name: "North Tent A",
        stage: "seedling",
        medium: "soil",
        light_type: "led",
        start_date: "2026-05-14",
        target_harvest_date: null,
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow",
      {
        name: "North Tent A",
        stage: "seedling",
        medium: "soil",
        lightType: "led",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "g-1", name: "North Tent A" }),
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "user-1",
        name: "North Tent A",
        stage: "seedling",
        medium: "soil",
        light_type: "led",
        target_harvest_date: null,
      }),
    );
  });

  it("defaults start_date to today and trims name + description", async () => {
    const { client, insert } = makeInsertMock({
      data: { id: "g-2" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "create_grow",
      {
        name: "  Greenhouse  ",
        stage: "vegetative",
        medium: "coco",
        lightType: "sun",
        description: "  outdoor program  ",
      },
      CTX_AUTHED,
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Greenhouse",
        description: "outdoor program",
        start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("rejects an invalid stage without touching the database", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow",
      {
        name: "X",
        stage: "bogus",
        medium: "soil",
        lightType: "led",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects targetHarvestDate before startDate", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow",
      {
        name: "X",
        stage: "seedling",
        medium: "soil",
        lightType: "led",
        startDate: "2026-06-01",
        targetHarvestDate: "2026-05-01",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a friendly duplicate-name message on 23505", async () => {
    const { client } = makeInsertMock({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow",
      {
        name: "Existing",
        stage: "seedling",
        medium: "soil",
        lightType: "led",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already exists/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow",
      {
        name: "X",
        stage: "seedling",
        medium: "soil",
        lightType: "led",
      },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("chat-tools — create_plants", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires growId + name", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "create_plants",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({
      required: ["growId", "name"],
    });
  });

  it("creates a single plant when count is omitted", async () => {
    const mock = makeBulkInsertMock({
      data: [{ id: "p-1", grow_id: "g-1", name: "Plant Alpha" }],
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant Alpha" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        count: 1,
        plants: [{ id: "p-1", grow_id: "g-1", name: "Plant Alpha" }],
      },
    });
    expect(mock.lastRows()).toEqual([
      expect.objectContaining({ grow_id: "g-1", name: "Plant Alpha" }),
    ]);
  });

  it("bulk-creates N plants with zero-padded numeric suffixes", async () => {
    const mock = makeBulkInsertMock({
      data: Array.from({ length: 5 }, (_, i) => ({ id: `p-${i + 1}` })),
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant", count: 5, strain: "NL" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    const rows = mock.lastRows() as Array<{
      name: string;
      strain: string | null;
      grow_id: string;
    }>;
    expect(rows.map((r) => r.name)).toEqual([
      "Plant 1",
      "Plant 2",
      "Plant 3",
      "Plant 4",
      "Plant 5",
    ]);
    expect(rows.every((r) => r.strain === "NL")).toBe(true);
  });

  it("zero-pads to two digits when count >= 10", async () => {
    const mock = makeBulkInsertMock({
      data: Array.from({ length: 10 }, (_, i) => ({ id: `p-${i + 1}` })),
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "NL", count: 10 },
      CTX_AUTHED,
    );

    const rows = mock.lastRows() as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual([
      "NL 01",
      "NL 02",
      "NL 03",
      "NL 04",
      "NL 05",
      "NL 06",
      "NL 07",
      "NL 08",
      "NL 09",
      "NL 10",
    ]);
  });

  it("rejects count above 25 without touching the database", async () => {
    const mock = makeBulkInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant", count: 100 },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("translates an RLS denial into a grow-access error", async () => {
    const mock = makeBulkInsertMock({
      data: null,
      error: { code: "42501", message: "row-level security" },
    });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: false,
      error: "you do not have access to this grow",
    });
  });

  it("returns a bulk-tailored 23505 message when count > 1", async () => {
    const mock = makeBulkInsertMock({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant", count: 3 },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/generated plant names already exists/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const mock = makeBulkInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(mock.client);

    const result = await executeChatTool(
      "create_plants",
      { growId: "g-1", name: "Plant" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(mock.insert).not.toHaveBeenCalled();
  });
});

describe("chat-tools — create_grow_task", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires growId + title", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "create_grow_task",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({
      required: ["growId", "title"],
    });
  });

  it("inserts a task with default priority=medium and status=open", async () => {
    const { client, insert } = makeInsertMock({
      data: {
        id: "t-1",
        grow_id: "g-1",
        plant_id: null,
        title: "Flush plants Friday",
        priority: "medium",
        status: "open",
        due_at: null,
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow_task",
      { growId: "g-1", title: "Flush plants Friday" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "t-1", status: "open" }),
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "medium",
        status: "open",
        plant_id: null,
      }),
    );
  });

  it("rejects a past dueAt without touching the database", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow_task",
      {
        growId: "g-1",
        title: "Old",
        dueAt: "2000-01-01T00:00:00Z",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("translates an RLS denial into a contributor-only message", async () => {
    const { client } = makeInsertMock({
      data: null,
      error: { code: "42501", message: "row-level security" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow_task",
      { growId: "g-1", title: "X" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner or collaborator only/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "create_grow_task",
      { growId: "g-1", title: "X" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("chat-tools — update_grow", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires only growId", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "update_grow",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["growId"] });
  });

  it("rejects when no mutable field is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      { growId: "g-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("patches only the supplied fields and trims name/description", async () => {
    const { client, update, eq } = makeUpdateEqMaybeSingleMock({
      data: {
        id: "g-1",
        name: "Renamed",
        description: "fresh",
        stage: "vegetative",
        medium: "coco",
        light_type: "led",
        is_archived: false,
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      {
        growId: "g-1",
        name: "  Renamed  ",
        description: "  fresh  ",
        medium: "coco",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({
      name: "Renamed",
      description: "fresh",
      medium: "coco",
    });
    expect(eq).toHaveBeenCalledWith("id", "g-1");
  });

  it("clears description and targetHarvestDate when empty string is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "g-1" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "update_grow",
      { growId: "g-1", description: "", targetHarvestDate: "" },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({
      description: null,
      target_harvest_date: null,
    });
  });

  it("toggles is_archived when archived flag is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "g-1", is_archived: true },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "update_grow",
      { growId: "g-1", archived: true },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({ is_archived: true });
  });

  it("returns 'not found or not accessible' when zero rows match", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      { growId: "missing", name: "X" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not found or not accessible/i);
  });

  it("translates an RLS denial into an owner-only permission error", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: { code: "42501", message: "row-level security" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      { growId: "g-1", name: "X" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner only/i);
  });

  it("surfaces a friendly duplicate-name message on 23505", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      { growId: "g-1", name: "Existing" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already exists/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_grow",
      { growId: "g-1", name: "X" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("chat-tools — update_plant", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires only plantId", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "update_plant",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["plantId"] });
  });

  it("rejects when no mutable field is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_plant",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("patches only the supplied fields and trims values", async () => {
    const { client, update, eq } = makeUpdateEqMaybeSingleMock({
      data: { id: "p-1", name: "Mother", strain: "NL", batch_label: null },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "update_plant",
      {
        plantId: "p-1",
        name: "  Mother  ",
        strain: "  NL  ",
      },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({ name: "Mother", strain: "NL" });
    expect(eq).toHaveBeenCalledWith("id", "p-1");
  });

  it("clears optional text fields when empty string is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "p-1" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "update_plant",
      { plantId: "p-1", strain: "", batchLabel: "", notes: "" },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({
      strain: null,
      batch_label: null,
      notes: null,
    });
  });

  it("toggles is_archived when archived flag is supplied", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: { id: "p-1", is_archived: true },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "update_plant",
      { plantId: "p-1", archived: true },
      CTX_AUTHED,
    );

    expect(update).toHaveBeenCalledWith({ is_archived: true });
  });

  it("returns 'not found or not accessible' when zero rows match", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_plant",
      { plantId: "missing", name: "X" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not found or not accessible/i);
  });

  it("translates an RLS denial into an owner-only permission error", async () => {
    const { client } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: { code: "42501", message: "row-level security" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_plant",
      { plantId: "p-1", name: "X" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner only/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, update } = makeUpdateEqMaybeSingleMock({
      data: null,
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "update_plant",
      { plantId: "p-1", name: "X" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("chat-tools — record_image_finding", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
    persistSingleFindingEmbeddingBestEffort.mockReset();
    persistSingleFindingEmbeddingBestEffort.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires plant+grow+category+severity+title", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "record_image_finding",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({
      required: ["plantId", "growId", "category", "severity", "title"],
    });
  });

  it("inserts a row tagged source='user_reported' and returns the new id", async () => {
    const { client, from, insert } = makeInsertMock({
      data: {
        id: "f-1",
        plant_id: "p-1",
        grow_id: "g-1",
        category: "disease",
        severity: "high",
        title: "Suspected septoria",
        source: "user_reported",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "disease",
        severity: "high",
        title: "Suspected septoria",
        description: "Brown spots on the middle fans",
        recommendation: "Defoliate affected leaves and apply copper",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "f-1", source: "user_reported" }),
    });
    expect(from).toHaveBeenCalledWith("plant_findings");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        plant_id: "p-1",
        grow_id: "g-1",
        category: "disease",
        severity: "high",
        title: "Suspected septoria",
        description: "Brown spots on the middle fans",
        recommendation: "Defoliate affected leaves and apply copper",
        source: "user_reported",
      }),
    );
    expect(persistSingleFindingEmbeddingBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "f-1",
        category: "disease",
        title: "Suspected septoria",
      }),
      { requestId: "req-123", userId: "user-1" },
    );
  });

  it("returns the finding even when semantic embedding persistence fails", async () => {
    persistSingleFindingEmbeddingBestEffort.mockResolvedValue(undefined);
    const { client } = makeInsertMock({
      data: {
        id: "f-3",
        category: "general",
        description: "",
        recommendation: null,
        severity: "info",
        source: "user_reported",
        title: "Observation",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "general",
        severity: "info",
        title: "Observation",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "f-3" }),
    });
    expect(persistSingleFindingEmbeddingBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f-3" }),
      { requestId: "req-123", userId: "user-1" },
    );
  });

  it("trims title and falls back to empty description / null recommendation when omitted", async () => {
    const { client, insert } = makeInsertMock({
      data: { id: "f-2", source: "user_reported" },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "general",
        severity: "info",
        title: "  All good  ",
      },
      CTX_AUTHED,
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "All good",
        description: "",
        recommendation: null,
        image_id: null,
      }),
    );
  });

  it("rejects an invalid category without touching the database", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "bogus",
        severity: "high",
        title: "X",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid severity without touching the database", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "disease",
        severity: "fatal",
        title: "X",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("translates an RLS denial into a contributor-only permission error", async () => {
    const { client } = makeInsertMock({
      data: null,
      error: { code: "42501", message: "row-level security" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "disease",
        severity: "high",
        title: "X",
      },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/owner or collaborator only/i);
  });

  it("rejects when the user is not authenticated", async () => {
    const { client, insert } = makeInsertMock({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "record_image_finding",
      {
        plantId: "p-1",
        growId: "g-1",
        category: "disease",
        severity: "high",
        title: "X",
      },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("chat-tools — search_similar_findings", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    executeSearchSimilarFindingsTool.mockReset();
    logServerEvent.mockReset();
  });

  it("returns semantic matches for the active grow", async () => {
    const client = { rpc: vi.fn() };
    createSupabaseServerClient.mockResolvedValue(client);
    executeSearchSimilarFindingsTool.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "finding-1",
          plantId: "plant-1",
          plantName: "Blue Dream #1",
          category: "nutrient_deficiency",
          severity: "medium",
          title: "Lower fan yellowing",
          description: "Yellowing lower leaves",
          recommendation: null,
          source: "ai",
          createdAt: "2026-05-01T00:00:00Z",
          similarity: 0.86,
        },
      ],
    });

    const result = await executeChatTool(
      "search_similar_findings",
      {
        growId: "grow-1",
        query: "yellowing lower leaves",
        limit: 3,
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: "finding-1", similarity: 0.86 })],
    });
    expect(executeSearchSimilarFindingsTool).toHaveBeenCalledWith(
      {
        growId: "grow-1",
        query: "yellowing lower leaves",
        limit: 3,
      },
      {
        supabase: client,
        requestId: "req-123",
        userId: "user-1",
      },
    );
  });

  it("returns friendly copy when semantic search is unavailable", async () => {
    createSupabaseServerClient.mockResolvedValue({ rpc: vi.fn() });
    executeSearchSimilarFindingsTool.mockResolvedValue({
      ok: false,
      error:
        "semantic finding search is temporarily unavailable; use recent findings or timeline context instead",
    });

    const result = await executeChatTool(
      "search_similar_findings",
      {
        growId: "grow-1",
        query: "yellowing lower leaves",
      },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: false,
      error:
        "semantic finding search is temporarily unavailable; use recent findings or timeline context instead",
    });
  });
});

describe("chat-tools — get_plant_timeline", () => {
  beforeEach(() => {
    getPlantTimeline.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires plantId only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "get_plant_timeline",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["plantId"] });
  });

  it("returns the timeline items capped at the requested limit", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      type: "image",
      id: `img-${i}`,
      createdAt: "2026-05-01T00:00:00Z",
    }));
    getPlantTimeline.mockResolvedValue({ plantId: "p-1", items });

    const result = await executeChatTool(
      "get_plant_timeline",
      { plantId: "p-1", limit: 5 },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        plantId: "p-1",
        totalCount: 30,
        returnedCount: 5,
      }),
    });
    if (result.ok) {
      expect((result.data as { items: unknown[] }).items).toHaveLength(5);
    }
  });

  it("defaults to a limit of 20 when omitted", async () => {
    getPlantTimeline.mockResolvedValue({
      plantId: "p-1",
      items: Array.from({ length: 25 }, (_, i) => ({
        type: "observation",
        id: `obs-${i}`,
        observedAt: "2026-05-01T00:00:00Z",
      })),
    });

    const result = await executeChatTool(
      "get_plant_timeline",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { returnedCount: number };
      expect(data.returnedCount).toBe(20);
    }
  });

  it("caps the limit at 50 even when a higher value is requested", async () => {
    getPlantTimeline.mockResolvedValue({
      plantId: "p-1",
      items: Array.from({ length: 200 }, (_, i) => ({ id: `x-${i}` })),
    });

    const result = await executeChatTool(
      "get_plant_timeline",
      { plantId: "p-1", limit: 9999 },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { returnedCount: number };
      expect(data.returnedCount).toBe(50);
    }
  });

  it("returns 'not found or not accessible' when getPlantTimeline returns null", async () => {
    getPlantTimeline.mockResolvedValue(null);

    const result = await executeChatTool(
      "get_plant_timeline",
      { plantId: "missing" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not found or not accessible/i);
  });
});

describe("chat-tools — trigger_plant_analysis", () => {
  beforeEach(() => {
    runAndPersistPlantAnalysis.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires plantId only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "trigger_plant_analysis",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["plantId"] });
  });

  it("forwards plantId + requestId and returns a trimmed analysis summary", async () => {
    runAndPersistPlantAnalysis.mockResolvedValue({
      context: { plantId: "p-1" },
      analysisId: "a-1",
      imageId: "img-9",
      analysis: {
        imageId: "img-9",
        comparedToImageId: "img-7",
        overallHealthScore: 0.82,
        summary: "Healthy vegetative growth",
        comparisonSummary: "More vigor than 5 days ago",
        analysisMode: "vision",
        isFallback: false,
        findings: [{ category: "general", severity: "info" }],
        analyzedAt: "2026-05-14T12:00:00Z",
      },
    });

    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        analysisId: "a-1",
        imageId: "img-9",
        comparedToImageId: "img-7",
        overallHealthScore: 0.82,
        summary: "Healthy vegetative growth",
        findingsCount: 1,
      }),
    });
    expect(runAndPersistPlantAnalysis).toHaveBeenCalledWith({
      plantId: "p-1",
      requestId: "req-123",
    });
  });

  it("forwards a specific imageId when supplied", async () => {
    runAndPersistPlantAnalysis.mockResolvedValue({
      context: { plantId: "p-1" },
      analysisId: "a-2",
      imageId: "img-historic",
      analysis: {
        imageId: "img-historic",
        overallHealthScore: 0.5,
        summary: "x",
        analyzedAt: "2026-05-01T00:00:00Z",
      },
    });

    await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1", imageId: "img-historic" },
      CTX_AUTHED,
    );

    expect(runAndPersistPlantAnalysis).toHaveBeenCalledWith({
      plantId: "p-1",
      imageId: "img-historic",
      requestId: "req-123",
    });
  });

  it("returns 'not found' when the helper returns null (RLS / unknown plant)", async () => {
    runAndPersistPlantAnalysis.mockResolvedValue(null);

    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "missing" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not found or not accessible/i);
  });

  it("returns a guidance message when the plant has no images yet", async () => {
    runAndPersistPlantAnalysis.mockResolvedValue({
      context: { plantId: "p-1" },
      analysis: null,
    });

    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/upload a photo first/i);
  });

  it("converts an analysis-pipeline throw into a graceful error", async () => {
    runAndPersistPlantAnalysis.mockRejectedValue(new Error("vision API down"));

    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/analysis pipeline failed/i);
    expect(logServerEvent).toHaveBeenCalled();
  });

  it("rejects when the user is not authenticated", async () => {
    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1" },
      { requestId: "req-x", userId: null },
    );

    expect(result).toEqual({ error: "not authenticated", ok: false });
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });
});

describe("chat-tools — find_grow", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires only query", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "find_grow",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["query"] });
  });

  it("calls search_grows RPC with trigram ranking and default args", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "g-1", name: "North Tent A", match_score: 0.62 }],
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    const result = await executeChatTool(
      "find_grow",
      { query: "north" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("search_grows", {
      q: "north",
      include_archived: false,
      max_results: 5,
    });
  });

  it("forwards includeArchived=true to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    await executeChatTool(
      "find_grow",
      { query: "spring", includeArchived: true },
      CTX_AUTHED,
    );

    expect(rpc).toHaveBeenCalledWith("search_grows", {
      q: "spring",
      include_archived: true,
      max_results: 5,
    });
  });

  it("caps max_results at 15 even when a higher value is requested", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    await executeChatTool("find_grow", { query: "x", limit: 9999 }, CTX_AUTHED);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ max_results: 15 });
  });

  it("falls back to ILIKE when the RPC fails (e.g. migration not applied)", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function search_grows does not exist" },
    });
    const { client, calls, from } = makeSelectChainMock({
      data: [{ id: "g-1", name: "North Tent A" }],
      error: null,
    });
    // Splice the rpc mock onto the chain client.
    (client as unknown as { rpc: typeof rpc }).rpc = rpc;
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "find_grow",
      { query: "north" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("grows");
    expect(calls.or[0]?.[0]).toBe(
      "name.ilike.%north%,description.ilike.%north%",
    );
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("search_grows rpc failed"),
      expect.any(Object),
    );
  });

  it("rejects an empty query without touching the database", async () => {
    const rpc = vi.fn();
    const { client, from } = makeSelectChainMock({ data: [], error: null });
    (client as unknown as { rpc: typeof rpc }).rpc = rpc;
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "find_grow",
      { query: "" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("chat-tools — find_plant", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires only query", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "find_plant",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["query"] });
  });

  it("calls search_plants RPC with trigram ranking and null grow scope by default", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "p-1", name: "Mother", match_score: 0.81 }],
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    const result = await executeChatTool(
      "find_plant",
      { query: "mother" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("search_plants", {
      q: "mother",
      scope_grow_id: null,
      include_archived: false,
      max_results: 5,
    });
  });

  it("scopes to a grow when growId is supplied", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    await executeChatTool(
      "find_plant",
      { query: "NL", growId: "g-1" },
      CTX_AUTHED,
    );

    expect(rpc).toHaveBeenCalledWith("search_plants", {
      q: "NL",
      scope_grow_id: "g-1",
      include_archived: false,
      max_results: 5,
    });
  });

  it("caps max_results at 15 even when a higher value is requested", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    await executeChatTool("find_plant", { query: "x", limit: 100 }, CTX_AUTHED);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ max_results: 15 });
  });

  it("includes archived when includeArchived=true", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue({ rpc, from: vi.fn() });

    await executeChatTool(
      "find_plant",
      { query: "old", includeArchived: true },
      CTX_AUTHED,
    );

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ include_archived: true });
  });

  it("falls back to ILIKE when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function search_plants does not exist" },
    });
    const { client, calls, from } = makeSelectChainMock({
      data: [{ id: "p-1", name: "Mother" }],
      error: null,
    });
    (client as unknown as { rpc: typeof rpc }).rpc = rpc;
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "find_plant",
      { query: "mother" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("plants");
    expect(calls.or[0]?.[0]).toBe(
      "name.ilike.%mother%,strain.ilike.%mother%,batch_label.ilike.%mother%",
    );
  });

  it("rejects an empty query without touching the database", async () => {
    const rpc = vi.fn();
    const { client, from } = makeSelectChainMock({ data: [], error: null });
    (client as unknown as { rpc: typeof rpc }).rpc = rpc;
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "find_plant",
      { query: "" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("chat-tools — compare_plants", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires plantIds only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "compare_plants",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["plantIds"] });
  });

  it("rejects fewer than 2 plantIds", async () => {
    const { client, from } = makeTableRouterMock({});
    createSupabaseServerClient.mockResolvedValue(client);
    const result = await executeChatTool(
      "compare_plants",
      { plantIds: ["p-1"] },
      CTX_AUTHED,
    );
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects more than 4 plantIds", async () => {
    const { client, from } = makeTableRouterMock({});
    createSupabaseServerClient.mockResolvedValue(client);
    const result = await executeChatTool(
      "compare_plants",
      { plantIds: ["p-1", "p-2", "p-3", "p-4", "p-5"] },
      CTX_AUTHED,
    );
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns per-plant summary with counts from each table", async () => {
    const { client } = makeTableRouterMock({
      plants: {
        data: { id: "p-1", name: "Mother", strain: "NL" },
        error: null,
      },
      plant_analyses: {
        data: { id: "a-1", overall_health_score: 0.9, summary: "ok" },
        error: null,
      },
      grow_events: { data: [], error: null, count: 7 },
      plant_observations: { data: [], error: null, count: 3 },
      plant_findings: { data: [], error: null, count: 1 },
      grow_tasks: { data: [], error: null, count: 2 },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "compare_plants",
      { plantIds: ["p-1", "p-2"] },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        plants: Array<{ counts: Record<string, number> }>;
      };
      expect(data.plants).toHaveLength(2);
      expect(data.plants[0]?.counts).toEqual({
        events: 7,
        observations: 3,
        unresolvedFindings: 1,
        openTasks: 2,
      });
    }
  });

  it("clamps sinceDays to a max of 90", async () => {
    const { client } = makeTableRouterMock({
      plants: { data: null, error: null },
      plant_analyses: { data: null, error: null },
      grow_events: { data: [], error: null, count: 0 },
      plant_observations: { data: [], error: null, count: 0 },
      plant_findings: { data: [], error: null, count: 0 },
      grow_tasks: { data: [], error: null, count: 0 },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "compare_plants",
      { plantIds: ["p-1", "p-2"], sinceDays: 9999 },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { sinceDays: number };
      expect(data.sinceDays).toBe(90);
    }
  });

  it("degrades gracefully when one of the per-plant reads fails", async () => {
    const { client } = makeTableRouterMock({
      plants: { data: null, error: { message: "rls" } },
      plant_analyses: { data: null, error: null },
      grow_events: { data: [], error: null, count: 0 },
      plant_observations: { data: [], error: null, count: 0 },
      plant_findings: { data: [], error: null, count: 0 },
      grow_tasks: { data: [], error: null, count: 0 },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "compare_plants",
      { plantIds: ["p-1", "p-2"] },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { plants: Array<{ plant: unknown }> };
      expect(data.plants[0]?.plant).toBeNull();
    }
  });
});

describe("chat-tools — get_grow_summary", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    logServerEvent.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed in the tool list and requires growId only", () => {
    const def = CHAT_TOOL_DEFINITIONS.find(
      (t) => t.function.name === "get_grow_summary",
    );
    expect(def).toBeDefined();
    expect(def?.function.parameters).toMatchObject({ required: ["growId"] });
  });

  it("returns 'not found' when the grow lookup is null", async () => {
    const { client } = makeTableRouterMock({
      grows: { data: null, error: null },
      plants: { data: [], error: null },
      plant_findings: { data: [], error: null },
      grow_tasks: { data: [], error: null },
      grow_events: { data: null, error: null },
      plant_observations: { data: null, error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "get_grow_summary",
      { growId: "missing" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/not found or not accessible/i);
  });

  it("aggregates plant count, finding severities, and task priorities", async () => {
    const startDate = new Date(Date.now() - 21 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { client } = makeTableRouterMock({
      grows: {
        data: {
          id: "g-1",
          name: "North Tent",
          stage: "vegetative",
          medium: "soil",
          light_type: "led",
          start_date: startDate,
        },
        error: null,
      },
      plants: {
        data: [
          { id: "p-1", name: "P1" },
          { id: "p-2", name: "P2" },
          { id: "p-3", name: "P3" },
        ],
        error: null,
      },
      plant_findings: {
        data: [
          { id: "f-1", severity: "high", resolved_at: null },
          { id: "f-2", severity: "high", resolved_at: null },
          { id: "f-3", severity: "low", resolved_at: null },
        ],
        error: null,
      },
      grow_tasks: {
        data: [
          { id: "t-1", priority: "urgent", status: "open" },
          { id: "t-2", priority: "medium", status: "in_progress" },
        ],
        error: null,
      },
      grow_events: {
        data: {
          id: "e-9",
          event_type: "feed",
          occurred_at: "2026-05-12T00:00:00Z",
        },
        error: null,
      },
      plant_observations: {
        data: { id: "o-9", observed_at: "2026-05-13T00:00:00Z" },
        error: null,
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "get_grow_summary",
      { growId: "g-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        plantCount: number;
        unresolvedFindingCount: number;
        findingsBySeverity: Record<string, number>;
        openTaskCount: number;
        tasksByPriority: Record<string, number>;
        daysSinceStart: number | null;
      };
      expect(data.plantCount).toBe(3);
      expect(data.unresolvedFindingCount).toBe(3);
      expect(data.findingsBySeverity).toEqual({ high: 2, low: 1 });
      expect(data.openTaskCount).toBe(2);
      expect(data.tasksByPriority).toEqual({ urgent: 1, medium: 1 });
      expect(data.daysSinceStart).toBeGreaterThanOrEqual(20);
      expect(data.daysSinceStart).toBeLessThanOrEqual(22);
    }
  });

  it("returns null daysSinceStart when start_date is missing", async () => {
    const { client } = makeTableRouterMock({
      grows: {
        data: { id: "g-1", name: "Anon", start_date: null },
        error: null,
      },
      plants: { data: [], error: null },
      plant_findings: { data: [], error: null },
      grow_tasks: { data: [], error: null },
      grow_events: { data: null, error: null },
      plant_observations: { data: null, error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const result = await executeChatTool(
      "get_grow_summary",
      { growId: "g-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { daysSinceStart: number | null };
      expect(data.daysSinceStart).toBeNull();
    }
  });
});

describe("chat-tools — per-tool rate limit", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
    runAndPersistPlantAnalysis.mockReset();
    rateLimit.mockReset();
    logServerEvent.mockReset();
    rateLimit.mockResolvedValue({
      ok: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a rate-limit error for trigger_plant_analysis when the budget is exceeded and never touches Gemini", async () => {
    const resetAt = Date.now() + 30_000;
    rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, resetAt });

    const result = await executeChatTool(
      "trigger_plant_analysis",
      { plantId: "p-1" },
      CTX_AUTHED,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/rate limit/i);
    }
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("chat-tool:trigger_plant_analysis:"),
      }),
    );
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("does not impose a per-tool budget on read tools like list_grows", async () => {
    const { client } = makeSelectChainMock({ data: [], error: null });
    createSupabaseServerClient.mockResolvedValue(client);

    await executeChatTool("list_grows", {}, CTX_AUTHED);

    // No per-tool policy → rateLimit not consulted for list_grows.
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
