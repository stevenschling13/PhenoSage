import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  logServerEvent: vi.fn(),
}));

vi.mock("../email", () => ({
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

vi.mock("../request-id", () => ({
  logServerEvent: mocks.logServerEvent,
}));

const { sendTransactionalEmail, logServerEvent } = mocks;

import {
  dispatchDailySummaryEmail,
  dispatchFindingAlertEmail,
} from "../email-dispatch";

function buildSupabase(
  opts: {
    email?: string | null;
    getUserError?: { message: string } | null;
    getUserThrows?: boolean;
    updateError?: { message: string; code?: string } | null;
  } = {},
) {
  const updateEq = vi
    .fn()
    .mockResolvedValue({ data: null, error: opts.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const getUserById = opts.getUserThrows
    ? vi.fn().mockRejectedValue(new Error("boom"))
    : vi.fn().mockResolvedValue({
        data:
          opts.email === undefined
            ? { user: { email: "u@example.com" } }
            : { user: opts.email ? { email: opts.email } : null },
        error: opts.getUserError ?? null,
      });
  return {
    supabase: {
      from: vi.fn(() => ({ update })),
      auth: { admin: { getUserById } },
    },
    update,
    updateEq,
    getUserById,
  };
}

const baseSnapshot = {
  userId: "u1",
  grows: [],
  newFindings: [],
  newImages: 0,
  newObservations: 0,
  newTasks: 0,
  resolvedFindings: 0,
};

const basePrefs = {
  timezone: "UTC",
  emailDailySummary: true,
  emailFindingAlerts: true,
  emailAlertSeverityFloor: "critical" as const,
};

beforeEach(() => {
  sendTransactionalEmail.mockReset();
  logServerEvent.mockReset();
});

describe("dispatchDailySummaryEmail", () => {
  it("returns opt_out and never reads email when emailDailySummary=false", async () => {
    const { supabase, getUserById } = buildSupabase();
    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: { ...basePrefs, emailDailySummary: false },
      snapshot: baseSnapshot,
      rendered: { title: "t", body: "b" },
      occurredOn: "2026-05-15",
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: false, reason: "opt_out" });
    expect(getUserById).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns no_email when the user has no email address", async () => {
    const { supabase } = buildSupabase({ email: null });
    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: basePrefs,
      snapshot: baseSnapshot,
      rendered: { title: "t", body: "b" },
      occurredOn: "2026-05-15",
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: false, reason: "no_email" });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns no_email when getUserById throws (logs warn, does not propagate)", async () => {
    const { supabase } = buildSupabase({ getUserThrows: true });
    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: basePrefs,
      snapshot: baseSnapshot,
      rendered: { title: "t", body: "b" },
      occurredOn: "2026-05-15",
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: false, reason: "no_email" });
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("getUserById"),
      expect.any(Object),
    );
  });

  it("dispatches with idempotency key + stamps email_sent_at on success", async () => {
    const { supabase, update, updateEq } = buildSupabase();
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "msg_1" });

    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "notif-1",
      preferences: basePrefs,
      snapshot: baseSnapshot,
      rendered: { title: "Today", body: "All good" },
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });

    expect(r).toEqual({ sent: true, providerId: "msg_1" });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "u@example.com",
        subject: "Today",
        idempotencyKey: "daily-summary:u1:2026-05-15",
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ email_sent_at: expect.any(String) }),
    );
    expect(updateEq).toHaveBeenCalledWith("id", "notif-1");
  });

  it("does NOT stamp email_sent_at when send fails (so a retry can re-emit)", async () => {
    const { supabase, update } = buildSupabase();
    sendTransactionalEmail.mockResolvedValue({
      ok: false,
      code: "transient",
      message: "down",
      retryable: true,
    });

    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: basePrefs,
      snapshot: baseSnapshot,
      rendered: { title: "t", body: "b" },
      occurredOn: "2026-05-15",
      appUrl: "https://x",
    });

    expect(r).toEqual({ sent: false, reason: "failed" });
    expect(update).not.toHaveBeenCalled();
  });

  it("maps code=disabled to reason=disabled (distinct from generic failure)", async () => {
    const { supabase } = buildSupabase();
    sendTransactionalEmail.mockResolvedValue({
      ok: false,
      code: "disabled",
      message: "no key",
      retryable: false,
    });

    const r = await dispatchDailySummaryEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: basePrefs,
      snapshot: baseSnapshot,
      rendered: { title: "t", body: "b" },
      occurredOn: "2026-05-15",
      appUrl: "https://x",
    });

    expect(r).toEqual({ sent: false, reason: "disabled" });
  });
});

describe("dispatchFindingAlertEmail", () => {
  const finding = {
    findingId: "find-1",
    plantId: "p1",
    growId: "g1",
    severity: "critical" as const,
    title: "Bud rot",
    body: "Action needed.",
  };

  it("returns opt_out when emailFindingAlerts=false", async () => {
    const { supabase, getUserById } = buildSupabase();
    const r = await dispatchFindingAlertEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: { ...basePrefs, emailFindingAlerts: false },
      finding,
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: false, reason: "opt_out" });
    expect(getUserById).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns below_floor when finding severity < user's floor", async () => {
    const { supabase, getUserById } = buildSupabase();
    const r = await dispatchFindingAlertEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: { ...basePrefs, emailAlertSeverityFloor: "critical" },
      finding: { ...finding, severity: "high" },
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: false, reason: "below_floor" });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("dispatches when severity meets the floor", async () => {
    const { supabase } = buildSupabase();
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "msg_xyz" });

    const r = await dispatchFindingAlertEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: { ...basePrefs, emailAlertSeverityFloor: "high" },
      finding: { ...finding, severity: "high" },
      appUrl: "https://phenosage.app",
    });

    expect(r).toEqual({ sent: true, providerId: "msg_xyz" });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "finding-alert:find-1",
        subject: "High: Bud rot",
      }),
    );
  });

  it("never throws when stamp fails — dispatch still reports sent", async () => {
    const { supabase } = buildSupabase({
      updateError: { message: "stamp failed", code: "23514" },
    });
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "msg_y" });

    const r = await dispatchFindingAlertEmail({
      supabase: supabase as never,
      userId: "u1",
      notificationId: "n1",
      preferences: basePrefs,
      finding,
      appUrl: "https://x",
    });
    expect(r).toEqual({ sent: true, providerId: "msg_y" });
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("stamp"),
      expect.objectContaining({ notificationId: "n1" }),
    );
  });
});
