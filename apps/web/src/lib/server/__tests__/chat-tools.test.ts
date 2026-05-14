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

function makeInsertMock(result: SingleResult) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from }, from, insert, select, single };
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
