import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession } from "@/lib/server/auth";

// POST /api/chat
// Accepts a threadId + message, streams OpenAI response back.
// Context is injected server-side from the user's grow data.
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    threadId?: string;
    message: string;
    growId?: string;
  };

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
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
      { role: "user", content: body.message },
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
    },
  });
}
