import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { __resetRateLimitStore } from "@/lib/server/rate-limit";

const getServerSession = vi.fn();
const streamMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    beta: {
      chat: {
        completions: {
          stream: (...args: unknown[]) => streamMock(...args),
        },
      },
    },
  }),
}));

import { POST } from "../route";

function jsonRequest(body: unknown, requestId = "req-1"): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

function fakeStream(chunks: string[]): AsyncIterable<{
  choices: Array<{ delta: { content?: string } }>;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        yield { choices: [{ delta: { content: c } }] };
      }
      yield { choices: [{ delta: {} }] };
    },
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    streamMock.mockReset();
    __resetRateLimitStore();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      requestId: "req-1",
    });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message is missing", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payload constraints", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });

    const badThread = await POST(
      jsonRequest({ message: "ok", threadId: "bad id" }),
    );
    expect(badThread.status).toBe(400);

    const tooLong = "x".repeat(2001);
    const badMessage = await POST(jsonRequest({ message: tooLong }));
    expect(badMessage.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream(["ok"]));

    for (let i = 0; i < 15; i++) {
      const res = await POST(
        jsonRequest({ message: `hello-${i}` }, `req-${i}`),
      );
      expect(res.status).toBe(200);
      await res.text();
    }

    const blocked = await POST(
      jsonRequest({ message: "blocked" }, "req-blocked"),
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: "Too many chat requests. Try again shortly.",
      requestId: "req-blocked",
    });
  });

  it("streams NDJSON deltas and done event", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream(["Hello, ", "world", "!"]));

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);

    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { type: "delta", content: "Hello, ", requestId: "req-1" },
      { type: "delta", content: "world", requestId: "req-1" },
      { type: "delta", content: "!", requestId: "req-1" },
      { type: "done", requestId: "req-1" },
    ]);
  });

  it("emits controlled error frame when upstream stream fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "partial" } }] };
        throw new Error("boom");
      },
    });

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);

    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { type: "delta", content: "partial", requestId: "req-1" },
      { type: "error", error: "upstream_model_failure", requestId: "req-1" },
    ]);
  });
});
