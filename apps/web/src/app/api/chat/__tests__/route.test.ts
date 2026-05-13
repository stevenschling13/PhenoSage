import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const streamMock = vi.fn();
const loadGrowContextSummary = vi.fn();
const executeChatTool = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

const getAIClient = vi.fn();
vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: (...args: unknown[]) => getAIClient(...args),
}));

vi.mock("@/lib/server/chat-context", () => ({
  loadGrowContextSummary: (...args: unknown[]) =>
    loadGrowContextSummary(...args),
}));

vi.mock("@/lib/server/chat-tools", () => ({
  CHAT_TOOL_DEFINITIONS: [],
  executeChatTool: (...args: unknown[]) => executeChatTool(...args),
}));

const assertThreadOwner = vi.fn();
const createThread = vi.fn();
const appendMessage = vi.fn();
const touchThread = vi.fn();

vi.mock("@/lib/server/chat-persistence", () => ({
  assertThreadOwner: (...args: unknown[]) => assertThreadOwner(...args),
  createThread: (...args: unknown[]) => createThread(...args),
  appendMessage: (...args: unknown[]) => appendMessage(...args),
  touchThread: (...args: unknown[]) => touchThread(...args),
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

type Chunk = { choices: Array<{ delta: { content?: string } }> };

/** Simulates a streamed OpenAI completion that ends without tool_calls. */
function textOnlyStream(chunks: string[]) {
  const iter = {
    async *[Symbol.asyncIterator](): AsyncGenerator<Chunk> {
      for (const c of chunks) {
        yield { choices: [{ delta: { content: c } }] };
      }
      yield { choices: [{ delta: {} }] };
    },
    finalChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content: chunks.join(""), tool_calls: [] } }],
      }),
  };
  return iter;
}

/** Simulates a stream that yields tool_calls instead of text. */
function toolCallStream(
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>,
) {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Chunk> {
      // No text content streamed when the model is calling tools.
      yield { choices: [{ delta: {} }] };
    },
    finalChatCompletion: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: null,
              tool_calls: toolCalls.map((t) => ({
                id: t.id,
                type: "function" as const,
                function: { name: t.name, arguments: JSON.stringify(t.args) },
              })),
            },
          },
        ],
      }),
  };
}

