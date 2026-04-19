import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { getServerUser, authorizeGrowAccess, openaiCreate, tableHandlers } =
  vi.hoisted(() => ({
    getServerUser: vi.fn(),
    authorizeGrowAccess: vi.fn(),
    openaiCreate: vi.fn(),
    tableHandlers: {} as Record<string, () => unknown>,
  }));

vi.mock("@/lib/server/auth", () => ({
  getServerUser,
  getServerSession: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/server/authorization", () => ({
  authorizeGrowAccess,
  authorizePlantAccess: vi.fn(),
}));
vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        create: openaiCreate,
      },
    },
  }),
}));

vi.mock("@/lib/server/db", () => ({
  getDbClient: () => ({
    from: (name: string) => {
      const handler = tableHandlers[name];
      if (!handler) throw new Error(`Unmocked table: ${name}`);
      return handler();
    },
  }),
}));

import { POST } from "../route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(tableHandlers)) delete tableHandlers[k];
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerUser.mockResolvedValue(null);
    const res = await POST(
      req({ message: "hi" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when message missing", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    const res = await POST(
      req({ message: "" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("creates a thread, persists messages, and returns the assistant reply", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });

    const threadInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "t1", grow_id: null },
          error: null,
        }),
      }),
    });
    const threadUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const userMsgInsert = vi.fn().mockResolvedValue({ error: null });
    const assistantMsgInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "m-assistant",
            role: "assistant",
            content: "hello there",
            created_at: "2026-04-19T00:00:00Z",
          },
          error: null,
        }),
      }),
    });

    const historyBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    let messageInsertCalls = 0;
    tableHandlers["chat_threads"] = () => ({
      insert: threadInsert,
      update: threadUpdate,
    });
    tableHandlers["chat_messages"] = () => {
      messageInsertCalls += 1;
      if (messageInsertCalls === 1) {
        return { insert: userMsgInsert };
      }
      if (messageInsertCalls === 2) {
        return historyBuilder;
      }
      return { insert: assistantMsgInsert };
    };

    openaiCreate.mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: "hello there" } }],
    });

    const res = await POST(
      req({ message: "hey" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      threadId: string;
      message: { role: string; content: string };
    };
    expect(body.threadId).toBe("t1");
    expect(body.message.content).toBe("hello there");
    expect(threadInsert).toHaveBeenCalled();
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
        ]),
      }),
    );
  });

  it("returns 404 when threadId does not belong to the user", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });

    const threadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "t-other", user_id: "u2", grow_id: null },
          error: null,
        }),
      }),
    });
    tableHandlers["chat_threads"] = () => ({ select: threadSelect });

    const res = await POST(
      req({
        message: "hey",
        threadId: "t-other",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(404);
  });

  it("returns 502 when the OpenAI call fails", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });

    tableHandlers["chat_threads"] = () => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "t2", grow_id: null },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });

    let call = 0;
    tableHandlers["chat_messages"] = () => {
      call += 1;
      if (call === 1)
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    };

    openaiCreate.mockRejectedValue(new Error("openai timeout"));

    const res = await POST(
      req({ message: "hey" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(502);
  });
});
