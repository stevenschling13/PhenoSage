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

import { loadGrowContextSummary } from "../chat-context";

const GROW_ROW = {
  id: "grow-1",
  name: "North tent",
  stage: "veg",
  medium: "coco",
  light_type: "led",
  start_date: "2026-04-01",
};

type Eq = { value: unknown; column: string };

// Builds a fluent stub matching the Supabase query-builder surface the
// module touches. Each `.from(table)` returns a chain whose terminal
// behaviour comes from `responses[table]`.
function makeSupabase(responses: {
  grow: { data: unknown; error: { message: string } | null };
  plantCount: { count: number | null };
  findings: { data: unknown; error: { message: string } | null };
  tasks: { data: unknown; error: { message: string } | null };
}) {
  const calls: { table: string; selects: string[]; eqs: Eq[] }[] = [];

  function from(table: string) {
    const record = { table, selects: [] as string[], eqs: [] as Eq[] };
    calls.push(record);

    // grows.select(...).eq("id", growId).maybeSingle()
    if (table === "grows") {
      const maybeSingle = vi.fn().mockResolvedValue(responses.grow);
      const eq = vi.fn((column: string, value: unknown) => {
        record.eqs.push({ column, value });
        return { maybeSingle };
      });
      const select = vi.fn((cols: string) => {
        record.selects.push(cols);
        return { eq };
      });
      return { select };
    }

    // plants.select(..., { count: "exact", head: true }).eq().eq()
    if (table === "plants") {
      // Terminal `.eq(is_archived,false)` returns a thenable with `count`.
      const eqArchived = vi.fn((column: string, value: unknown) => {
        record.eqs.push({ column, value });
        return Promise.resolve({ count: responses.plantCount.count });
      });
      const eqGrowId = vi.fn((column: string, value: unknown) => {
        record.eqs.push({ column, value });
        return { eq: eqArchived };
      });
      const select = vi.fn((cols: string, opts?: unknown) => {
        record.selects.push(cols);
        void opts;
        return { eq: eqGrowId };
      });
      return { select };
    }

    // plant_findings.select(...).eq().gte().order().limit()
    if (table === "plant_findings") {
      const limit = vi.fn().mockResolvedValue(responses.findings);
      const order = vi.fn(() => ({ limit }));
      const gte = vi.fn(() => ({ order }));
      const eq = vi.fn((column: string, value: unknown) => {
        record.eqs.push({ column, value });
        return { gte };
      });
      const select = vi.fn((cols: string) => {
        record.selects.push(cols);
        return { eq };
      });
      return { select };
    }

    // grow_tasks.select(...).eq().in().order().order().limit()
    if (table === "grow_tasks") {
      const limit = vi.fn().mockResolvedValue(responses.tasks);
      const orderInner = vi.fn(() => ({ limit }));
      const orderOuter = vi.fn(() => ({ order: orderInner }));
      const inFn = vi.fn(() => ({ order: orderOuter }));
      const eq = vi.fn((column: string, value: unknown) => {
        record.eqs.push({ column, value });
        return { in: inFn };
      });
      const select = vi.fn((cols: string) => {
        record.selects.push(cols);
        return { eq };
      });
      return { select };
    }

    throw new Error(`Unexpected table: ${table}`);
  }

  return { client: { from: vi.fn(from) }, calls };
}

