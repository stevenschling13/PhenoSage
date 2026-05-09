import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
  withRequestIdHeader,
} from "@/lib/server/request-id";

// Cap user prompts so a single request can't fan out into a 100kB context
// or push us over the model's input limit.
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_THREAD_ID_LENGTH = 64;
const MAX_GROW_ID_LENGTH = 64;

// POST /api/chat
// Accepts a threadId + message, streams OpenAI response back.
// Context is injected server-side from the user's grow data.
export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const user = await getServerUser();
  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 20,
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

  let body: { threadId?: string; message?: string; growId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return attachRequestId(
      NextResponse.json(
        { error: "Request body must be valid JSON.", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
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
          error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
          requestId,
        },
        { status: 413 },
      ),
      requestId,
    );
  }
  if (
    typeof body.threadId === "string" &&
    body.threadId.length > MAX_THREAD_ID_LENGTH
  ) {
    return attachRequestId(
      NextResponse.json(
        { error: "threadId is too long.", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }
  if (
    typeof body.growId === "string" &&
    body.growId.length > MAX_GROW_ID_LENGTH
  ) {
    return attachRequestId(
      NextResponse.json(
        { error: "growId is too long.", requestId },
        { status: 400 },
      ),
      requestId,
    );
  }

  const openai = getAIClient();

  // TODO: Load grow context from DB to inject as system context
  // TODO: Persist ChatThread + ChatMessage rows via Supabase service role

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

  // Stream the response. If OpenAI errors mid-stream we surface that to the
  // ReadableStream consumer (controller.error) so the browser fetch rejects
  // with a real error rather than silently truncating mid-reply.
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(new TextEncoder().encode(delta));
          }
        }
        controller.close();
      } catch (err) {
        logServerEvent("error", "chat stream failed", {
          requestId,
          userId: user?.id,
          error: err instanceof Error ? err.message : "unknown_error",
        });
        controller.error(err);
      }
    },
    cancel() {
      // Browser disconnected (user navigated away or hit Stop). Best-effort
      // upstream abort so we stop billing tokens we'll never deliver.
      try {
        (stream as { abort?: () => void }).abort?.();
      } catch {
        /* ignore */
      }
    },
  });

  return new NextResponse(readable, {
    headers: withRequestIdHeader(
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
      requestId,
    ),
  });
}
