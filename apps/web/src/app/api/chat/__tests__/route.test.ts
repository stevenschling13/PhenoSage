import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    beta: {
      chat: {
        completions: {
          stream: mocks.stream,
        },
      },
    },
  }),
}));

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://app.example.com/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

async function* chunks() {
  yield { choices: [{ delta: { content: "Healthy " } }] };
  yield { choices: [{ delta: {} }] };
  yield { choices: [{ delta: { content: "growth." } }] };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.stream.mockReturnValue(chunks());
  });

  it("requires an authenticated session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await POST(jsonRequest({ message: "hello" }));

    expect(res.status).toBe(401);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("validates non-empty messages", async () => {
    const res = await POST(jsonRequest({ message: "   " }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "message is required" });
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("streams OpenAI deltas as plain text", async () => {
    const res = await POST(jsonRequest({ threadId: "t1", message: "Help" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Help" }),
        ]),
        stream: true,
      }),
    );
    await expect(res.text()).resolves.toBe("Healthy growth.");
  });
});
