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

const USER_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "22222222-2222-2222-2222-222222222222";
const GROW_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_GROW_ID = "44444444-4444-4444-4444-444444444444";

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
    getServerUser.mockResolvedValue({ id: USER_ID });
    const res = await POST(
      req({ message: "" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("loads the newest thread messages in descending order and replays them oldest-first", async () => {
    getServerUser.mockResolvedValue({ id: USER_ID });

    const threadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: THREAD_ID, user_id: USER_ID, grow_id: null },
            error: null,
          }),
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
      limit: vi.fn().mockResolvedValue({
        data: [
          { role: "user", content: "newest user message" },
          { role: "assistant", content: "older assistant reply" },
        ],
        error: null,
      }),
    };

    let messageInsertCalls = 0;
    tableHandlers["chat_threads"] = () => ({
      select: threadSelect,
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
      req({
        message: "hey",
        threadId: THREAD_ID,
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      threadId: string;
      message: { role: string; content: string };
    };
    expect(body.threadId).toBe(THREAD_ID);
    expect(body.message.content).toBe("hello there");
    expect(historyBuilder.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(openaiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        messages: [
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({
            role: "assistant",
            content: "older assistant reply",
          }),
          expect.objectContaining({
            role: "user",
            content: "newest user message",
          }),
        ],
      }),
    );
  });

  it("returns 404 when threadId does not belong to the user", async () => {
    getServerUser.mockResolvedValue({ id: USER_ID });

    const threadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    });
    tableHandlers["chat_threads"] = () => ({ select: threadSelect });

    const res = await POST(
      req({
        message: "hey",
        threadId: THREAD_ID,
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(404);
  });

  it("rejects a growId override on an existing thread", async () => {
    getServerUser.mockResolvedValue({ id: USER_ID });

    const threadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: THREAD_ID, user_id: USER_ID, grow_id: GROW_ID },
            error: null,
          }),
        }),
      }),
    });
    tableHandlers["chat_threads"] = () => ({ select: threadSelect });

    const res = await POST(
      req({
        message: "hey",
        threadId: THREAD_ID,
        growId: OTHER_GROW_ID,
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("returns 502 when the OpenAI call fails", async () => {
    getServerUser.mockResolvedValue({ id: USER_ID });

    tableHandlers["chat_threads"] = () => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: THREAD_ID, grow_id: null },
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