beforeEach(() => {
  createSupabaseServerClient.mockReset();
  logServerEvent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadGrowContextSummary", () => {
  it("returns null when growId is null without touching Supabase", async () => {
    const out = await loadGrowContextSummary(null);
    expect(out).toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns null and logs when the Supabase client fails to initialise", async () => {
    createSupabaseServerClient.mockRejectedValue(new Error("cookies-missing"));
    const out = await loadGrowContextSummary("grow-1");
    expect(out).toBeNull();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat context client init failed",
      expect.objectContaining({ error: "cookies-missing" }),
    );
  });

  it("returns null and logs when the grow lookup errors", async () => {
    const { client } = makeSupabase({
      grow: { data: null, error: { message: "rls denied" } },
      plantCount: { count: 0 },
      findings: { data: [], error: null },
      tasks: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const out = await loadGrowContextSummary("grow-1");
    expect(out).toBeNull();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat context grow lookup failed",
      expect.objectContaining({ error: "rls denied", growId: "grow-1" }),
    );
  });

  it("returns null without logging when the grow is simply not found", async () => {
    const { client } = makeSupabase({
      grow: { data: null, error: null },
      plantCount: { count: 0 },
      findings: { data: [], error: null },
      tasks: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const out = await loadGrowContextSummary("grow-missing");
    expect(out).toBeNull();
    expect(logServerEvent).not.toHaveBeenCalled();
  });

  it("maps a fully-populated grow with findings + tasks into camelCase summary", async () => {
    // Pin Date.now so daysSinceStart is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00Z"));

    const findings = [
      {
        title: "Yellowing lower leaves",
        category: "deficiency",
        severity: "medium",
        created_at: "2026-05-10T12:00:00Z",
        plants: { name: "Plant 01" },
      },
      // Verifies the array shape of the embedded `plants` relation: the
      // PostgREST client sometimes returns an array even for a foreign
      // single-row relation. The mapper must pick the first row.
      {
        title: "Spider mites",
        category: "pest",
        severity: "high",
        created_at: "2026-05-12T12:00:00Z",
        plants: [{ name: "Plant 02" }, { name: "Plant 02 (alt)" }],
      },
      // Verifies null `plants` (e.g. plant deleted, finding orphaned)
      // gracefully degrades to plantName=null.
      {
        title: "Stale issue",
        category: "other",
        severity: "low",
        created_at: "2026-05-01T12:00:00Z",
        plants: null,
      },
    ];

    const tasks = [
      {
        id: "task-1",
        title: "Flush coco",
        priority: "urgent",
        status: "open",
        created_at: "2026-05-15T12:00:00Z",
        plants: { name: "Plant 01" },
      },
      {
        id: "task-2",
        title: "Recheck pH",
        priority: "medium",
        status: "in_progress",
        created_at: "2026-05-14T12:00:00Z",
        plants: [{ name: "Plant 02" }],
      },
      {
        id: "task-3",
        title: "Restock cal-mag",
        priority: "low",
        status: "open",
        created_at: "2026-05-13T12:00:00Z",
        plants: null,
      },
    ];

    const { client, calls } = makeSupabase({
      grow: { data: GROW_ROW, error: null },
      plantCount: { count: 4 },
      findings: { data: findings, error: null },
      tasks: { data: tasks, error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const summary = await loadGrowContextSummary("grow-1");

    expect(summary).toEqual({
      growId: "grow-1",
      name: "North tent",
      stage: "veg",
      medium: "coco",
      lightType: "led",
      startDate: "2026-04-01",
      daysSinceStart: 47,
      plantCount: 4,
      recentFindings: [
        {
          title: "Yellowing lower leaves",
          category: "deficiency",
          severity: "medium",
          plantName: "Plant 01",
          createdAt: "2026-05-10T12:00:00Z",
        },
        {
          title: "Spider mites",
          category: "pest",
          severity: "high",
          plantName: "Plant 02",
          createdAt: "2026-05-12T12:00:00Z",
        },
        {
          title: "Stale issue",
          category: "other",
          severity: "low",
          plantName: null,
          createdAt: "2026-05-01T12:00:00Z",
        },
      ],
      openTasks: [
        {
          id: "task-1",
          title: "Flush coco",
          priority: "urgent",
          status: "open",
          plantName: "Plant 01",
          createdAt: "2026-05-15T12:00:00Z",
        },
        {
          id: "task-2",
          title: "Recheck pH",
          priority: "medium",
          status: "in_progress",
          plantName: "Plant 02",
          createdAt: "2026-05-14T12:00:00Z",
        },
        {
          id: "task-3",
          title: "Restock cal-mag",
          priority: "low",
          status: "open",
          plantName: null,
          createdAt: "2026-05-13T12:00:00Z",
        },
      ],
    });

    // Confirm the per-grow queries were scoped on grow_id = grow-1 (not
    // some other identifier accidentally substituted).
    const findingsCall = calls.find((c) => c.table === "plant_findings");
    expect(findingsCall?.eqs).toContainEqual({
      column: "grow_id",
      value: "grow-1",
    });
    const tasksCall = calls.find((c) => c.table === "grow_tasks");
    expect(tasksCall?.eqs).toContainEqual({
      column: "grow_id",
      value: "grow-1",
    });
    const plantsCall = calls.find((c) => c.table === "plants");
    expect(plantsCall?.eqs).toContainEqual({
      column: "grow_id",
      value: "grow-1",
    });
    // The plant-count query must exclude archived plants.
    expect(plantsCall?.eqs).toContainEqual({
      column: "is_archived",
      value: false,
    });
  });

  it("returns an empty findings/tasks list when neither query yields rows and defaults plantCount to 0", async () => {
    const { client } = makeSupabase({
      grow: { data: { ...GROW_ROW, start_date: null }, error: null },
      plantCount: { count: null },
      findings: { data: null, error: null },
      tasks: { data: null, error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const summary = await loadGrowContextSummary("grow-1");
    expect(summary?.plantCount).toBe(0);
    expect(summary?.recentFindings).toEqual([]);
    expect(summary?.openTasks).toEqual([]);
    // daysSinceStart must be null when start_date is null (so the prompt
    // template skips the "Day N since grow start" line entirely).
    expect(summary?.daysSinceStart).toBeNull();
  });

  it("logs but still returns a summary when the findings query errors", async () => {
    const { client } = makeSupabase({
      grow: { data: GROW_ROW, error: null },
      plantCount: { count: 2 },
      findings: { data: null, error: { message: "findings boom" } },
      tasks: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const summary = await loadGrowContextSummary("grow-1");
    expect(summary?.recentFindings).toEqual([]);
    expect(summary?.openTasks).toEqual([]);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat context findings lookup failed",
      expect.objectContaining({ error: "findings boom", growId: "grow-1" }),
    );
  });

  it("logs but still returns a summary when the tasks query errors", async () => {
    const { client } = makeSupabase({
      grow: { data: GROW_ROW, error: null },
      plantCount: { count: 2 },
      findings: { data: [], error: null },
      tasks: { data: null, error: { message: "tasks boom" } },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const summary = await loadGrowContextSummary("grow-1");
    expect(summary?.openTasks).toEqual([]);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "chat context tasks lookup failed",
      expect.objectContaining({ error: "tasks boom", growId: "grow-1" }),
    );
  });

  it("clamps daysSinceStart to 0 when start_date is in the future and returns null on unparseable input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00Z"));

    const futureRow = { ...GROW_ROW, start_date: "2026-06-01" };
    const { client: futureClient } = makeSupabase({
      grow: { data: futureRow, error: null },
      plantCount: { count: 0 },
      findings: { data: [], error: null },
      tasks: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValueOnce(futureClient);
    const future = await loadGrowContextSummary("grow-1");
    expect(future?.daysSinceStart).toBe(0);

    const badRow = { ...GROW_ROW, start_date: "not-a-date" };
    const { client: badClient } = makeSupabase({
      grow: { data: badRow, error: null },
      plantCount: { count: 0 },
      findings: { data: [], error: null },
      tasks: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValueOnce(badClient);
    const bad = await loadGrowContextSummary("grow-1");
    expect(bad?.daysSinceStart).toBeNull();
  });
});
