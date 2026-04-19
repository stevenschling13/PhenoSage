import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { authorizeGrowAccess } from "@/lib/server/authorization";
import { correlationIdFromRequest, createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4o";
const MAX_MESSAGE_LEN = 4_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_CONTEXT_PLANTS = 8;
const MAX_CONTEXT_FINDINGS = 20;

interface ChatBody {
  message: unknown;
  threadId?: unknown;
  growId?: unknown;
}

interface GroundingContext {
  grow: {
    name: string;
    stage: string;
    medium: string;
    lightType: string;
    daysSinceStart: number | null;
  } | null;
  plants: Array<{
    id: string;
    name: string;
    strain: string | null;
    notes: string | null;
  }>;
  findings: Array<{
    plantName: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    recommendation: string | null;
    createdAt: string;
  }>;
}

/**
 * POST /api/chat
 *
 * Body: { message, threadId?, growId? }
 * - When `threadId` is provided, loads the existing thread (auth-checked) and
 *   appends this message as a new turn.
 * - When absent, creates a new thread bound to the user (and optional grow).
 * - When the thread has an associated `growId`, the route loads grow/plant/
 *   finding context from the DB and injects it into the system prompt.
 *
 * Returns: { threadId, message: ChatMessage }
 */
export async function POST(request: NextRequest) {
  const requestId = correlationIdFromRequest(request);
  const log = createLogger({ route: "api.chat", requestId });

  const user = await getServerUser();
  if (!user) return errJson("Unauthorized", 401, requestId);

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return errJson("Invalid JSON body", 400, requestId);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return errJson("message is required", 400, requestId);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return errJson("message is too long", 413, requestId);
  }

  const threadIdIn =
    typeof body.threadId === "string" && body.threadId.length > 0
      ? body.threadId
      : null;
  const growIdIn =
    typeof body.growId === "string" && body.growId.length > 0
      ? body.growId
      : null;

  const db = getDbClient();

  let threadId: string;
  let threadGrowId: string | null;

  if (threadIdIn) {
    const { data: thread, error } = await db
      .from("chat_threads")
      .select("id, user_id, grow_id")
      .eq("id", threadIdIn)
      .maybeSingle();
    if (error || !thread) return errJson("Thread not found", 404, requestId);
    if (thread.user_id !== user.id) {
      return errJson("Thread not found", 404, requestId);
    }
    threadId = thread.id as string;
    threadGrowId = (thread.grow_id as string | null) ?? null;
  } else {
    let boundGrowId: string | null = null;
    if (growIdIn) {
      const grow = await authorizeGrowAccess(user.id, growIdIn);
      if (!grow) return errJson("Grow not found", 404, requestId);
      boundGrowId = grow.growId;
    }
    const { data: created, error } = await db
      .from("chat_threads")
      .insert({
        user_id: user.id,
        grow_id: boundGrowId,
        title: truncate(message, 60),
      })
      .select("id, grow_id")
      .single();
    if (error || !created) {
      log.error("chat_threads insert failed", { error: error?.message });
      return errJson("Could not create thread", 500, requestId);
    }
    threadId = created.id as string;
    threadGrowId = (created.grow_id as string | null) ?? null;
  }

  const { error: userMsgErr } = await db.from("chat_messages").insert({
    thread_id: threadId,
    role: "user",
    content: message,
    metadata: { request_id: requestId },
  });
  if (userMsgErr) {
    log.error("chat_messages insert (user) failed", {
      threadId,
      error: userMsgErr.message,
    });
    return errJson("Could not save message", 500, requestId);
  }

  const history = await loadThreadHistory(threadId);
  const context = threadGrowId
    ? await loadGrounding(threadGrowId)
    : emptyContext();

  const systemPrompt = buildSystemPrompt(context);

  const openai = getAIClient();
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ],
      temperature: 0.4,
    });
  } catch (err) {
    log.error("openai chat completion failed", {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errJson("Assistant is unavailable", 502, requestId);
  }

  const assistantContent =
    completion.choices[0]?.message?.content?.trim() ??
    "I couldn't generate a response. Please try again.";

  const { data: savedAssistant, error: assistantErr } = await db
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "assistant",
      content: assistantContent,
      metadata: {
        model: completion.model,
        request_id: requestId,
        context: {
          grounded: Boolean(threadGrowId),
          plants: context.plants.length,
          findings: context.findings.length,
        },
      },
    })
    .select("id, role, content, created_at")
    .single();

  if (assistantErr || !savedAssistant) {
    log.error("chat_messages insert (assistant) failed", {
      threadId,
      error: assistantErr?.message,
    });
    return errJson("Could not save assistant reply", 500, requestId);
  }

  await db
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  log.info("chat turn complete", {
    threadId,
    grounded: Boolean(threadGrowId),
    contextPlants: context.plants.length,
    contextFindings: context.findings.length,
  });

  return NextResponse.json(
    {
      threadId,
      message: {
        id: savedAssistant.id,
        threadId,
        role: savedAssistant.role,
        content: savedAssistant.content,
        createdAt: savedAssistant.created_at,
      },
      requestId,
    },
    { status: 201, headers: { "x-request-id": requestId } },
  );
}

