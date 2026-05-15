import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAIClient } from "./ai-client";
import { logServerEvent } from "./request-id";

// Per-user activity snapshot used to build a daily digest. All counts
// are restricted to the last 24h. `grows` carries enough identity
// info to name grows in the AI prompt without a second query.
export interface DailyDigestSnapshot {
  userId: string;
  grows: {
    id: string;
    name: string;
    stage: string | null;
  }[];
  newFindings: {
    id: string;
    title: string;
    severity: string;
    growId: string;
    plantId: string;
  }[];
  newImages: number;
  newObservations: number;
  newTasks: number;
  resolvedFindings: number;
}

// Window the cron summarizes. 24h is the obvious default; surfacing
// this constant makes it easy to swap to "since last digest" later
// if read receipts get richer.
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const TARGET_USERS_LIMIT = 500; // safety cap so a runaway cron can't bill out.

// Tokens-per-digest cap. Gemini Pro models routinely fit a 4-grow
// digest in 500-700 tokens; 1.2k gives generous headroom without
// exposing us to runaway prompts.
const DIGEST_MAX_OUTPUT_TOKENS = 1_200;

// Identify users who own (or are members of) at least one active grow
// so we don't waste AI calls on dormant accounts. Returns
// distinct user ids ordered by most recent grow activity.
export async function listUsersWithActiveGrows(
  supabase: SupabaseClient,
  limit = TARGET_USERS_LIMIT,
): Promise<string[]> {
  const owners = await supabase
    .from("grows")
    .select("owner_id")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const members = await supabase
    .from("grow_members")
    .select("user_id")
    .limit(limit);

  if (owners.error) {
    logServerEvent("error", "daily digest: list owners failed", {
      error: owners.error.message,
    });
  }
  if (members.error) {
    logServerEvent("error", "daily digest: list members failed", {
      error: members.error.message,
    });
  }

  const ids = new Set<string>();
  for (const row of owners.data ?? []) ids.add(row.owner_id);
  for (const row of members.data ?? []) ids.add(row.user_id);
  return Array.from(ids).slice(0, limit);
}

// Aggregate the last-24h activity for a single user. Uses Promise.all
// so a slow side-table (e.g. plant_findings) doesn't serialize the
// whole digest build. Each individual query is best-effort: a single
// failure degrades to empty for that section rather than aborting.
export async function buildDigestSnapshot(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<DailyDigestSnapshot> {
  const sinceIso = new Date(now.getTime() - ACTIVITY_WINDOW_MS).toISOString();

  const growsResult = await supabase
    .from("grows")
    .select("id,name,stage")
    .eq("owner_id", userId)
    .eq("is_archived", false);

  if (growsResult.error) {
    logServerEvent("error", "daily digest: grows query failed", {
      error: growsResult.error.message,
      userId,
    });
  }
  const grows = (growsResult.data ?? []) as DailyDigestSnapshot["grows"];
  const growIds = grows.map((g) => g.id);

  if (growIds.length === 0) {
    return {
      userId,
      grows: [],
      newFindings: [],
      newImages: 0,
      newObservations: 0,
      newTasks: 0,
      resolvedFindings: 0,
    };
  }

  const [findings, images, observations, tasks, resolved] = await Promise.all([
    supabase
      .from("plant_findings")
      .select("id,title,severity,grow_id,plant_id")
      .in("grow_id", growIds)
      .gte("created_at", sinceIso)
      .limit(50),
    supabase
      .from("plant_images")
      .select("id", { count: "exact", head: true })
      .in("grow_id", growIds)
      .gte("created_at", sinceIso),
    supabase
      .from("plant_observations")
      .select("id", { count: "exact", head: true })
      .in("plant_id", await listPlantIdsFor(supabase, growIds))
      .gte("observed_at", sinceIso),
    supabase
      .from("grow_tasks")
      .select("id", { count: "exact", head: true })
      .in("grow_id", growIds)
      .gte("created_at", sinceIso),
    supabase
      .from("plant_findings")
      .select("id", { count: "exact", head: true })
      .in("grow_id", growIds)
      .gte("resolved_at", sinceIso)
      .not("resolved_at", "is", null),
  ]);

  return {
    userId,
    grows,
    newFindings: ((findings.data ?? []) as DigestFindingRow[]).map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      growId: f.grow_id,
      plantId: f.plant_id,
    })),
    newImages: images.count ?? 0,
    newObservations: observations.count ?? 0,
    newTasks: tasks.count ?? 0,
    resolvedFindings: resolved.count ?? 0,
  };
}

