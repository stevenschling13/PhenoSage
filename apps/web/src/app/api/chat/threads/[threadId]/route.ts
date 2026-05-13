import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import {
  deleteThreadForUser,
  getThreadMessages,
  renameThreadForUser,
} from "@/lib/server/chat-persistence";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

const MAX_THREAD_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;

function validateThreadId(threadId: string): boolean {
  return threadId.length > 0 && threadId.length <= MAX_THREAD_ID_LENGTH;
}

// GET /api/chat/threads/[threadId]
// Returns the messages for the thread (RLS-gated to the thread owner).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const { threadId } = await params;
  if (!validateThreadId(threadId)) {
    return attachRequestId(
      NextResponse.json(
        { error: "Invalid thread id", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  try {
    const messages = await getThreadMessages(threadId);
    if (messages === null) {
      return attachRequestId(
        NextResponse.json(
          { error: "Thread not found", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }
    return attachRequestId(
      NextResponse.json({ threadId, messages, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "chat thread messages route failed", {
      requestId,
      threadId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        { error: "Failed to load thread", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }
}

// DELETE /api/chat/threads/[threadId]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const { threadId } = await params;
  if (!validateThreadId(threadId)) {
    return attachRequestId(
      NextResponse.json(
        { error: "Invalid thread id", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const ok = await deleteThreadForUser(threadId);
  if (!ok) {
    return attachRequestId(
      NextResponse.json(
        { error: "Failed to delete thread", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }
  return attachRequestId(NextResponse.json({ ok: true, requestId }), requestId);
}

// PATCH /api/chat/threads/[threadId]  — rename
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const { threadId } = await params;
  if (!validateThreadId(threadId)) {
    return attachRequestId(
      NextResponse.json(
        { error: "Invalid thread id", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  let body: { title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return attachRequestId(
      NextResponse.json(
        { error: "Request body must be valid JSON", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const title = typeof body.title === "string" ? body.title : "";
  if (!title.trim() || title.length > MAX_TITLE_LENGTH) {
    return attachRequestId(
      NextResponse.json(
        { error: "title must be 1..200 chars", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const ok = await renameThreadForUser(threadId, title);
  if (!ok) {
    return attachRequestId(
      NextResponse.json(
        { error: "Failed to rename thread", requestId },
        { status: 500 },
      ),
      requestId,
    );
  }
  return attachRequestId(NextResponse.json({ ok: true, requestId }), requestId);
}