async function loadThreadHistory(
  threadId: string,
): Promise<Array<{ role: string; content: string }>> {
  const db = getDbClient();
  const { data } = await db
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);
  return (data ?? []).map((m) => ({
    role: m.role as string,
    content: m.content as string,
  }));
}

async function loadGrounding(growId: string): Promise<GroundingContext> {
  const db = getDbClient();

  const [growRes, plantsRes] = await Promise.all([
    db
      .from("grows")
      .select("name, stage, medium, light_type, start_date")
      .eq("id", growId)
      .maybeSingle(),
    db
      .from("plants")
      .select("id, name, strain, notes, is_archived, created_at")
      .eq("grow_id", growId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_PLANTS),
  ]);

  const plantRows = (plantsRes.data ?? []) as Array<{
    id: string;
    name: string;
    strain: string | null;
    notes: string | null;
  }>;

  let findings: GroundingContext["findings"] = [];
  if (plantRows.length > 0) {
    const plantIds = plantRows.map((p) => p.id);
    const { data: findingData } = await db
      .from("plant_findings")
      .select(
        "plant_id, category, severity, title, description, recommendation, created_at",
      )
      .in("plant_id", plantIds)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_FINDINGS);

    const nameById = new Map(plantRows.map((p) => [p.id, p.name]));
    findings = (findingData ?? []).map((f) => ({
      plantName: nameById.get(f.plant_id as string) ?? "Unknown plant",
      category: f.category as string,
      severity: f.severity as string,
      title: f.title as string,
      description: f.description as string,
      recommendation: (f.recommendation as string | null) ?? null,
      createdAt: f.created_at as string,
    }));
  }

  const grow = growRes.data as {
    name: string;
    stage: string;
    medium: string;
    light_type: string;
    start_date: string | null;
  } | null;

  return {
    grow: grow
      ? {
          name: grow.name,
          stage: grow.stage,
          medium: grow.medium,
          lightType: grow.light_type,
          daysSinceStart: grow.start_date
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(grow.start_date).getTime()) /
                    (24 * 60 * 60 * 1000),
                ),
              )
            : null,
        }
      : null,
    plants: plantRows.map((p) => ({
      id: p.id,
      name: p.name,
      strain: p.strain,
      notes: p.notes,
    })),
    findings,
  };
}

function buildSystemPrompt(ctx: GroundingContext): string {
  const header =
    "You are PhenoSage, a professional cannabis grow advisor. " +
    "Give precise, evidence-based, concise advice. If the grower's data does not " +
    "contain enough detail to answer a question, say so explicitly rather than " +
    "guessing. Never claim to see images or sensor data that were not provided.";

  if (!ctx.grow && ctx.plants.length === 0) {
    return (
      header +
      "\n\nThe grower has not linked a specific grow to this conversation, " +
      "so you only have their current message as context."
    );
  }

  const lines: string[] = [header, "", "# Grower context"];
  if (ctx.grow) {
    lines.push(
      `Grow "${ctx.grow.name}" — stage: ${ctx.grow.stage}, medium: ${ctx.grow.medium}, ` +
        `light: ${ctx.grow.lightType}` +
        (ctx.grow.daysSinceStart !== null
          ? `, day ${ctx.grow.daysSinceStart} since start`
          : ""),
    );
  }
  if (ctx.plants.length > 0) {
    lines.push("", "## Plants");
    for (const p of ctx.plants) {
      const parts = [`- ${p.name}`];
      if (p.strain) parts.push(`(${p.strain})`);
      if (p.notes) parts.push(`— ${truncate(p.notes, 200)}`);
      lines.push(parts.join(" "));
    }
  }
  if (ctx.findings.length > 0) {
    lines.push("", "## Recent unresolved findings");
    for (const f of ctx.findings) {
      const rec = f.recommendation
        ? ` Rec: ${truncate(f.recommendation, 160)}`
        : "";
      lines.push(
        `- [${f.severity}/${f.category}] ${f.plantName}: ${f.title} — ${truncate(
          f.description,
          200,
        )}.${rec}`,
      );
    }
  }
  return lines.join("\n");
}

function emptyContext(): GroundingContext {
  return { grow: null, plants: [], findings: [] };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function errJson(message: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}
