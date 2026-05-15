import { beforeEach, describe, expect, it, vi } from "vitest";

type AiCompletion = {
  choices: { message: { content: string | null } }[];
};

const aiMocks = vi.hoisted(() => {
  const create = vi.fn<() => Promise<AiCompletion>>();
  return {
    create,
    getAIClient: vi.fn(() => ({ chat: { completions: { create } } })),
  };
});

vi.mock("../ai-client", () => ({
  getAIClient: aiMocks.getAIClient,
}));
vi.mock("../request-id", () => ({
  logServerEvent: vi.fn(),
}));

import {
  buildDigestPrompt,
  buildDigestSnapshot,
  digestPriority,
  hasMeaningfulActivity,
  listUsersWithActiveGrows,
  renderDigest,
} from "../daily-digest";

// ─── Supabase fluent-builder mock ────────────────────────────────────
// Calls to `supabase.from('x')` return a chainable builder that tests
// configure per-call via a queue keyed on table name.

type ChainResult = {
  data?: unknown[] | null;
  error?: { message: string } | null;
  count?: number;
};

function makeBuilder(getResult: () => ChainResult) {
  // Each terminal `await builder` resolves with the result. Intermediate
  // operators (select, eq, in, gte, order, limit, not) return the same
  // builder for chaining.
  const builder: Record<string, (..._a: unknown[]) => unknown> = {};
  const passthrough = () => builder;
  builder.select = passthrough;
  builder.eq = passthrough;
  builder.in = passthrough;
  builder.gte = passthrough;
  builder.lte = passthrough;
  builder.order = passthrough;
  builder.limit = passthrough;
  builder.not = passthrough;
  // Make the builder thenable so `await` on any chain step resolves.
  (
    builder as unknown as {
      then: (_resolve: (_r: ChainResult) => void) => void;
    }
  ).then = (resolve) => resolve(getResult());
  return builder;
}

function makeSupabaseMock(byTable: Record<string, ChainResult[]>) {
  const cursors: Record<string, number> = {};
  return {
    from: vi.fn((table: string) => {
      return makeBuilder(() => {
        const queue = byTable[table] ?? [];
        const i = cursors[table] ?? 0;
        cursors[table] = i + 1;
        return queue[i] ?? { data: [], error: null };
      });
    }),
  };
}

describe("hasMeaningfulActivity", () => {
  it("returns false when every signal is zero", () => {
    expect(
      hasMeaningfulActivity({
        userId: "u",
        grows: [],
        newFindings: [],
        newImages: 0,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }),
    ).toBe(false);
  });

  it("returns true when any single signal is non-zero", () => {
    expect(
      hasMeaningfulActivity({
        userId: "u",
        grows: [],
        newFindings: [],
        newImages: 1,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }),
    ).toBe(true);
  });
});

describe("digestPriority", () => {
  it("returns 'critical' when any finding is critical severity", () => {
    expect(
      digestPriority({
        userId: "u",
        grows: [],
        newFindings: [
          {
            id: "f1",
            title: "x",
            severity: "critical",
            growId: "g",
            plantId: "p",
          },
        ],
        newImages: 0,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }),
    ).toBe("critical");
  });

  it("returns 'warning' when there is a high finding but no critical", () => {
    expect(
      digestPriority({
        userId: "u",
        grows: [],
        newFindings: [
          { id: "f1", title: "x", severity: "high", growId: "g", plantId: "p" },
        ],
        newImages: 0,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }),
    ).toBe("warning");
  });

  it("returns 'info' otherwise", () => {
    expect(
      digestPriority({
        userId: "u",
        grows: [],
        newFindings: [
          { id: "f1", title: "x", severity: "low", growId: "g", plantId: "p" },
        ],
        newImages: 1,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }),
    ).toBe("info");
  });
});

describe("buildDigestPrompt", () => {
  it("names every active grow and reports each signal in plain English", () => {
    const prompt = buildDigestPrompt({
      userId: "u",
      grows: [
        { id: "g1", name: "Tent A", stage: "flower" },
        { id: "g2", name: "Tent B", stage: "vegetative" },
      ],
      newFindings: [
        {
          id: "f1",
          title: "Nitrogen deficiency",
          severity: "high",
          growId: "g1",
          plantId: "p1",
        },
      ],
      newImages: 3,
      newObservations: 1,
      newTasks: 2,
      resolvedFindings: 4,
    });
    expect(prompt).toMatch(/Tent A \(flower\)/);
    expect(prompt).toMatch(/Tent B \(vegetative\)/);
    expect(prompt).toMatch(/\[high\] Nitrogen deficiency/);
    expect(prompt).toMatch(/New images uploaded: 3/);
    expect(prompt).toMatch(/Findings marked resolved: 4/);
    expect(prompt).toMatch(/do not invent details/i);
  });
});

