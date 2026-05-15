import { describe, expect, it } from "vitest";
import type {
  AnalysisResponse,
  FindingCategory,
  FindingSeverity,
  Grow,
  GrowStage,
  GrowTask,
  Plant,
  PlantFinding,
  TaskPriority,
  TaskStatus,
} from "../types";

describe("shared contract types", () => {
  it("accepts a well-formed Grow", () => {
    const grow: Grow = {
      id: "g1",
      ownerId: "u1",
      name: "Tent A",
      stage: "vegetative",
      medium: "coco",
      lightType: "led",
      startDate: "2026-04-01",
      isArchived: false,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    };
    expect(grow.stage).toBe("vegetative");
  });

  it("enumerates all known GrowStages", () => {
    const stages: GrowStage[] = [
      "germination",
      "seedling",
      "vegetative",
      "pre_flower",
      "flower",
      "late_flower",
      "harvest",
      "dry_cure",
    ];
    expect(stages).toHaveLength(8);
  });

  it("accepts a Plant without optional fields", () => {
    const plant: Plant = {
      id: "p1",
      growId: "g1",
      name: "Plant 1",
      isArchived: false,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    };
    expect(plant.id).toBe("p1");
  });

  it("constrains PlantFinding severity and category to known unions", () => {
    const severities: FindingSeverity[] = [
      "info",
      "low",
      "medium",
      "high",
      "critical",
    ];
    const categories: FindingCategory[] = [
      "nutrient_deficiency",
      "nutrient_toxicity",
      "pest",
      "disease",
      "environmental",
      "training",
      "general",
      "positive",
    ];
    const finding: PlantFinding = {
      id: "f1",
      plantId: "p1",
      growId: "g1",
      category: categories[0]!,
      severity: severities[4]!,
      title: "N deficiency",
      description: "Yellowing lower leaves",
      source: "ai",
      createdAt: "2026-04-01T00:00:00Z",
    };
    expect(finding.severity).toBe("critical");
  });

  it("accepts a user-reported PlantFinding (migration 010)", () => {
    const finding: PlantFinding = {
      id: "f2",
      plantId: "p1",
      growId: "g1",
      category: "pest",
      severity: "high",
      title: "Spider mites on lower fan leaves",
      description: "Stippling + webbing observed at lights-on",
      source: "user_reported",
      createdAt: "2026-04-02T00:00:00Z",
    };
    expect(finding.source).toBe("user_reported");
  });

  it("accepts a GrowTask covering all priorities and statuses (migration 008)", () => {
    const priorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
    const statuses: TaskStatus[] = ["open", "in_progress", "done", "dismissed"];
    const task: GrowTask = {
      id: "t1",
      growId: "g1",
      plantId: "p1",
      findingId: "f1",
      title: "Address: N deficiency",
      description: "Bump base nutrient EC by 0.2",
      priority: priorities[3]!,
      status: statuses[0]!,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    };
    expect(task.priority).toBe("urgent");
    expect(task.status).toBe("open");
  });

  it("accepts an AnalysisResponse with findings array", () => {
    const response: AnalysisResponse = {
      plantId: "p1",
      imageId: "i1",
      overallHealthScore: 82,
      summary: "Minor stress; otherwise healthy.",
      findings: [
        {
          category: "environmental",
          severity: "low",
          title: "Light stress",
          description: "Slight bleaching on tops",
        },
      ],
      analyzedAt: "2026-04-01T00:00:00Z",
      modelVersion: "phenosage-v1",
    };
    expect(response.findings).toHaveLength(1);
    expect(response.overallHealthScore).toBeGreaterThanOrEqual(0);
    expect(response.overallHealthScore).toBeLessThanOrEqual(100);
  });
});
