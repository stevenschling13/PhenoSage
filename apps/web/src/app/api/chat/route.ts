import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession } from "@/lib/server/auth";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
  withRequestIdHeader,
} from "@/lib/server/request-id";

const MAX_MESSAGE_LENGTH = 2_000;
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface ChatRequestBody {
  threadId?: string;
  message?: string;
  growId?: string;
}

function frameEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

// POST /api/chat
// Streams NDJSON frames so clients can incrementally parse each line.
export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, session.user.id),
    limit: 15,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return attachRequestId(
      NextResponse.json(
        { error: "Too many chat requests. Try again shortly.", requestId },
        { status: 429 },
      ),
      requestId,
    );
  }

  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const message = body.message?.trim();

  if (!message) {
    return attachRequestId(
      NextResponse.json(
        { error: "message is required", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return attachRequestId(
      NextResponse.json(
        {
          error: `message must be <= ${MAX_MESSAGE_LENGTH} characters`,
          requestId,
        },
        { status: 400 },
      ),
      requestId,
    );
  }

  if (body.threadId && !THREAD_ID_PATTERN.test(body.threadId)) {
    return attachRequestId(
      NextResponse.json(
        { error: "threadId format is invalid", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const openai = getAIClient();

  const stream = openai.beta.chat.completions.stream({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are PhenoSage, a professional cannabis grow advisor. " +
          "You have access to the user's grow data and plant history. " +
          "Give precise, evidence-based advice. Be concise and professional.",
      },
      { role: "user", content: message },
    ],
    stream: true,
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(
              frameEvent({ type: "delta", content: delta, requestId }),
            );
          }
        }
        controller.enqueue(frameEvent({ type: "done", requestId }));
        controller.close();
      } catch (error) {
        const upstreamError =
          error instanceof Error ? error.message : "unknown_upstream_error";
        logServerEvent("error", "chat stream failed", {
          requestId,
          threadId: body.threadId,
          error: upstreamError,
        });
        controller.enqueue(
          frameEvent({
            type: "error",
            error: "upstream_model_failure",
            requestId,
          }),
        );
        controller.close();
      }
    },
  });

  return new NextResponse(readable, {
    headers: withRequestIdHeader(
      {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
      },
      requestId,
    ),
  });
}
