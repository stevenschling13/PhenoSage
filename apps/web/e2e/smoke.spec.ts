import { expect, test } from "@playwright/test";

test.describe("PhenoSage smoke", () => {
  test("web health endpoint responds 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
  });

  test("landing page renders without error", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
  });
});
