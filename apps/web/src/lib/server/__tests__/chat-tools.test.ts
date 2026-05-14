import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

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
type SelectChainKey = "select" | "order" | "limit" | "eq" | "in";
type SelectChain = Record<SelectChainKey, ReturnType<typeof vi.fn>> &
  PromiseLike<ListResult>;

function makeSelectChainMock(result: ListResult) {
  const calls: Record<SelectChainKey, unknown[][]> = {
    eq: [],
    in: [],
    limit: [],
    order: [],
    select: [],
  };
  const chain = {} as SelectChain;
  const KEYS: SelectChainKey[] = ["select", "order", "limit", "eq", "in"];
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
