import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

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

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Minimal async iterator simulating an OpenAI streaming response. */
function fakeStream(chunks: string[]): AsyncIterable<{
  choices: Array<{ delta: { content?: string } }>;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        yield { choices: [{ delta: { content: c } }] };
      }
      // Include a chunk with no delta to exercise the falsy branch.
      yield { choices: [{ delta: {} }] };
    },
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    streamMock.mockReset();
  });

  it("returns 401 with requestId when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; requestId?: string };
    expect(body.error).toBe("Unauthorized");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId?.length).toBeGreaterThan(0);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message is missing", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message is whitespace-only", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(jsonRequest({ message: "   " }));
    expect(res.status).toBe(400);
  });

  it("streams the OpenAI deltas back as text", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream(["Hello, ", "world", "!"]));

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);

    const text = await res.text();
    expect(text).toBe("Hello, world!");

    // The system prompt + user message were forwarded to OpenAI.
    expect(streamMock).toHaveBeenCalledTimes(1);
    const args = streamMock.mock.calls[0]?.[0] as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.model).toBe("gpt-4o");
    expect(args.stream).toBe(true);
    expect(args.messages[0]?.role).toBe("system");
    expect(args.messages[args.messages.length - 1]).toEqual({
      role: "user",
      content: "hi",
    });
  });
});
