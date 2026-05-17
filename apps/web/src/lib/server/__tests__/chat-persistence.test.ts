import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth + db modules so we never reach a real Supabase client.
const createSupabaseServerClient = vi.fn();
vi.mock("../auth", () => ({
  createSupabaseServerClient,
}));

const getDbClient = vi.fn();
vi.mock("../db", () => ({
  getDbClient,
}));

const logServerEvent = vi.fn();
vi.mock("../request-id", () => ({
  logServerEvent,
}));

beforeEach(() => {
  getDbClient.mockReset();
  createSupabaseServerClient.mockReset();
  logServerEvent.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// appendMessage — idempotency
// ────────────────────────────────────────────────────────────────────────────

describe("appendMessage idempotency", () => {
  it("includes idempotency_key in the insert row when provided", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const single = vi.fn().mockResolvedValue({
      data: { id: "msg-1" },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);
      return { select };
    });
    getDbClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });

    const { appendMessage } = await import("../chat-persistence");
    const id = await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
      idempotencyKey: "test1234",
    });

    expect(id).toBe("msg-1");
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      thread_id: "thread-1",
      role: "user",
      content: "hello",
      idempotency_key: "test1234",
    });
  });

  it("omits idempotency_key when caller didn't supply one", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const single = vi.fn().mockResolvedValue({
      data: { id: "msg-1" },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);
      return { select };
    });
    getDbClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });

    const { appendMessage } = await import("../chat-persistence");
    await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
    });

    expect(insertedRows[0]).not.toHaveProperty("idempotency_key");
  });

  it("returns the existing row id when insert hits 23505 with an idempotencyKey", async () => {
    // First call: insert returns a 23505 unique_violation.
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));

    // Second call: the dedup lookup returns the original row.
    const lookupMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "msg-original" }, error: null });
    const lookupEqKey = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupEqThread = vi.fn(() => ({ eq: lookupEqKey }));
    const lookupSelect = vi.fn(() => ({ eq: lookupEqThread }));

    // The `.from("chat_messages")` is called twice: once for the insert,
    // once for the recovery lookup. Return objects in that order.
    const from = vi
      .fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({ select: lookupSelect });

    getDbClient.mockReturnValue({ from });

    const { appendMessage } = await import("../chat-persistence");
    const id = await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
      idempotencyKey: "test1234",
    });

    expect(id).toBe("msg-original");
    expect(lookupEqThread).toHaveBeenCalledWith("thread_id", "thread-1");
    expect(lookupEqKey).toHaveBeenCalledWith("idempotency_key", "test1234");
    // We log an info line on idempotent replay so ops can spot retry storms.
    // The key is included in the log line so a specific retry burst can be
    // correlated to a single client request.
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      "chat message idempotent replay",
      expect.objectContaining({
        threadId: "thread-1",
        role: "user",
        idempotencyKey: "test1234",
      }),
    );
  });

  it("does NOT recover on 23505 when caller didn't supply an idempotencyKey", async () => {
    // Without a key, a unique violation would mean something else has gone
    // wrong (no other unique constraint on chat_messages should be hit by
    // an ordinary insert). Surface the failure as null + error log instead
    // of silently masking it.
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    const from = vi.fn().mockReturnValue({ insert });
    getDbClient.mockReturnValue({ from });

    const { appendMessage } = await import("../chat-persistence");
    const id = await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
    });

    expect(id).toBeNull();
    // The recovery lookup must not run when no key was supplied.
    expect(from).toHaveBeenCalledTimes(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat message insert failed",
      expect.objectContaining({ threadId: "thread-1" }),
    );
  });

  it("falls through to error log when 23505 lookup itself fails", async () => {
    // Belt-and-braces: an idempotencyKey was provided, the insert hit
    // 23505, but the recovery SELECT also failed (e.g. transient db error).
    // The function must NOT pretend the write succeeded — return null and
    // log so the caller can surface the failure.
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));

    const lookupMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    const lookupEqKey = vi.fn(() => ({ maybeSingle: lookupMaybeSingle }));
    const lookupEqThread = vi.fn(() => ({ eq: lookupEqKey }));
    const lookupSelect = vi.fn(() => ({ eq: lookupEqThread }));

    const from = vi
      .fn()
      .mockReturnValueOnce({ insert })
      .mockReturnValueOnce({ select: lookupSelect });
    getDbClient.mockReturnValue({ from });

    const { appendMessage } = await import("../chat-persistence");
    const id = await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
      idempotencyKey: "test1234",
    });

    expect(id).toBeNull();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat message insert failed",
      expect.objectContaining({ threadId: "thread-1" }),
    );
  });

  it("returns null and logs error on generic (non-23505) insert failure", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    getDbClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    const { appendMessage } = await import("../chat-persistence");
    const id = await appendMessage({
      threadId: "thread-1",
      role: "user",
      content: "hello",
      idempotencyKey: "test1234",
    });

    expect(id).toBeNull();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat message insert failed",
      expect.objectContaining({ error: "relation does not exist" }),
    );
  });
});
