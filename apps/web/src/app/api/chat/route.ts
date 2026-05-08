import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerSession } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import type { ChatGenerationStatus } from "@phenosage/shared";

function buildGenerationMetadata(
  status: ChatGenerationStatus,
  extra?: Record<string, unknown>,
) {
  return { generationStatus: status, ...extra };
}

async function getGrowContext(
  userId: string,
  growId?: string,
): Promise<string> {
  if (!growId) return "No grow selected for this thread.";

  const db = getDbClient();
  const [findingsRes, eventsRes] = await Promise.all([
    db
      .from("plant_findings")
      .select("title, severity, category, created_at")
      .eq("grow_id", growId)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("grow_events")
      .select("event_type, notes, occurred_at")
      .eq("grow_id", growId)
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  if (findingsRes.error || eventsRes.error) {
    return `Grow context unavailable for user ${userId}. Treat guidance as inconclusive if precision is required.`;
  }

  const findings = (findingsRes.data ?? [])
    .map((f) => `- ${f.created_at}: [${f.severity}/${f.category}] ${f.title}`)
    .join("\n");
  const timeline = (eventsRes.data ?? [])
    .map(
      (e) =>
        `- ${e.occurred_at}: ${e.event_type}${e.notes ? ` (${e.notes})` : ""}`,
    )
    .join("\n");

  return [
    `Grow context for grow ${growId}:`,
    findings ? `Recent findings:\n${findings}` : "Recent findings: none.",
    timeline
      ? `Plant timeline:\n${timeline}`
      : "Plant timeline: no recent entries.",
  ].join("\n\n");
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    threadId?: string;
    message?: string;
    growId?: string;
  };
  const message = body.message?.trim();
  if (!message)
    return NextResponse.json({ error: "message is required" }, { status: 400 });

  const db = getDbClient();
  const userId = session.user.id;
  const threadId = body.threadId;

  const threadRes = threadId
    ? await db
        .from("chat_threads")
        .select("id")
        .eq("id", threadId)
        .eq("user_id", userId)
        .maybeSingle()
    : await db
        .from("chat_threads")
        .insert({ user_id: userId, grow_id: body.growId ?? null })
        .select("id")
        .single();

  if (threadRes.error || !threadRes.data) {
    return NextResponse.json(
      { error: "Unable to resolve chat thread" },
      { status: 500 },
    );
  }

  const resolvedThreadId = threadRes.data.id;

  await db.from("chat_messages").insert({
    thread_id: resolvedThreadId,
    role: "user",
    content: message,
    metadata: buildGenerationMetadata("started"),
  });

  const growContext = await getGrowContext(userId, body.growId);
  const openai = getAIClient();

  const stream = openai.beta.chat.completions.stream({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are PhenoSage, a professional cannabis grow advisor. " +
          "Ground every answer in provided grow context and explicitly call out uncertainty.",
      },
      {
        role: "developer",
        content: `Use this authenticated grow context:\n\n${growContext}`,
      },
      { role: "user", content: message },
    ],
    stream: true,
  });

  let assistantText = "";
  let finalStatus: ChatGenerationStatus = "succeeded";
  let failureReason: string | undefined;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            assistantText += delta;
            controller.enqueue(new TextEncoder().encode(delta));
          }
        }
        if (!assistantText.trim()) {
          finalStatus = "inconclusive";
          failureReason = "empty_model_output";
        }
      } catch (error) {
        finalStatus = "failed";
        failureReason = error instanceof Error ? error.name : "stream_error";
      } finally {
        await db.from("chat_messages").insert({
          thread_id: resolvedThreadId,
          role: "assistant",
          content:
            assistantText || "Inconclusive: no assistant output generated.",
          metadata: buildGenerationMetadata(finalStatus, {
            failureReason,
            growId: body.growId ?? null,
          }),
        });
        controller.close();
      }
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Chat-Thread-Id": resolvedThreadId,
      "X-Chat-Generation-Status": finalStatus,
    },
  });
}
