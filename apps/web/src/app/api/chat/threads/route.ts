import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { listThreadsForUser } from "@/lib/server/chat-persistence";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

// GET /api/chat/threads
// Returns the authenticated user's chat threads, most-recently-updated first.
export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  try {
    const threads = await listThreadsForUser();
    return attachRequestId(
      NextResponse.json({ threads, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "chat threads list route failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown_error",
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
