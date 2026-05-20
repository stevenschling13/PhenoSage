import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const createSupabaseServerClient = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { getTriageInbox } from "../triage";

type Settled = { data: unknown[] | null; error: { message: string } | null };

function makeSupabase(
  handlers: Record<string, () => Settled | Promise<Settled>>,
) {
  // Each table returns a fluent builder whose terminal `.limit()` or
  // `.order()` resolves to the handler's settled shape. The builder is
  // intentionally lax — every callable on it returns itself (or a
  // thenable on terminal calls).
  return {
    from: (table: string) => {
      const settle = handlers[table];
      const settled = async (): Promise<Settled> => {
        if (!settle) return { data: [], error: null };
        const res = await settle();
        return res;
      };
      const builder: {
        select: () => typeof builder;
        eq: () => typeof builder;
        in: () => typeof builder;
        order: () => typeof builder;
        limit: () => typeof builder;
        then: (
          _onfulfilled: (_value: Settled) => unknown,
          _onrejected?: (_reason: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (onfulfilled, onrejected) =>
          settled().then(onfulfilled, onrejected),
      };
      return builder;
    },
  };
}

describe("getTriageInbox", () => {
  beforeEach(() => {
    (createSupabaseServerClient as Mock).mockReset();
    (logServerEvent as Mock).mockReset();
  });

  it("returns an empty inbox if the supabase client init throws", async () => {
    createSupabaseServerClient.mockRejectedValue(new Error("boom"));
    const inbox = await getTriageInbox();
    expect(inbox).toEqual({ findings: [], tasks: [] });
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "triage inbox client init failed",
      expect.objectContaining({ error: "boom" }),
    );
  });

  it("joins grow + plant names onto findings and sorts by severity desc", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        grows: () => ({
          data: [
            { id: "g1", name: "Tent A" },
            { id: "g2", name: "Tent B" },
          ],
          error: null,
        }),
        plants: () => ({
          data: [
            { id: "p1", name: "Blue Dream #1", grow_id: "g1" },
            { id: "p2", name: "Wedding Cake #2", grow_id: "g2" },
          ],
          error: null,
        }),
        plant_findings: () => ({
          data: [
            {
              id: "f-low",
              plant_id: "p1",
              grow_id: "g1",
              image_id: null,
              category: "training",
              severity: "low",
              confidence_score: 0.8,
              title: "Minor stretch",
              description: "Mild stretch",
              recommendation: null,
              source: "ai",
              resolution_state: "pending",
              resolution_note: null,
              created_at: "2026-05-15T00:00:00Z",
            },
            {
              id: "f-critical",
              plant_id: "p2",
              grow_id: "g2",
              image_id: null,
              category: "pest",
              severity: "critical",
              confidence_score: 0.95,
              title: "Spider mites",
              description: "Webbing visible",
              recommendation: "Spray neem",
              source: "ai",
              resolution_state: "pending",
              resolution_note: null,
              created_at: "2026-05-14T00:00:00Z",
            },
          ],
          error: null,
        }),
        grow_tasks: () => ({ data: [], error: null }),
      }),
    );

    const inbox = await getTriageInbox();
    expect(inbox.findings).toHaveLength(2);
    // Critical sorts ahead of low even though low is newer.
    expect(inbox.findings[0]!.id).toBe("f-critical");
    expect(inbox.findings[0]!.growName).toBe("Tent B");
    expect(inbox.findings[0]!.plantName).toBe("Wedding Cake #2");
    expect(inbox.findings[0]!.recommendation).toBe("Spray neem");
    expect(inbox.findings[1]!.id).toBe("f-low");
  });

  it("sorts tasks by priority desc and preserves nullable plant linkage", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        grows: () => ({ data: [{ id: "g1", name: "Tent A" }], error: null }),
        plants: () => ({
          data: [{ id: "p1", name: "Blue Dream #1", grow_id: "g1" }],
          error: null,
        }),
        plant_findings: () => ({ data: [], error: null }),
        grow_tasks: () => ({
          data: [
            {
              id: "t-low",
              grow_id: "g1",
              plant_id: "p1",
              finding_id: null,
              title: "Top later",
              description: null,
              priority: "low",
              status: "open",
              due_at: null,
              created_at: "2026-05-15T00:00:00Z",
              updated_at: "2026-05-15T00:00:00Z",
              completed_at: null,
            },
            {
              id: "t-urgent",
              grow_id: "g1",
              plant_id: null,
              finding_id: "f-x",
              title: "Pest sweep",
              description: "All plants in tent",
              priority: "urgent",
              status: "in_progress",
              due_at: "2026-05-16T00:00:00Z",
              created_at: "2026-05-13T00:00:00Z",
              updated_at: "2026-05-14T00:00:00Z",
              completed_at: null,
            },
          ],
          error: null,
        }),
      }),
    );

    const inbox = await getTriageInbox();
    expect(inbox.tasks).toHaveLength(2);
    expect(inbox.tasks[0]!.id).toBe("t-urgent");
    expect(inbox.tasks[0]!.plantId).toBeUndefined();
    expect(inbox.tasks[0]!.findingId).toBe("f-x");
    expect(inbox.tasks[0]!.dueAt).toBe("2026-05-16T00:00:00Z");
    expect(inbox.tasks[1]!.id).toBe("t-low");
    expect(inbox.tasks[1]!.plantName).toBe("Blue Dream #1");
  });

  it("soft-degrades failed sources without taking the inbox down", async () => {
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        grows: () => ({ data: [{ id: "g1", name: "Tent A" }], error: null }),
        plants: () => ({ data: [], error: { message: "rls denied" } }),
        plant_findings: () => ({
          data: [
            {
              id: "f-1",
              plant_id: "p-missing",
              grow_id: "g1",
              image_id: null,
              category: "general",
              severity: "medium",
              confidence_score: null,
              title: "Check VPD",
              description: "Trending high",
              recommendation: null,
              source: "ai",
              resolution_state: "pending",
              resolution_note: null,
              created_at: "2026-05-14T00:00:00Z",
            },
          ],
          error: null,
        }),
        grow_tasks: () => Promise.reject(new Error("network blip")),
      }),
    );

    const inbox = await getTriageInbox();
    expect(inbox.findings).toHaveLength(1);
    // Plant fetch failed → unknown plant fallback string.
    expect(inbox.findings[0]!.plantName).toBe("Unknown plant");
    expect(inbox.tasks).toEqual([]);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "triage inbox query failed",
      expect.objectContaining({ source: "plants" }),
    );
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "triage inbox query rejected",
      expect.objectContaining({ source: "grow_tasks" }),
    );
  });
});
