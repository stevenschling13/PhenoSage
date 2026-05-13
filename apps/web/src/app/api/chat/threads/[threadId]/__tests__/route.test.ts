import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getThreadMessages = vi.fn();
const deleteThreadForUser = vi.fn();
const renameThreadForUser = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@/lib/server/chat-persistence", () => ({
  getThreadMessages: (...args: unknown[]) => getThreadMessages(...args),
  deleteThreadForUser: (...args: unknown[]) => deleteThreadForUser(...args),
  renameThreadForUser: (...args: unknown[]) => renameThreadForUser(...args),
}));

import { DELETE, GET, PATCH } from "../route";

function buildRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/chat/threads/t1", {
    method,
    ...(body !== undefined && {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  });
}

function makeRouteParams(threadId: string) {
  return { params: Promise.resolve({ threadId }) };
}

describe("GET /api/chat/threads/[threadId]", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    getThreadMessages.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(buildRequest("GET"), makeRouteParams("t1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the thread is missing (RLS or non-existent)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getThreadMessages.mockResolvedValue(null);
    const res = await GET(buildRequest("GET"), makeRouteParams("t1"));
    expect(res.status).toBe(404);
  });

  it("returns messages on success", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getThreadMessages.mockResolvedValue([
      {
        id: "m1",
        threadId: "t1",
        role: "user",
        content: "hi",
        createdAt: "2026-05-01",
      },
    ]);
    const res = await GET(buildRequest("GET"), makeRouteParams("t1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<{ id: string }> };
    expect(body.messages).toHaveLength(1);
  });

  it("returns 400 for empty threadId", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await GET(buildRequest("GET"), makeRouteParams(""));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/chat/threads/[threadId]", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    deleteThreadForUser.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await DELETE(buildRequest("DELETE"), makeRouteParams("t1"));
    expect(res.status).toBe(401);
    expect(deleteThreadForUser).not.toHaveBeenCalled();
  });

  it("deletes the thread", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    deleteThreadForUser.mockResolvedValue(true);
    const res = await DELETE(buildRequest("DELETE"), makeRouteParams("t1"));
    expect(res.status).toBe(200);
    expect(deleteThreadForUser).toHaveBeenCalledWith("t1");
  });

  it("returns 500 when the delete fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    deleteThreadForUser.mockResolvedValue(false);
    const res = await DELETE(buildRequest("DELETE"), makeRouteParams("t1"));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/chat/threads/[threadId]", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    renameThreadForUser.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await PATCH(
      buildRequest("PATCH", { title: "x" }),
      makeRouteParams("t1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the title is empty", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await PATCH(
      buildRequest("PATCH", { title: "   " }),
      makeRouteParams("t1"),
    );
    expect(res.status).toBe(400);
    expect(renameThreadForUser).not.toHaveBeenCalled();
  });

  it("renames the thread", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    renameThreadForUser.mockResolvedValue(true);
    const res = await PATCH(
      buildRequest("PATCH", { title: "New title" }),
      makeRouteParams("t1"),
    );
    expect(res.status).toBe(200);
    expect(renameThreadForUser).toHaveBeenCalledWith("t1", "New title");
  });
});