/** Stream that throws mid-iteration to simulate an OpenAI failure. */
function failingStream() {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Chunk> {
      yield { choices: [{ delta: { content: "first " } }] };
      throw new Error("upstream model error: secret context here");
    },
    finalChatCompletion: () => Promise.reject(new Error("never")),
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    streamMock.mockReset();
    loadGrowContextSummary.mockReset();
    executeChatTool.mockReset();
    loadGrowContextSummary.mockResolvedValue(null);
    assertThreadOwner.mockReset();
    createThread.mockReset();
    appendMessage.mockReset();
    touchThread.mockReset();
    createThread.mockResolvedValue("thread_new");
    appendMessage.mockResolvedValue(undefined);
    touchThread.mockResolvedValue(undefined);
    getAIClient.mockReturnValue({
      chat: {
        completions: {
          stream: (...args: unknown[]) => streamMock(...args),
        },
      },
    });
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
    streamMock.mockImplementation(() => textOnlyStream([""]));

    for (let i = 0; i < 20; i++) {
      const ok = await POST(jsonRequest({ message: `m${i}` }));
      expect(ok.status).toBe(200);
      await ok.text();
    }

    const limited = await POST(jsonRequest({ message: "one too many" }));
    expect(limited.status).toBe(429);
  });

  it("uses a chat-namespaced rate-limit key so other routes' quotas are independent", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => textOnlyStream([""]));
    for (let i = 0; i < 20; i++) {
      const r = await POST(jsonRequest({ message: `m${i}` }));
      await r.text();
    }
    const exhausted = await POST(jsonRequest({ message: "blocked" }));
    expect(exhausted.status).toBe(429);

    const { rateLimit } = await import("@/lib/server/rate-limit");
    const otherRoute = await rateLimit({
      key: "u:u1",
      limit: 5,
      windowMs: 60_000,
    });
    expect(otherRoute.ok).toBe(true);
  });

  it("streams the OpenAI deltas back as text and forwards the system prompt + user message", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() =>
      textOnlyStream(["Hello, ", "world", "!"]),
    );

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(res.headers.get("x-request-id")).toBeTruthy();

    const text = await res.text();
    expect(text).toBe("Hello, world!");

    expect(streamMock).toHaveBeenCalledTimes(1);
    const args = streamMock.mock.calls[0]?.[0] as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.model).toBe("gpt-4o");
    expect(args.stream).toBe(true);
    // First two messages are the canonical system prompts; the user message
    // is appended last.
    expect(args.messages[0]?.role).toBe("system");
    expect(args.messages[1]?.role).toBe("system");
    expect(args.messages[args.messages.length - 1]).toEqual({
      role: "user",
      content: "hi",
    });
  });

  it("forwards client-supplied conversation history before the new user message", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => textOnlyStream(["ack"]));

    const history = [
      { role: "user", content: "I'm in week 3 of flower." },
      { role: "assistant", content: "Got it." },
    ];
    const res = await POST(jsonRequest({ message: "next steps?", history }));
    expect(res.status).toBe(200);
    await res.text();

    const args = streamMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const roles = args.messages.map((m) => m.role);
    // system, system, user, assistant, user(new)
    expect(roles.slice(0, 2)).toEqual(["system", "system"]);
    expect(args.messages[2]).toEqual({
      role: "user",
      content: "I'm in week 3 of flower.",
    });
    expect(args.messages[3]).toEqual({ role: "assistant", content: "Got it." });
    expect(args.messages[4]).toEqual({ role: "user", content: "next steps?" });
  });

  it("executes tool calls and loops until the model returns a final answer", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });

    // First call: model requests list_grows. Second call: model produces text.
    streamMock
      .mockImplementationOnce(() =>
        toolCallStream([
          { id: "call_1", name: "list_grows", args: { limit: 5 } },
        ]),
      )
      .mockImplementationOnce(() =>
        textOnlyStream(["Your veg grow looks healthy."]),
      );

    executeChatTool.mockResolvedValue({
      ok: true,
      data: [{ id: "g1", name: "Tent A", stage: "vegetative" }],
    });

    const res = await POST(
      jsonRequest({ message: "Anything to worry about?" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("Your veg grow looks healthy.");

    expect(executeChatTool).toHaveBeenCalledTimes(1);
    expect(executeChatTool).toHaveBeenCalledWith(
      "list_grows",
      { limit: 5 },
      expect.objectContaining({ userId: "u1" }),
    );

    // Second model call should include the tool result.
    expect(streamMock).toHaveBeenCalledTimes(2);
    const secondArgs = streamMock.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; tool_call_id?: string }>;
    };
    expect(
      secondArgs.messages.some(
        (m) => m.role === "tool" && m.tool_call_id === "call_1",
      ),
    ).toBe(true);
  });

  it("loads grow context when a growId is provided", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => textOnlyStream(["ok"]));
    loadGrowContextSummary.mockResolvedValue({
      growId: "g1",
      name: "Tent A",
      stage: "flower",
      medium: "coco",
      lightType: "led",
      startDate: "2026-04-01",
      daysSinceStart: 42,
      plantCount: 4,
      recentFindings: [],
    });

    const res = await POST(jsonRequest({ message: "status?", growId: "g1" }));
    expect(res.status).toBe(200);
    await res.text();

    expect(loadGrowContextSummary).toHaveBeenCalledWith("g1");
    const args = streamMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    // Second system message is the rendered grow context block.
    expect(args.messages[1]?.content).toContain("Tent A");
    expect(args.messages[1]?.content).toContain("flower");
  });

  it("renders a SANITISED inline error in the response body when the upstream fails mid-stream", async () => {
    // Regression: when controller.error() was used here, Vercel converted
    // the 200 streaming response into a bare 500 with empty body and the
    // chat client showed the generic "Request failed with 500.". We now
    // enqueue a human-readable note and close cleanly so the user gets a
    // useful inline explanation and a requestId for support.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => failingStream());

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/Something went wrong reaching the model/);
    expect(text).toMatch(/request /);
    // The upstream wording must never leak to the client envelope.
    expect(text).not.toMatch(/secret context here/);
  });

  it("classifies upstream 429 / quota failures with a specific user-facing message", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<Chunk> {
        const e = new Error("You exceeded your current quota");
        (e as Error & { status?: number }).status = 429;
        throw e;
      },
      finalChatCompletion: () => Promise.reject(new Error("never")),
    }));

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/rate-limited or out of quota/);
    // Must not echo OpenAI's specific wording verbatim.
    expect(text).not.toMatch(/You exceeded your current quota/);
  });

  it("creates a new thread, persists the user + assistant messages, and returns the thread id", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => textOnlyStream(["ans"]));
    createThread.mockResolvedValue("thread_abc");

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Thread-Id")).toBe("thread_abc");
    await res.text();

    expect(createThread).toHaveBeenCalledWith({
      userId: "u1",
      growId: null,
      firstUserMessage: "hi",
    });
    // user message is persisted before the stream, assistant after.
    expect(appendMessage).toHaveBeenCalledWith({
      threadId: "thread_abc",
      role: "user",
      content: "hi",
    });
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread_abc",
        role: "assistant",
        content: "ans",
      }),
    );
    expect(touchThread).toHaveBeenCalledWith("thread_abc");
  });

  it("reuses an existing thread when the user owns it", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockImplementation(() => textOnlyStream(["ok"]));
    assertThreadOwner.mockResolvedValue(true);

    const res = await POST(
      jsonRequest({ message: "follow up", threadId: "thread_existing" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Thread-Id")).toBe("thread_existing");
    await res.text();

    expect(assertThreadOwner).toHaveBeenCalledWith("thread_existing", "u1");
    expect(createThread).not.toHaveBeenCalled();
    expect(appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread_existing",
        role: "user",
      }),
    );
  });

  it("returns 404 when a threadId is supplied that the user does not own", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    assertThreadOwner.mockResolvedValue(false);

    const res = await POST(
      jsonRequest({ message: "sneaky", threadId: "thread_someone_else" }),
    );
    expect(res.status).toBe(404);
    expect(streamMock).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("returns a structured JSON 500 (not a bare 500) when prep throws synchronously", async () => {
    // Reproduces the production bug from PR #118 / the chat 500 in Vercel
    // logs: the synchronous throw used to propagate out of the route and
    // Next would render a bare 500 with an empty body, which the chat
    // client could not parse. The top-level catch must envelope it.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const internalErrorText = "internal-env-var-missing";
    createThread.mockImplementation(() => {
      throw new Error(internalErrorText);
    });

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { error?: string; requestId?: string };
    expect(body.error).toMatch(/Chat request failed/);
    expect(body.requestId).toBeTruthy();
    // The internal cause must NEVER leak to the client envelope.
    expect(body.error).not.toMatch(new RegExp(internalErrorText));
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("returns a structured JSON 500 when getAIClient throws after persistence", async () => {
    // appendMessage succeeds but getAIClient blows up (e.g. env var
    // missing). Without the top-level catch this produced a bare 500 in
    // production because the throw fired *after* appendMessage but
    // *before* the ReadableStream was returned.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    createThread.mockResolvedValue("thread_xyz");
    const internalErrorText = "openai-client-init-failed";
    getAIClient.mockImplementation(() => {
      throw new Error(internalErrorText);
    });

    const res = await POST(jsonRequest({ message: "hi" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Chat request failed/);
    expect(body.error).not.toMatch(new RegExp(internalErrorText));
  });
});
