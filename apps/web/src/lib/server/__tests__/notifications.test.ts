import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth + db modules so we never reach a real Supabase client.
const createSupabaseServerClient = vi.fn();
const getServerUser = vi.fn();
vi.mock("../auth", () => ({
  createSupabaseServerClient,
  getServerUser,
}));

const getDbClient = vi.fn();
vi.mock("../db", () => ({
  getDbClient,
}));

const logServerEvent = vi.fn();
vi.mock("../request-id", () => ({
  logServerEvent,
}));

// New since Tier 2.2: emitFindingAlerts now reads user preferences and
// dispatches email-of-record after a successful insert. Default both
// to no-ops so the legacy assertions keep their narrow focus on the
// notifications-row writes; the dispatcher itself is covered by
// email-dispatch.test.ts.
const loadUserPreferences = vi.fn(async () => ({
  timezone: "UTC",
  emailDailySummary: true,
  emailFindingAlerts: false, // disabled by default → dispatch no-op
  emailAlertSeverityFloor: "critical" as const,
}));
vi.mock("../user-preferences", () => ({
  loadUserPreferences,
  // Re-export the constant the production module uses.
  DEFAULT_USER_PREFERENCES: {
    timezone: "UTC",
    emailDailySummary: true,
    emailFindingAlerts: true,
    emailAlertSeverityFloor: "critical",
  },
}));

const dispatchFindingAlertEmail = vi.fn<
  (..._args: unknown[]) => Promise<{
    sent: false;
    reason: "opt_out" | "below_floor" | "no_email" | "disabled" | "failed";
  }>
>(async () => ({
  sent: false as const,
  reason: "opt_out" as const,
}));
vi.mock("../email-dispatch", () => ({
  dispatchFindingAlertEmail,
}));

beforeEach(() => {
  createSupabaseServerClient.mockReset();
  getServerUser.mockReset();
  getDbClient.mockReset();
  logServerEvent.mockReset();
  loadUserPreferences.mockClear();
  dispatchFindingAlertEmail.mockClear();
});

// ────────────────────────────────────────────────────────────────────────────
// listNotifications / countUnreadNotifications
// ────────────────────────────────────────────────────────────────────────────

describe("listNotifications", () => {
  it("returns mapped records on success", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: "n1",
          kind: "daily_summary",
          priority: "info",
          title: "Yesterday in your grow",
          body: "All quiet.",
          payload: { newFindingCount: 0 },
          occurred_on: "2026-05-14",
          read_at: null,
          created_at: "2026-05-14T08:00:00Z",
        },
      ],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    createSupabaseServerClient.mockResolvedValue({
      from: vi.fn(() => ({ select })),
    });

    const { listNotifications } = await import("../notifications");
    const result = await listNotifications({ limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "n1",
      kind: "daily_summary",
      readAt: null,
      occurredOn: "2026-05-14",
    });
  });

  it("degrades to empty list and logs when supabase init fails", async () => {
    createSupabaseServerClient.mockRejectedValue(new Error("env missing"));
    const { listNotifications } = await import("../notifications");
    const result = await listNotifications();
    expect(result).toEqual([]);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("client init failed"),
      expect.any(Object),
    );
  });

  it("filters to unread when unreadOnly=true", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const is = vi.fn(() => ({ limit }));
    // unreadOnly=true → flow is select → order → is → limit.
    const order = vi.fn(() => ({ is, limit }));
    const select = vi.fn(() => ({ order }));
    createSupabaseServerClient.mockResolvedValue({
      from: vi.fn(() => ({ select })),
    });
    const { listNotifications } = await import("../notifications");
    await listNotifications({ unreadOnly: true });
    expect(is).toHaveBeenCalledWith("read_at", null);
    expect(limit).toHaveBeenCalled();
  });
});

