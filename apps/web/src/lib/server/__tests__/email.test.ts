import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sendMock = vi.fn();
  const constructorCalls: string[] = [];
  class FakeResend {
    emails = { send: sendMock };
    constructor(apiKey: string) {
      constructorCalls.push(apiKey);
    }
  }
  const logServerEvent = vi.fn();
  return { sendMock, FakeResend, constructorCalls, logServerEvent };
});

vi.mock("resend", () => ({
  Resend: mocks.FakeResend,
}));

vi.mock("../request-id", () => ({
  logServerEvent: mocks.logServerEvent,
}));

const { sendMock, constructorCalls, logServerEvent } = mocks;

const ORIGINAL_ENV = process.env;

async function loadFreshModule() {
  vi.resetModules();
  return await import("../email");
}

describe("sendTransactionalEmail", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["RESEND_API_KEY"];
    delete process.env["RESEND_FROM_EMAIL"];
    sendMock.mockReset();
    constructorCalls.length = 0;
    logServerEvent.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns disabled and never constructs the SDK when RESEND_API_KEY is missing", async () => {
    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@example.com",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      idempotencyKey: "k",
    });
    expect(r).toEqual({
      ok: false,
      code: "disabled",
      message: expect.any(String),
      retryable: false,
    });
    expect(constructorCalls.length).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("RESEND_API_KEY"),
      expect.objectContaining({ idempotencyKey: "k" }),
    );
  });

  it("returns disabled when RESEND_FROM_EMAIL is missing", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@example.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("disabled");
    expect(constructorCalls.length).toBe(0);
  });

  it("forwards idempotencyKey + tags + from address; returns provider id on success", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "PhenoSage <hi@phenosage.app>";
    sendMock.mockResolvedValueOnce({
      data: { id: "msg_123" },
      error: null,
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@example.com",
      subject: "Subject",
      html: "<p>HTML</p>",
      text: "TEXT",
      idempotencyKey: "daily-summary:user-1:2026-05-15",
      tags: [{ name: "kind", value: "daily_summary" }],
    });

    expect(r).toEqual({ ok: true, id: "msg_123" });
    expect(constructorCalls).toEqual(["re_test"]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload, options] = sendMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      from: "PhenoSage <hi@phenosage.app>",
      to: "u@example.com",
      subject: "Subject",
      html: "<p>HTML</p>",
      text: "TEXT",
      tags: [{ name: "kind", value: "daily_summary" }],
    });
    expect(options).toEqual({
      idempotencyKey: "daily-summary:user-1:2026-05-15",
    });
  });

  it("retries once on 429 and honours a clamped Retry-After", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: 429, message: "slow down", name: "rate_limit" },
        // 9999s would be insane to honour — module clamps to MAX_RETRY_AFTER_MS.
        headers: { "retry-after": "9999" },
      })
      .mockResolvedValueOnce({
        data: { id: "msg_after_retry" },
        error: null,
        headers: null,
      });

    vi.useFakeTimers();
    try {
      const { sendTransactionalEmail } = await loadFreshModule();
      const promise = sendTransactionalEmail({
        to: "u@x.com",
        subject: "s",
        html: "h",
        text: "h",
        idempotencyKey: "k",
      });
      // First send resolves immediately (microtask). Then we schedule
      // a retry sleep — clamp is 5_000ms. Advance just past it.
      await vi.advanceTimersByTimeAsync(5_001);
      const r = await promise;
      expect(r).toEqual({ ok: true, id: "msg_after_retry" });
      expect(sendMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries once on 5xx and gives up after retry budget", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockResolvedValue({
      data: null,
      error: { statusCode: 503, message: "down", name: "internal_error" },
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("transient");
      expect(r.retryable).toBe(true);
    }
    expect(sendMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("does NOT retry on 4xx validation failures", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockResolvedValue({
      data: null,
      error: {
        statusCode: 422,
        message: "invalid recipient",
        name: "validation_error",
      },
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "bad",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation");
      expect(r.retryable).toBe(false);
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 401/403 auth failures", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockResolvedValue({
      data: null,
      error: { statusCode: 401, message: "bad key", name: "unauthorized" },
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("auth");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a thrown network error and reports transient on a second throw", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockRejectedValue(new Error("ECONNRESET"));

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("transient");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("treats a 2xx with no id as unknown failure (no retry)", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockResolvedValue({
      data: { id: "" },
      error: null,
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    const r = await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unknown");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("memoises the Resend client between calls (only constructs once)", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["RESEND_FROM_EMAIL"] = "from@x.com";
    sendMock.mockResolvedValue({
      data: { id: "id1" },
      error: null,
      headers: null,
    });

    const { sendTransactionalEmail } = await loadFreshModule();
    await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k1",
    });
    await sendTransactionalEmail({
      to: "u@x.com",
      subject: "s",
      html: "h",
      text: "h",
      idempotencyKey: "k2",
    });

    expect(constructorCalls.length).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
