import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const streamMock = vi.fn();
const dbMock = {
  from: vi.fn(),
};

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    beta: {
      chat: {
        completions: { stream: (...args: unknown[]) => streamMock(...args) },
      },
    },
  }),
}));
vi.mock("@/lib/server/db", () => ({ getDbClient: () => dbMock }));

import { POST } from "../route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function fakeStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
    },
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    streamMock.mockReset();
    dbMock.from.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({ message: "hello" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when message is missing", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("streams and persists user + assistant messages", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    streamMock.mockReturnValue(fakeStream(["Hello"]));

    const insert = vi
      .fn()
      .mockResolvedValue({ error: null, data: [{ id: "m1" }] });
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ error: null, data: { id: "t1" } });
    const single = vi
      .fn()
      .mockResolvedValue({ error: null, data: { id: "t1" } });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi
      .fn()
      .mockReturnValue({
        eq: eq2,
        order: vi
          .fn()
          .mockReturnValue({
            limit: vi.fn().mockResolvedValue({ error: null, data: [] }),
          }),
      });
    dbMock.from.mockImplementation((table: string) => {
      if (table === "chat_threads")
        return {
          select: vi.fn().mockReturnValue({ eq: eq1 }),
          insert: vi
            .fn()
            .mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
        };
      if (table === "chat_messages") return { insert };
      return {
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ error: null, data: [] }),
                  }),
              }),
          }),
      };
    });

    const res = await POST(
      jsonRequest({ message: "hi", threadId: "t1", growId: "g1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello");
    expect(insert).toHaveBeenCalled();
  });
});
