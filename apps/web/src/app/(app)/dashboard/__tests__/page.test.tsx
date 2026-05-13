// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/server/profile", () => ({
  getCurrentProfile: vi.fn(async () => ({
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    id: "user-1",
  })),
}));

vi.mock("@/lib/server/workspace-overview", () => ({
  getWorkspaceOverview: vi.fn(async () => ({
    grows: [
      {
        id: "grow-1",
        imageCount: 4,
        lightType: "led",
        medium: "soil",
        name: "Tent A",
        openFindingCount: 1,
        plantCount: 2,
        primaryPlantId: "plant-1",
        primaryPlantName: "Blue Dream #1",
        stage: "veg",
        startDate: "2026-04-01T00:00:00Z",
        updatedAt: "2026-05-10T12:00:00Z",
      },
    ],
    openFindings: 1,
    recentActivity: {
      lastCaptureAt: "2026-05-10T12:00:00Z",
      lastPlantUpdateAt: "2026-05-09T00:00:00Z",
    },
    recentFindings: [
      {
        createdAt: "2026-05-10T12:00:00Z",
        growId: "grow-1",
        id: "finding-1",
        plantId: "plant-1",
        plantName: "Blue Dream #1",
        severity: "high" as const,
        title: "Possible nitrogen deficiency",
      },
    ],
    totals: { grows: 1, images: 4, plants: 2 },
  })),
}));

import DashboardPage from "@/app/(app)/dashboard/page";

async function renderPage() {
  const ui = await DashboardPage();
  render(ui);
}

describe("DashboardPage", () => {
  it("renders the greeting with the operator's first name", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /, Ada\.$/ }),
    ).toBeInTheDocument();
  });

  it('exposes <main id="main-content"> for the global SkipLink target', async () => {
    await renderPage();
    const main = document.querySelector("main#main-content");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("tabindex")).toBe("-1");
  });

  it("surfaces the workspace stats (grows, captures, findings)", async () => {
    await renderPage();
    expect(screen.getByText("Active grows")).toBeInTheDocument();
    expect(screen.getByText("Capture history")).toBeInTheDocument();
    expect(screen.getByText("Open watch items")).toBeInTheDocument();
    expect(
      screen.getByText("Possible nitrogen deficiency"),
    ).toBeInTheDocument();
  });

  it("links the recent finding to the plant detail page", async () => {
    await renderPage();
    const reviewLink = screen.getByRole("link", { name: /review/i });
    expect(reviewLink).toHaveAttribute("href", "/plants/plant-1");
  });

  it("offers the primary call-to-action links in the hero", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /ask copilot/i })).toHaveAttribute(
      "href",
      "/assistant",
    );
    expect(screen.getByRole("link", { name: /new grow/i })).toHaveAttribute(
      "href",
      "/grows/new",
    );
  });

  it("renders the empty-state copy when the workspace has no data", async () => {
    const { getWorkspaceOverview } =
      await import("@/lib/server/workspace-overview");
    vi.mocked(getWorkspaceOverview).mockResolvedValueOnce({
      grows: [],
      openFindings: 0,
      recentActivity: { lastCaptureAt: null, lastPlantUpdateAt: null },
      recentFindings: [],
      totals: { grows: 0, images: 0, plants: 0 },
    });
    await renderPage();
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
    expect(screen.getByText("Grow registry still empty")).toBeInTheDocument();
  });
});
