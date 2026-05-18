import { describe, expect, it } from "vitest";
import {
  CHAT_SYSTEM_PROMPT,
  renderGrowContextBlock,
  type GrowContextSummary,
} from "../chat-prompt";

function makeSummary(
  overrides: Partial<GrowContextSummary> = {},
): GrowContextSummary {
  return {
    growId: "grow-1",
    name: "North tent",
    stage: "veg",
    medium: "coco",
    lightType: "led",
    startDate: "2026-04-01",
    daysSinceStart: 47,
    plantCount: 4,
    recentFindings: [],
    openTasks: [],
    ...overrides,
  };
}

describe("CHAT_SYSTEM_PROMPT", () => {
  it("is a non-empty string anchored on PhenoSage identity", () => {
    expect(typeof CHAT_SYSTEM_PROMPT).toBe("string");
    expect(CHAT_SYSTEM_PROMPT.length).toBeGreaterThan(500);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/PhenoSage/);
  });
});

describe("renderGrowContextBlock", () => {
  it("returns the no-grow guidance when summary is null", () => {
    const out = renderGrowContextBlock(null);
    expect(out).toMatch(/## Grower context/);
    expect(out).toMatch(/No grow selected/);
    expect(out).toMatch(/`list_grows`/);
  });

  it("renders all grow metadata lines when fully populated", () => {
    const out = renderGrowContextBlock(makeSummary());
    expect(out).toContain("- Grow: North tent (id: grow-1)");
    expect(out).toContain("- Stage: veg");
    expect(out).toContain("- Medium: coco");
    expect(out).toContain("- Light: led");
    expect(out).toContain("- Day 47 since grow start");
    expect(out).toContain("- Plants: 4");
  });

  it("omits optional grow lines when their values are null", () => {
    const out = renderGrowContextBlock(
      makeSummary({
        stage: null,
        medium: null,
        lightType: null,
        startDate: null,
        daysSinceStart: null,
      }),
    );
    expect(out).not.toMatch(/^- Stage:/m);
    expect(out).not.toMatch(/^- Medium:/m);
    expect(out).not.toMatch(/^- Light:/m);
    expect(out).not.toMatch(/^- Day \d+ since grow start/m);
    // Plants line is unconditional.
    expect(out).toContain("- Plants: 4");
  });

  it("renders day 0 as a present line (covers the 0-but-not-null branch)", () => {
    const out = renderGrowContextBlock(
      makeSummary({ startDate: "2026-04-01", daysSinceStart: 0 }),
    );
    expect(out).toContain("- Day 0 since grow start");
  });

  it("shows 'None in the last 30 days' when there are no findings", () => {
    const out = renderGrowContextBlock(makeSummary({ recentFindings: [] }));
    expect(out).toMatch(/### Recent findings\nNone in the last 30 days\./);
  });

  it("formats recent findings with severity, category, title and plant name", () => {
    const out = renderGrowContextBlock(
      makeSummary({
        recentFindings: [
          {
            title: "Calcium deficiency",
            category: "nutrient",
            severity: "high",
            plantName: "Plant 02",
            createdAt: "2026-05-10T00:00:00Z",
          },
          {
            title: "Light burn",
            category: "environment",
            severity: "medium",
            plantName: null,
            createdAt: "2026-05-12T00:00:00Z",
          },
        ],
      }),
    );
    expect(out).toContain("### Recent findings (last 30 days)");
    expect(out).toContain("- [high] nutrient: Calcium deficiency on Plant 02");
    // plantName=null suppresses the " on <plant>" suffix.
    expect(out).toMatch(/- \[medium\] environment: Light burn$/m);
  });

  it("shows 'No open tasks right now.' when there are no tasks", () => {
    const out = renderGrowContextBlock(makeSummary({ openTasks: [] }));
    expect(out).toMatch(/### Open tasks\nNo open tasks right now\./);
  });

  it("formats open tasks with priority, plant tag, in_progress flag, and id", () => {
    const out = renderGrowContextBlock(
      makeSummary({
        openTasks: [
          {
            id: "task-1",
            title: "Flush plant 3",
            priority: "urgent",
            status: "open",
            plantName: "Plant 03",
            createdAt: "2026-05-10T00:00:00Z",
          },
          {
            id: "task-2",
            title: "Inspect roots",
            priority: "low",
            status: "in_progress",
            plantName: null,
            createdAt: "2026-05-11T00:00:00Z",
          },
        ],
      }),
    );
    expect(out).toContain("### Open tasks (worklist)");
    expect(out).toContain("- [urgent] Flush plant 3 (Plant 03) — id task-1");
    // No plant name + in_progress => no parens, [in progress] tag present.
    expect(out).toContain("- [low] Inspect roots [in progress] — id task-2");
  });
});
