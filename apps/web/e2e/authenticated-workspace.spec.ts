import { expect, test } from "@playwright/test";
import {
  cleanupAuthenticatedWorkspaceUser,
  createAuthenticatedWorkspaceUser,
} from "./helpers/supabase-admin";

const AUTH_SMOKE_ENABLED = process.env["E2E_AUTH_SMOKE"] === "1";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM0YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Authenticated workspace smoke", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !AUTH_SMOKE_ENABLED,
    "Set E2E_AUTH_SMOKE=1 to run authenticated preview/local smoke coverage.",
  );

  test("core workflow is usable end to end", async ({ page }) => {
    test.slow();

    const workspace = await createAuthenticatedWorkspaceUser();
    const growName = `Smoke Grow ${Date.now()}`;
    const plantName = `Smoke Plant ${Date.now()}`;
    const displayName = `Smoke Operator ${Date.now()}`;
    const assistantPrompt =
      "Give me a short operator update based on the current workspace.";

    try {
      await test.step("sign in through the real auth page", async () => {
        await page.goto("/auth");
        await page.getByLabel("Email").fill(workspace.email);
        await page.getByLabel("Password").fill(workspace.password);
        await page.getByRole("button", { name: "Enter workspace" }).click();
        await page.waitForURL("**/dashboard");
      });

      await test.step("create the first grow from a real CTA", async () => {
        const newGrowLink = page
          .getByRole("link", { name: "New grow" })
          .first();
        await expect(newGrowLink).toHaveAttribute("href", "/grows/new");
        await newGrowLink.click();
        await page.waitForURL("**/grows/new");

        await page.getByLabel("Grow name").fill(growName);
        await page
          .getByLabel("Description")
          .fill("Temporary grow created by the authenticated smoke suite.");
        await page.getByLabel("Stage").selectOption("vegetative");
        await page.getByLabel("Medium").selectOption("soil");
        await page.getByLabel("Light type").selectOption("led");
        await page.getByRole("button", { name: "Create grow" }).click();

        // Post-create lands directly on the grow detail page so the
        // user sees the grow they just created. The detail page shows
        // a confirmation banner and an "Add a plant" CTA preselecting
        // this grow.
        await page.waitForURL(/\/grows\/[^/?]+\?just_created=1/);
        await expect(
          page.getByText(new RegExp(`Grow .${growName}. is ready`, "i")),
        ).toBeVisible();
        await page.getByRole("link", { name: "Add a plant" }).first().click();
        await page.waitForURL(/\/plants\/new\?growId=/);
      });

      let plantId = "";

      await test.step("add a plant to the new grow and verify it lists on /plants", async () => {
        await page.getByLabel("Plant name").fill(plantName);
        await page.getByLabel("Strain").fill("Playwright Kush");
        await page.getByLabel("Batch label").fill("SMOKE-BATCH");
        await page
          .getByLabel("Notes")
          .fill("Temporary plant created by the authenticated smoke suite.");
        await page.getByRole("button", { name: "Create plant" }).click();

        await page.waitForURL("**/plants/*");
        plantId = page.url().split("/plants/")[1] ?? "";
        expect(plantId.length).toBeGreaterThan(0);
        await expect(
          page.getByRole("heading", { name: new RegExp(plantName, "i") }),
        ).toBeVisible();

        await page.goto("/plants");
        await expect(page.getByText(plantName)).toBeVisible();
      });

      await test.step("upload a photo through the signed-upload path and surface timeline data", async () => {
        await page.goto(`/plants/${plantId}`);
        await page.locator('input[type="file"]').setInputFiles({
          buffer: PNG_1X1,
          mimeType: "image/png",
          name: "smoke-leaf.png",
        });

        const signResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes("/api/uploads/sign"),
        );
        const finalizeResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes(`/api/plants/${plantId}/images`),
        );
        const analyzeResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes(`/api/plants/${plantId}/analyze`),
        );

        await page.getByRole("button", { name: "Upload photo" }).click();

        const [signResponse, finalizeResponse, analyzeResponse] =
          await Promise.all([
            signResponsePromise,
            finalizeResponsePromise,
            analyzeResponsePromise,
          ]);

        expect(signResponse.ok()).toBeTruthy();
        expect(signResponse.headers()["x-request-id"]).toBeTruthy();
        const signPayload = (await signResponse.json()) as {
          imageId?: string;
          storagePath?: string;
          token?: string;
        };
        expect(signPayload.imageId).toBeTruthy();
        expect(signPayload.storagePath).toContain(`${plantId}/`);
        expect(signPayload.token).toBeTruthy();

        expect(finalizeResponse.ok()).toBeTruthy();
        expect(analyzeResponse.ok()).toBeTruthy();

        await expect(
          page.getByText(
            /Image uploaded and analyzed|inconclusive fallback output|Image uploaded successfully, but analysis is unavailable right now/i,
          ),
        ).toBeVisible();
        await expect(page.getByText(/Longitudinal timeline/i)).toBeVisible();

        const timelineResponse = await page
          .context()
          .request.get(
            new URL(`/api/plants/${plantId}/timeline`, page.url()).toString(),
          );
        expect(timelineResponse.ok()).toBeTruthy();
        const timelinePayload = (await timelineResponse.json()) as {
          items: Array<{ id: string; type: string }>;
        };
        expect(
          timelinePayload.items.some((item) => item.type === "image"),
        ).toBe(true);
      });

      await test.step("save a display name in settings and reflect it in the workspace", async () => {
        await page.goto("/settings");
        await page.getByLabel("Display name").fill(displayName);
        await page.getByRole("button", { name: "Save display name" }).click();
        await expect(page.getByText("Display name saved.")).toBeVisible();

        await page.goto("/dashboard");
        await expect(
          page.getByRole("heading", {
            name: new RegExp(`Welcome back, ${displayName}`, "i"),
          }),
        ).toBeVisible();
      });

      await test.step("send a real assistant message through /api/chat", async () => {
        await page.goto("/assistant");
        await page
          .getByLabel("Ask the PhenoSage assistant")
          .fill(assistantPrompt);

        const chatResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes("/api/chat"),
        );

        await page.getByRole("button", { name: "Send to copilot" }).click();

        const chatResponse = await chatResponsePromise;
        expect(chatResponse.ok()).toBeTruthy();
        expect(chatResponse.headers()["x-request-id"]).toBeTruthy();
        expect(chatResponse.headers()["x-chat-thread-id"]).toBeTruthy();
        expect((await chatResponse.text()).trim().length).toBeGreaterThan(0);

        await expect(page.getByText(assistantPrompt)).toBeVisible();
        await expect(page.getByText("Thread active")).toBeVisible();
        await expect
          .poll(
            async () => {
              const messages = await page
                .locator("article p.whitespace-pre-wrap")
                .allTextContents();
              return messages.length;
            },
            { timeout: 30_000 },
          )
          .toBeGreaterThan(2);
      });
    } finally {
      await cleanupAuthenticatedWorkspaceUser(workspace);
    }
  });
});
