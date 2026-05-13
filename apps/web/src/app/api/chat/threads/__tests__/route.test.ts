import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const listThreadsForUser = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

vi.mock("@/lib/server/chat-persistence", () => ({
  listThreadsForUser: (...args: unknown[]) => listThreadsForUser(...args),
}));

import { GET } from "../route";

function getRequest(): NextRequest {
  return new NextRequest("http://localhost/api/chat/threads");
}

describe("GET /api/chat/threads", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    listThreadsForUser.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(listThreadsForUser).not.toHaveBeenCalled();
  });

  it("returns the user's threads", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    listThreadsForUser.mockResolvedValue([
      {
        id: "t1",
        userId: "u1",
        growId: null,
        title: "First chat",
        createdAt: "2026-05-01",
        updatedAt: "2026-05-02",
      },
    ]);

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{ id: string; title: string }>;
    };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]?.id).toBe("t1");
  });

  it("returns 500 when the lookup throws", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    listThreadsForUser.mockRejectedValue(new Error("supabase down"));

    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});
