import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "@phenosage/shared";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { appendChatMessage, getOrCreateThread } from "@/lib/server/chat";
import { getDbClient } from "@/lib/server/db";
import { getOrCreateRequestId } from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

// POST /api/chat
// Accepts a threadId + message, streams OpenAI response back.
// Context is injected server-side from the user's grow data.
export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }
  const user = await getServerUser();
  if (!user) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const parsedBody = await parseJsonBody(request, ChatRequestSchema);
  if (!parsedBody.ok) {
    return apiError(
      parsedBody.status,
      "BAD_REQUEST",
      parsedBody.error,
      requestId,
    );
  }
  const body = parsedBody.data;

  const db = getDbClient();
  if (body.growId) {
    const { data: grow } = await db
      .from("grow_collaborators")
      .select("grow_id")
      .eq("grow_id", body.growId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!grow) {
      return apiError(
        403,
        "FORBIDDEN",
        "You do not have access to this grow",
        requestId,
      );
    }
  }

  const openai = getAIClient();
  const thread = await getOrCreateThread({
    userId: user.id,
    ...(body.threadId ? { threadId: body.threadId } : {}),
    ...(body.growId ? { growId: body.growId } : {}),
    title: body.message.slice(0, 80),
  });
  if (!thread)
    return apiError(404, "NOT_FOUND", "Chat thread not found", requestId);
  await appendChatMessage({
    threadId: thread.id,
    role: "user",
    content: body.message,
  });

  let contextNote = "No explicit grow context loaded.";
  if (body.growId) {
    const { data: plants } = await db
      .from("plants")
      .select("name")
      .eq("grow_id", body.growId)
      .limit(5);
    contextNote = `Grow scoped request. Plants in scope: ${(plants ?? []).map((p) => p.name).join(", ") || "none"}.`;
  }

  const stream = openai.beta.chat.completions.stream({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are PhenoSage, a professional cannabis grow advisor. " +
          `Available context: ${contextNote} ` +
          "Give precise, evidence-based advice. Be concise and professional.",
      },
      { role: "user", content: body.message },
    ],
    stream: true,
  });

  // Return a streaming response compatible with Vercel Edge
  const readable = new ReadableStream({
    async start(controller) {
      let transcript = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          transcript += delta;
          controller.enqueue(new TextEncoder().encode(delta));
        }
      }
      if (transcript.trim()) {
        await appendChatMessage({
          threadId: thread.id,
          role: "assistant",
          content: transcript,
          metadata: { model: "gpt-4o" },
        });
      }
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "x-chat-thread-id": thread.id,
    },
  });
}
