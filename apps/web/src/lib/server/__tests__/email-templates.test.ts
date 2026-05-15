import { describe, expect, it } from "vitest";

import { dailySummaryEmail, findingAlertEmail } from "../email-templates";

describe("dailySummaryEmail", () => {
  const baseSnapshot = {
    userId: "user-1",
    grows: [{ id: "g1", name: "Tent A", stage: "veg" }],
    newFindings: [
      {
        id: "f1",
        title: "Powdery mildew",
        severity: "critical",
        growId: "g1",
        plantId: "p1",
      },
    ],
    newImages: 3,
    newObservations: 2,
    newTasks: 1,
    resolvedFindings: 0,
  };

  it("encodes a deterministic, dedupable idempotency key", () => {
    const built = dailySummaryEmail({
      snapshot: baseSnapshot,
      title: "Today's grow summary",
      body: "All good.",
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });
    expect(built.idempotencyKey).toBe("daily-summary:user-1:2026-05-15");
  });

  it("emits subject = title, includes both html + text bodies", () => {
    const built = dailySummaryEmail({
      snapshot: baseSnapshot,
      title: "Today's grow summary",
      body: "Two things to check.",
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });
    expect(built.subject).toBe("Today's grow summary");
    expect(built.html).toContain("Today&#39;s grow summary");
    expect(built.text).toContain("Today's grow summary");
    expect(built.text).toContain("Two things to check.");
  });

  it("escapes HTML in user-derived strings to prevent injection", () => {
    const built = dailySummaryEmail({
      snapshot: {
        ...baseSnapshot,
        newFindings: [
          {
            id: "f1",
            title: "<script>alert(1)</script>",
            severity: "high",
            growId: "g1",
            plantId: "p1",
          },
        ],
      },
      title: "Hello <b>world</b>",
      body: 'Body & "stuff"',
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(built.html).toContain("Hello &lt;b&gt;world&lt;/b&gt;");
    expect(built.html).toContain("Body &amp; &quot;stuff&quot;");
  });

  it("includes a dashboard CTA built from appUrl with no double slash", () => {
    const built = dailySummaryEmail({
      snapshot: baseSnapshot,
      title: "t",
      body: "b",
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app/", // trailing slash on purpose
    });
    expect(built.html).toContain('href="https://phenosage.app/dashboard"');
    expect(built.text).toContain(
      "Open dashboard: https://phenosage.app/dashboard",
    );
  });

  it("caps finding list to 5 items in both html and text", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`,
      title: `Issue ${i}`,
      severity: "high",
      growId: "g1",
      plantId: "p1",
    }));
    const built = dailySummaryEmail({
      snapshot: { ...baseSnapshot, newFindings: many },
      title: "t",
      body: "b",
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });
    // Exactly 5 list items in the html
    expect(built.html.match(/<li>/g)?.length).toBe(5);
    // Item 5 (the 6th) should NOT appear
    expect(built.text).toContain("Issue 0");
    expect(built.text).toContain("Issue 4");
    expect(built.text).not.toContain("Issue 5");
  });

  it("sets analytics tags including kind and occurred_on", () => {
    const built = dailySummaryEmail({
      snapshot: baseSnapshot,
      title: "t",
      body: "b",
      occurredOn: "2026-05-15",
      appUrl: "https://phenosage.app",
    });
    expect(built.tags).toEqual([
      { name: "kind", value: "daily_summary" },
      { name: "occurred_on", value: "2026-05-15" },
    ]);
  });
});

describe("findingAlertEmail", () => {
  it("uses finding id as the idempotency key", () => {
    const built = findingAlertEmail({
      userId: "user-1",
      findingId: "find-abc",
      plantId: "p1",
      growId: "g1",
      severity: "critical",
      title: "Bud rot",
      body: "Action needed.",
      appUrl: "https://phenosage.app",
    });
    expect(built.idempotencyKey).toBe("finding-alert:find-abc");
  });

  it("subject prepends the severity label", () => {
    const critical = findingAlertEmail({
      userId: "u",
      findingId: "f",
      plantId: "p",
      growId: "g",
      severity: "critical",
      title: "Bud rot",
      body: null,
      appUrl: "https://phenosage.app",
    });
    expect(critical.subject).toBe("Critical: Bud rot");

    const high = findingAlertEmail({
      userId: "u",
      findingId: "f",
      plantId: "p",
      growId: "g",
      severity: "high",
      title: "Nutrient burn",
      body: null,
      appUrl: "https://phenosage.app",
    });
    expect(high.subject).toBe("High: Nutrient burn");
  });

  it("escapes HTML in title and body", () => {
    const built = findingAlertEmail({
      userId: "u",
      findingId: "f",
      plantId: "p",
      growId: "g",
      severity: "critical",
      title: "<img src=x onerror=alert(1)>",
      body: "<svg/onload=alert(1)>",
      appUrl: "https://phenosage.app",
    });
    expect(built.html).not.toContain("<img src=x");
    expect(built.html).not.toContain("<svg/onload");
    expect(built.html).toContain("&lt;img");
  });

  it("URL-encodes the plantId and findingId in the deep-link", () => {
    const built = findingAlertEmail({
      userId: "u",
      findingId: "find with spaces",
      plantId: "plant/slash",
      growId: "g",
      severity: "critical",
      title: "t",
      body: null,
      appUrl: "https://phenosage.app",
    });
    expect(built.html).toContain("plant%2Fslash");
    expect(built.html).toContain("find%20with%20spaces");
  });
});
