import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/server/ai-client";
import { getDbClient } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function summarizePrompt(
  growName: string,
  events: Array<{
    event_type: string;
    notes: string | null;
    occurred_at: string;
  }>,
  findings: Array<{ title: string; severity: string; created_at: string }>,
): string {
  return [
    `Grow: ${growName}`,
    "Recent timeline events:",
    ...events.map(
      (e) =>
        `- ${e.occurred_at} ${e.event_type}${e.notes ? ` (${e.notes})` : ""}`,
    ),
    "Recent findings:",
    ...findings.map((f) => `- ${f.created_at} [${f.severity}] ${f.title}`),
    "Write a concise daily operational summary with risks and next steps.",
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env["CRON_SECRET"];

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDbClient();
  const ai = getAIClient();

  const growsRes = await db
    .from("grows")
    .select("id, owner_id, name")
    .eq("is_archived", false);
  if (growsRes.error) {
    return NextResponse.json(
      { error: "Failed to fetch grows" },
      { status: 500 },
    );
  }

  const processed: Array<{ growId: string; status: string }> = [];

  for (const grow of growsRes.data ?? []) {
    const [eventsRes, findingsRes] = await Promise.all([
      db
        .from("grow_events")
        .select("event_type, notes, occurred_at")
        .eq("grow_id", grow.id)
        .order("occurred_at", { ascending: false })
        .limit(12),
      db
        .from("plant_findings")
        .select("title, severity, created_at")
        .eq("grow_id", grow.id)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    if (eventsRes.error || findingsRes.error) {
      processed.push({ growId: grow.id, status: "failed" });
      continue;
    }

    const prompt = summarizePrompt(
      grow.name,
      eventsRes.data ?? [],
      findingsRes.data ?? [],
    );

    let summary = "Inconclusive: no summary generated.";
    let status = "inconclusive";
    try {
      const completion = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an operations copilot for cannabis growers. Avoid overclaiming.",
          },
          { role: "user", content: prompt },
        ],
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (content) {
        summary = content;
        status = "succeeded";
      }
    } catch {
      status = "failed";
    }

    await db.from("grow_events").insert({
      grow_id: grow.id,
      user_id: grow.owner_id,
      event_type: "observation",
      notes: `[daily-summary:${status}] ${summary}`,
      occurred_at: new Date().toISOString(),
    });

    // Notification enqueue placeholder persisted as an event until notification table exists.
    await db.from("grow_events").insert({
      grow_id: grow.id,
      user_id: grow.owner_id,
      event_type: "note",
      notes: `[notification-queued] Daily summary ready with status=${status}`,
      occurred_at: new Date().toISOString(),
    });

    processed.push({ growId: grow.id, status });
  }

  return NextResponse.json({
    status: "ok",
    ran: new Date().toISOString(),
    processed,
  });
}