describe("countUnreadNotifications", () => {
  it("returns the supabase count on success", async () => {
    const is = vi.fn().mockResolvedValue({ count: 7, error: null });
    const select = vi.fn(() => ({ is }));
    createSupabaseServerClient.mockResolvedValue({
      from: vi.fn(() => ({ select })),
    });
    const { countUnreadNotifications } = await import("../notifications");
    expect(await countUnreadNotifications()).toBe(7);
    expect(select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
    expect(is).toHaveBeenCalledWith("read_at", null);
  });

  it("returns 0 on supabase error", async () => {
    const is = vi.fn().mockResolvedValue({
      count: null,
      error: { message: "db down", code: "500" },
    });
    const select = vi.fn(() => ({ is }));
    createSupabaseServerClient.mockResolvedValue({
      from: vi.fn(() => ({ select })),
    });
    const { countUnreadNotifications } = await import("../notifications");
    expect(await countUnreadNotifications()).toBe(0);
  });

  it("returns 0 on init failure", async () => {
    createSupabaseServerClient.mockRejectedValue(new Error("nope"));
    const { countUnreadNotifications } = await import("../notifications");
    expect(await countUnreadNotifications()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// markNotificationRead — typed Result, never throws for business cases
// ────────────────────────────────────────────────────────────────────────────

describe("markNotificationRead", () => {
  function buildOkClient() {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "n1" }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const is = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ is }));
    const update = vi.fn(() => ({ eq }));
    return {
      client: { from: vi.fn(() => ({ update })) },
      mocks: { update, eq, is, select, maybeSingle },
    };
  }

  it("returns ok on successful update", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const { client, mocks } = buildOkClient();
    createSupabaseServerClient.mockResolvedValue(client);
    const { markNotificationRead } = await import("../notifications");
    const result = await markNotificationRead("n1");
    expect(result).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        read_at: expect.any(String),
      }),
    );
    expect(mocks.eq).toHaveBeenCalledWith("id", "n1");
    expect(mocks.is).toHaveBeenCalledWith("read_at", null);
  });

  it("returns unauthenticated when no user", async () => {
    getServerUser.mockResolvedValue(null);
    const { markNotificationRead } = await import("../notifications");
    const result = await markNotificationRead("n1");
    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      message: expect.any(String),
    });
  });

  it("rejects bogus notification ids without contacting supabase", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const { markNotificationRead } = await import("../notifications");
    const tooLong = "x".repeat(200);
    const result = await markNotificationRead(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps SQLSTATE 42501 to permission_denied", async () => {
    getServerUser.mockResolvedValue({ id: "user-1" });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "denied", code: "42501" },
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const is = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ is }));
    const update = vi.fn(() => ({ eq }));
    createSupabaseServerClient.mockResolvedValue({
      from: vi.fn(() => ({ update })),
    });
    const { markNotificationRead } = await import("../notifications");
    const result = await markNotificationRead("n1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("permission_denied");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// emitFindingAlerts — event-driven agent trigger
// ────────────────────────────────────────────────────────────────────────────

describe("emitFindingAlerts", () => {
  function buildDb({
    existingPayloads = [],
    insertReturn = { data: [], error: null },
    existingError = null,
  }: {
    existingPayloads?: Array<{ payload: { findingId: string } }>;
    insertReturn?: {
      data?: Array<{ id: string }> | null;
      error?: { message: string; code?: string } | null;
    };
    existingError?: { message: string; code?: string } | null;
  } = {}) {
    const inSelect = vi.fn().mockResolvedValue({
      data: existingPayloads,
      error: existingError,
    });
    const inFn = vi.fn(() => inSelect());
    const eqKind = vi.fn(() => ({ in: inFn }));
    const eqUser = vi.fn(() => ({ eq: eqKind }));
    const selectExisting = vi.fn(() => ({ eq: eqUser }));
    const selectInserted = vi.fn().mockResolvedValue({
      data: insertReturn.data ?? null,
      error: insertReturn.error ?? null,
    });
    const insert = vi.fn(() => ({ select: selectInserted }));
    return {
      from: vi.fn((_table: string) => ({
        select: selectExisting,
        insert,
      })),
    };
  }

  it("skips entirely when no high/critical severity findings", async () => {
    const db = buildDb();
    getDbClient.mockReturnValue(db);
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f1",
          plantId: "p1",
          growId: "g1",
          severity: "low",
          title: "Minor leaf curl",
          description: "Probably benign.",
        },
      ],
    });
    expect(inserted).toBe(0);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("inserts only alertable findings and dedupes existing", async () => {
    const db = buildDb({
      existingPayloads: [{ payload: { findingId: "f-existing" } }],
      insertReturn: { data: [{ id: "n-new" }], error: null },
    });
    getDbClient.mockReturnValue(db);
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f-existing",
          plantId: "p1",
          growId: "g1",
          severity: "high",
          title: "Already alerted",
          description: "Older signal.",
        },
        {
          findingId: "f-new",
          plantId: "p1",
          growId: "g1",
          severity: "critical",
          title: "Critical PM",
          description: "Powdery mildew detected.",
          recommendation: "Increase airflow.",
        },
        {
          findingId: "f-low",
          plantId: "p1",
          growId: "g1",
          severity: "low",
          title: "Minor",
          description: "Skipped.",
        },
      ],
    });
    expect(inserted).toBe(1);
  });

  it("treats 23505 (concurrent emit race) as a benign no-op", async () => {
    const db = buildDb({
      insertReturn: {
        data: null,
        error: { message: "duplicate", code: "23505" },
      },
    });
    getDbClient.mockReturnValue(db);
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f-race",
          plantId: "p1",
          growId: "g1",
          severity: "critical",
          title: "PM",
          description: "x",
        },
      ],
    });
    expect(inserted).toBe(0);
    // Logged at info level, not error.
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("dedupe race"),
      expect.any(Object),
    );
  });

  it("returns 0 (and logs error) on real insert failure", async () => {
    const db = buildDb({
      insertReturn: {
        data: null,
        error: { message: "boom", code: "23502" },
      },
    });
    getDbClient.mockReturnValue(db);
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f1",
          plantId: "p1",
          growId: "g1",
          severity: "high",
          title: "x",
          description: "y",
        },
      ],
    });
    expect(inserted).toBe(0);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("insert failed"),
      expect.any(Object),
    );
  });

  // ─── Email dispatch (Tier 2.2) ────────────────────────────────────

  it("dispatches a finding-alert email per newly-inserted row when prefs allow", async () => {
    const db = buildDb({
      existingPayloads: [],
      insertReturn: {
        data: [{ id: "notif-new" }],
        error: null,
      },
    });
    getDbClient.mockReturnValue(db);
    loadUserPreferences.mockResolvedValueOnce({
      timezone: "UTC",
      emailDailySummary: true,
      emailFindingAlerts: true,
      emailAlertSeverityFloor: "critical" as const,
    });
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f-crit",
          plantId: "p1",
          growId: "g1",
          severity: "critical",
          title: "Critical PM",
          description: "Powdery mildew detected.",
          recommendation: "Increase airflow.",
        },
      ],
    });
    expect(inserted).toBe(1);
    expect(loadUserPreferences).toHaveBeenCalledTimes(1);
    expect(dispatchFindingAlertEmail).toHaveBeenCalledTimes(1);
    const arg = dispatchFindingAlertEmail.mock.calls[0]?.[0] as
      | {
          userId: string;
          notificationId: string;
          finding: { findingId: string; severity: string; title: string };
        }
      | undefined;
    expect(arg).toMatchObject({
      userId: "user-1",
      notificationId: "notif-new",
      finding: expect.objectContaining({
        findingId: "f-crit",
        severity: "critical",
        title: "Critical PM",
      }),
    });
  });

  it("does NOT load prefs or dispatch when nothing was inserted", async () => {
    const db = buildDb({
      existingPayloads: [{ payload: { findingId: "f-existing" } }],
      insertReturn: { data: [], error: null },
    });
    getDbClient.mockReturnValue(db);
    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f-existing",
          plantId: "p1",
          growId: "g1",
          severity: "high",
          title: "Already alerted",
          description: "Older signal.",
        },
      ],
    });
    expect(inserted).toBe(0);
    expect(loadUserPreferences).not.toHaveBeenCalled();
    expect(dispatchFindingAlertEmail).not.toHaveBeenCalled();
  });

  it("a thrown email dispatch is caught and logged (does not affect insert count)", async () => {
    const db = buildDb({
      insertReturn: { data: [{ id: "notif-x" }], error: null },
    });
    getDbClient.mockReturnValue(db);
    loadUserPreferences.mockResolvedValueOnce({
      timezone: "UTC",
      emailDailySummary: true,
      emailFindingAlerts: true,
      emailAlertSeverityFloor: "critical" as const,
    });
    dispatchFindingAlertEmail.mockRejectedValueOnce(new Error("network blip"));

    const { emitFindingAlerts } = await import("../notifications");
    const inserted = await emitFindingAlerts({
      userId: "user-1",
      requestId: "req-1",
      findings: [
        {
          findingId: "f-crit",
          plantId: "p1",
          growId: "g1",
          severity: "critical",
          title: "Critical PM",
          description: "Detected.",
        },
      ],
    });
    expect(inserted).toBe(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("email dispatch threw"),
      expect.any(Object),
    );
  });
});