type DigestFindingRow = {
  id: string;
  title: string;
  severity: string;
  grow_id: string;
  plant_id: string;
};

async function listPlantIdsFor(
  supabase: SupabaseClient,
  growIds: string[],
): Promise<string[]> {
  if (growIds.length === 0) return [];
  const { data } = await supabase
    .from("plants")
    .select("id")
    .in("grow_id", growIds);
  return (data ?? []).map((row: { id: string }) => row.id);
}

// True when there's nothing worth notifying about. The cron skips
// these users entirely — no DB write, no AI call.
export function hasMeaningfulActivity(s: DailyDigestSnapshot): boolean {
  return (
    s.newFindings.length > 0 ||
    s.newImages > 0 ||
    s.newObservations > 0 ||
    s.newTasks > 0 ||
    s.resolvedFindings > 0
  );
}

// Build the AI prompt body. Kept deterministic and short so the model
// has nowhere to wander — we want a 2-3 sentence digest, not an essay.
export function buildDigestPrompt(s: DailyDigestSnapshot): string {
  const growsLabel = s.grows
    .map(
      (g) => `${g.name}${g.stage ? ` (${g.stage.replaceAll("_", " ")})` : ""}`,
    )
    .join(", ");
  const findingsLabel =
    s.newFindings.length > 0
      ? s.newFindings
          .slice(0, 5)
          .map((f) => `[${f.severity}] ${f.title}`)
          .join("; ")
      : "none";

  return [
    "You write a one-paragraph daily summary for a cannabis grower. The grower has these active grows: " +
      (growsLabel || "none") +
      ".",
    "In the last 24 hours:",
    `- New AI findings: ${findingsLabel}`,
    `- New images uploaded: ${s.newImages}`,
    `- New observations logged: ${s.newObservations}`,
    `- New tasks created: ${s.newTasks}`,
    `- Findings marked resolved: ${s.resolvedFindings}`,
    "",
    "Write 2-3 calm, specific sentences. Lead with what most needs attention, then briefly note ongoing momentum. Skip filler like 'good morning'. If a finding is high or critical severity, name it. Do not invent details that aren't in the data above.",
  ].join("\n");
}

export interface DigestRendered {
  title: string;
  body: string;
}

// Calls the AI model and returns the rendered digest. Throws on
// network / quota failure — the caller decides whether to skip this
// user or abort the cron run.
export async function renderDigest(
  s: DailyDigestSnapshot,
): Promise<DigestRendered> {
  const client = getAIClient();
  // Same model the chat route uses (CHAT_MODEL override or
  // gemini-2.5-flash default), so digest costs stay on the free tier
  // unless the operator has already opted into a paid model.
  const model = process.env["CHAT_MODEL"] || "gemini-2.5-flash";

  const completion = await client.chat.completions.create({
    model,
    max_completion_tokens: DIGEST_MAX_OUTPUT_TOKENS,
    messages: [
      { role: "system", content: "You are PhenoSage's daily summary writer." },
      { role: "user", content: buildDigestPrompt(s) },
    ],
  });

  const body =
    completion.choices[0]?.message?.content?.trim() ??
    "(No summary content returned.)";

  // Plain title; UI groups by occurred_on so date headers are
  // unnecessary in the title itself.
  const criticalCount = s.newFindings.filter(
    (f) => f.severity === "critical",
  ).length;
  const highCount = s.newFindings.filter((f) => f.severity === "high").length;
  let title = "Today's grow summary";
  if (criticalCount > 0)
    title = `${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} need attention`;
  else if (highCount > 0)
    title = `${highCount} high-severity finding${highCount === 1 ? "" : "s"} today`;

  return { title, body };
}

export function digestPriority(
  s: DailyDigestSnapshot,
): "info" | "warning" | "critical" {
  if (s.newFindings.some((f) => f.severity === "critical")) return "critical";
  if (s.newFindings.some((f) => f.severity === "high")) return "warning";
  return "info";
}
