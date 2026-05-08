import { NextRequest, NextResponse } from "next/server";
import { chatRequestSchema } from "@phenosage/shared";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession } from "@/lib/server/auth";
import { attachRequestId, getOrCreateRequestId } from "@/lib/server/request-id";
import { parseJson } from "@/lib/server/validate";

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

  const parsed = await parseJson(request, chatRequestSchema, { requestId });
  if (!parsed.ok) return parsed.response;

  const openai = getAIClient();

  // TODO(phase 11): inject grow context retrieved via embeddings.
  // TODO(phase 11): persist ChatThread + ChatMessage rows via service role.

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
      { role: "user", content: parsed.data.message },
    ],
    stream: true,
  });

  // Return a streaming response compatible with Vercel Edge
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          controller.enqueue(new TextEncoder().encode(delta));
        }
      }
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "x-request-id": requestId,
    },
  });
}
