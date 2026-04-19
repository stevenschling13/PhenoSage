import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// POST /api/chat
// Accepts a messages array, streams OpenAI response back using Vercel AI SDK.
// Context is injected server-side from the user's grow data.
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages } = await request.json();

  if (!messages) {
    return NextResponse.json(
      { error: "messages are required" },
      { status: 400 },
    );
  }

  // TODO: Load grow context from DB to inject as system context
  // TODO: Persist ChatThread + ChatMessage rows via Supabase service role

  const result = await streamText({
    model: openai("gpt-4o"),
    system:
      "You are PhenoSage, a professional cannabis grow advisor. " +
      "You have access to the user's grow data and plant history. " +
      "Give precise, evidence-based advice. Be concise and professional.",
    messages,
  });

  return result.toTextStreamResponse();
}
