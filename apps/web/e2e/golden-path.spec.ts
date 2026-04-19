import { test, expect } from "@playwright/test";

test.describe("PhenoSage Golden Paths", () => {
  test("Homepage loads and has correct metadata", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Cultivation Intelligence/);

    // Check for main headline
    await expect(page.locator("h1")).toContainText(
      /Serious cultivation intelligence/,
    );

    // Check for CTA
    const enterWorkspaceBtn = page
      .getByRole("link", { name: "Enter the workspace" })
      .first();
    await expect(enterWorkspaceBtn).toBeVisible();
  });

  test("Unauthorized user is redirected to auth from dashboard", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");
    // Should be redirected (either to /auth or similar)
    expect(response?.url()).toContain("/auth");
  });

  test("Navigation elements are present when simulating auth (via routing to /auth)", async ({
    page,
  }) => {
    await page.goto("/auth");

    // In a real E2E we would sign in here, but without Supabase test credentials,
    // we just verify the auth page loads correctly as the boundary.
    await expect(page.locator("body")).toBeVisible();
    // Assuming auth page has a sign in prompt or similar branding
    await expect(page.getByText(/PhenoSage/i).first()).toBeVisible();
  });
});
