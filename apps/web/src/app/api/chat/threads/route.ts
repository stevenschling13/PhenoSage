import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { listThreadsForUser } from "@/lib/server/chat-persistence";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

// GET /api/chat/threads
// Returns the authenticated user's chat threads, most-recently-updated first.
export async function GET(request: NextRequest) {
  let requestId: string;
  try {
    requestId = getOrCreateRequestId(request);
  } catch {
    requestId = "unknown";
  }

  try {
    const session = await getServerSession();
    if (!session) {
      return attachRequestId(
        NextResponse.json(
          { error: "Unauthorized", requestId },
          { status: 401 },
        ),
        requestId,
      );
    }

    const userId = session.user?.id ?? null;
    const rate = await rateLimit({
      key: `chat-threads:${rateLimitKeyFromRequest(request, userId)}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return attachRequestId(
        NextResponse.json(
          {
            error: "Too many chat-thread requests. Try again shortly.",
            requestId,
          },
          { status: 429 },
        ),
        requestId,
      );
    }

    const threads = await listThreadsForUser();
    return attachRequestId(
      NextResponse.json({ threads, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "chat threads list route failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return attachRequestId(
      NextResponse.json(
        { error: "Failed to load chat threads", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }
}