describe("renderDigest", () => {
  beforeEach(() => {
    aiMocks.create.mockReset().mockResolvedValue({
      choices: [{ message: { content: "Quiet day. Two captures landed." } }],
    });
  });

  it("titles a critical-finding digest with 'critical finding'", async () => {
    const result = await renderDigest({
      userId: "u",
      grows: [],
      newFindings: [
        {
          id: "f1",
          title: "Root rot",
          severity: "critical",
          growId: "g",
          plantId: "p",
        },
      ],
      newImages: 0,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    });
    expect(result.title).toMatch(/1 critical finding/);
    expect(result.body).toBe("Quiet day. Two captures landed.");
  });

  it("titles a high-only digest with 'high-severity finding'", async () => {
    const result = await renderDigest({
      userId: "u",
      grows: [],
      newFindings: [
        {
          id: "f1",
          title: "Calcium deficiency",
          severity: "high",
          growId: "g",
          plantId: "p",
        },
      ],
      newImages: 0,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    });
    expect(result.title).toMatch(/1 high-severity finding/);
  });

  it("falls back to a neutral title when no findings", async () => {
    const result = await renderDigest({
      userId: "u",
      grows: [],
      newFindings: [],
      newImages: 5,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    });
    expect(result.title).toBe("Today's grow summary");
  });

  it("survives empty AI content with a fallback body", async () => {
    aiMocks.create.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });
    const result = await renderDigest({
      userId: "u",
      grows: [],
      newFindings: [],
      newImages: 1,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    });
    expect(result.body).toMatch(/no summary/i);
  });
});

describe("listUsersWithActiveGrows", () => {
  it("returns the union of owners and members (deduplicated)", async () => {
    const supabase = makeSupabaseMock({
      grows: [{ data: [{ owner_id: "u1" }, { owner_id: "u2" }], error: null }],
      grow_members: [
        { data: [{ user_id: "u2" }, { user_id: "u3" }], error: null },
      ],
    });
    const result = await listUsersWithActiveGrows(supabase as never);
    expect(result.sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("degrades to whatever side succeeds when one query errors", async () => {
    const supabase = makeSupabaseMock({
      grows: [{ data: null, error: { message: "boom" } }],
      grow_members: [{ data: [{ user_id: "u4" }], error: null }],
    });
    const result = await listUsersWithActiveGrows(supabase as never);
    expect(result).toEqual(["u4"]);
  });
});

describe("buildDigestSnapshot", () => {
  it("returns empty snapshot when user owns no active grows", async () => {
    const supabase = makeSupabaseMock({
      grows: [{ data: [], error: null }],
    });
    const result = await buildDigestSnapshot(supabase as never, "u1");
    expect(result).toEqual({
      userId: "u1",
      grows: [],
      newFindings: [],
      newImages: 0,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    });
  });

  it("aggregates findings, image count, observation count, task count, and resolved count", async () => {
    const supabase = makeSupabaseMock({
      grows: [
        { data: [{ id: "g1", name: "Tent", stage: "flower" }], error: null },
      ],
      plants: [{ data: [{ id: "p1" }], error: null }],
      plant_findings: [
        // 1st call: list new findings
        {
          data: [
            {
              id: "f1",
              title: "Wilt",
              severity: "high",
              grow_id: "g1",
              plant_id: "p1",
            },
          ],
          error: null,
        },
        // 2nd call: count resolved
        { data: null, error: null, count: 2 },
      ],
      plant_images: [{ data: null, error: null, count: 4 }],
      plant_observations: [{ data: null, error: null, count: 1 }],
      grow_tasks: [{ data: null, error: null, count: 3 }],
    });
    const result = await buildDigestSnapshot(supabase as never, "u1");
    expect(result.grows).toEqual([{ id: "g1", name: "Tent", stage: "flower" }]);
    expect(result.newFindings).toEqual([
      {
        id: "f1",
        title: "Wilt",
        severity: "high",
        growId: "g1",
        plantId: "p1",
      },
    ]);
    expect(result.newImages).toBe(4);
    expect(result.newObservations).toBe(1);
    expect(result.newTasks).toBe(3);
    expect(result.resolvedFindings).toBe(2);
  });
});
