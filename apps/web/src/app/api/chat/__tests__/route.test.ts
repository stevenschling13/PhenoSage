import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const streamMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        stream: (...args: unknown[]) => streamMock(...args),
      },
    },
  }),
}));

import { __resetRateLimitStore } from "@/lib/server/rate-limit";
import { POST } from "../route";

function jsonRequest(body: unknown, init?: { rawBody?: string }): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: init?.rawBody ?? JSON.stringify(body),
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

/** Stream that throws mid-iteration to simulate an OpenAI failure. */
function failingStream(): AsyncIterable<{
  choices: Array<{ delta: { content?: string } }>;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: "first " } }] };
      throw new Error("upstream model error: secret context here");
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
    expect(await res.json()).toMatchObject({ error: "Unauthorized" });
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

  it("returns 400 when body is not valid JSON", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(jsonRequest(undefined, { rawBody: "{not-json" }));
    expect(res.status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 413 when message exceeds the length cap", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const oversized = "x".repeat(4_001);
    const res = await POST(jsonRequest({ message: oversized }));
    expect(res.status).toBe(413);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns 429 once the per-user limit is exhausted", async () => {
    getServerSession.mockResolvedValue({ user: { id: "spam" } });
    streamMock.mockReturnValue(fakeStream([""]));

    for (let i = 0; i < 20; i++) {
      const ok = await POST(jsonRequest({ message: `m${i}` }));
      expect(ok.status).toBe(200);
    }

    const limited = await POST(jsonRequest({ message: "one too many" }));
    expect(limited.status).toBe(429);
  });

  it("uses a chat-namespaced rate-limit key so other routes' quotas are independent", async () => {
    // Drive the chat limit to exhaustion for u1.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream([""]));
    for (let i = 0; i < 20; i++) {
      await POST(jsonRequest({ message: `m${i}` }));
    }
    const exhausted = await POST(jsonRequest({ message: "blocked" }));
    expect(exhausted.status).toBe(429);

    // A non-chat caller using the bare `u:u1` key should still be
    // unaffected — the chat bucket is namespaced.
    const { rateLimit } = await import("@/lib/server/rate-limit");
    const otherRoute = await rateLimit({
      key: "u:u1",
      limit: 5,
      windowMs: 60_000,
    });
    expect(otherRoute.ok).toBe(true);
  });

  it("streams the OpenAI deltas back as text", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream(["Hello, ", "world", "!"]));

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(res.headers.get("x-request-id")).toBeTruthy();

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

  it("surfaces a SANITISED error to the client when the upstream fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(failingStream());

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    // The client gets a generic message + the request id for support
    // correlation. The upstream wording must not leak.
    let caught: unknown = null;
    try {
      await res.text();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toMatch(/Chat stream failed \(request /);
    expect(message).not.toMatch(/secret context here/);
  });

  it("returns a structured JSON 500 when getServerSession throws synchronously", async () => {
    // Mirrors what happens in production when Supabase env is misconfigured
    // or the auth service is unreachable. The client must receive a
    // parseable JSON body with a requestId for support correlation — not
    // a bare 500 (which is what surfaced as "Request failed with 500.").
    (getServerSession as Mock).mockRejectedValueOnce(
      new Error("supabase env not set"),
    );

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { error: string; requestId: string };
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(body.requestId).toBeTruthy();
    // The underlying error message must NOT leak to the client.
    expect(JSON.stringify(body)).not.toMatch(/supabase env not set/);
    // The upstream OpenAI client must never be touched.
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns a structured JSON 500 when the OpenAI client throws synchronously", async () => {
    // Mirrors a missing OPENAI_API_KEY: getAIClient() throws synchronously.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementationOnce(() => {
      throw new Error("Missing OPENAI_API_KEY");
    });

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { error: string; requestId: string };
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(body)).not.toMatch(/OPENAI_API_KEY/);
  });
});
