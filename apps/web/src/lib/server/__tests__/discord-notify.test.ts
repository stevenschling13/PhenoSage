import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { postDiscordMessage } from "../discord-notify";

const originalUrl = process.env["DISCORD_WEBHOOK_URL"];
const originalFetch = global.fetch;

beforeEach(() => {
  process.env["DISCORD_WEBHOOK_URL"] = "https://discord.test/webhook";
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  if (originalUrl === undefined) {
    delete process.env["DISCORD_WEBHOOK_URL"];
  } else {
    process.env["DISCORD_WEBHOOK_URL"] = originalUrl;
  }
  global.fetch = originalFetch;
});

describe("postDiscordMessage", () => {
  it("skips when DISCORD_WEBHOOK_URL is unset", async () => {
    delete process.env["DISCORD_WEBHOOK_URL"];
    const result = await postDiscordMessage("hello");
    expect(result).toEqual({ kind: "skipped", reason: "no_webhook_url" });
  });

  it("posts the content as JSON to the configured URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await postDiscordMessage("hello world");
    expect(result).toEqual({ kind: "sent" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.test/webhook",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello world" }),
      }),
    );
  });

  it("truncates content beyond the 2000-char Discord limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const long = "a".repeat(2500);
    await postDiscordMessage(long);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const body = JSON.parse(call[1].body) as { content: string };
    expect(body.content.length).toBe(2000);
    expect(body.content.endsWith("…")).toBe(true);
  });

  it("reports failed when Discord returns a non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await postDiscordMessage("hi");
    expect(result).toMatchObject({ kind: "failed", status: 429 });
  });

  it("reports failed when fetch throws", async () => {
    global.fetch = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const result = await postDiscordMessage("hi");
    expect(result.kind).toBe("failed");
  });
});
