import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "./auth";
import { checkPerToolRateLimit } from "./chat-tool-policies";
import {
  AnalysisHistoryArgs,
  buildBulkPlantNames,
  ComparePlantsArgs,
  CreateGrowArgs,
  CreateGrowTaskArgs,
  CreatePlantsArgs,
  EventsArgs,
  FindGrowArgs,
  FindingsArgs,
  FindPlantArgs,
  GetGrowSummaryArgs,
  GetPlantTimelineArgs,
  LatestAnalysisArgs,
  ListGrowsArgs,
  ListOpenTasksArgs,
  ListPlantsArgs,
  LogGrowEventArgs,
  LogPlantObservationArgs,
  MarkFindingResolvedArgs,
  ObservationsArgs,
  quotedIlikeOrValue,
  RecordImageFindingArgs,
  TriggerPlantAnalysisArgs,
  UpdateGrowArgs,
  UpdateGrowStageArgs,
  UpdatePlantArgs,
  UpdateTaskStatusArgs,
  WRITE_TOOLS,
} from "./chat-tool-schemas";
import { persistSingleFindingEmbeddingBestEffort } from "./embeddings";
import { getPlantTimeline, runAndPersistPlantAnalysis } from "./plants";
import { logServerEvent } from "./request-id";
import { executeSearchSimilarFindingsTool } from "./semantic-findings";

// Tool definitions live in chat-tool-definitions.ts (pure data) so this
// module — executor + handlers — stays focused on behavior. Schemas,
// enum lists, and the write-tool allowlist live in chat-tool-schemas.ts.
export { CHAT_TOOL_DEFINITIONS } from "./chat-tool-definitions";

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

// Hard ceiling on the synchronous Gemini analysis call inside
// `trigger_plant_analysis`. Vercel hobby is 60s and pro is 300s on
// route handlers; 45s leaves headroom for the model's own response
// after the tool completes. When async via analysis_jobs lands
// (migration 005 — worker not yet wired up), this constant goes away.
const ANALYSIS_TOOL_TIMEOUT_MS = 45_000;

const numClamp = (n: unknown, def: number, max: number): number => {
  const parsed = typeof n === "number" && Number.isFinite(n) ? n : def;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
};

type ChatToolContext = {
  userId: string | null;
  requestId: string;
  // Optional cached supabase client so repeat tool calls within one request
  // don't pay the auth-cookie-parse + client-init cost on every invocation.
  supabase?: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};

export async function executeChatTool(
  name: string,
  rawArgs: unknown,
  ctx: ChatToolContext,
): Promise<ToolResult> {
  const started = Date.now();

  // Per-tool rate limit BEFORE client init so a hammered tool doesn't
  // even pay the auth-cookie-parse cost.
  const rl = await checkPerToolRateLimit(name, ctx);
  if (!rl.ok) return { ok: false, error: rl.error };

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  if (ctx.supabase) {
    supabase = ctx.supabase;
  } else {
    try {
      supabase = await createSupabaseServerClient();
    } catch (err) {
      logServerEvent("error", "chat tool client init failed", {
        requestId: ctx.requestId,
        userId: ctx.userId,
        tool: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: "data backend unavailable" };
    }
  }

  // Inner IIFE so we can log every tool invocation with its outcome and
  // latency through a single return path. This is the cheapest way to give
  // ops a clear audit trail of which tools the assistant actually ran for
  // a given chat request — invaluable when a user reports a wrong answer.
  const result: ToolResult = await (async (): Promise<ToolResult> => {
    try {
      switch (name) {
        case "list_grows": {
          const args = ListGrowsArgs.parse(rawArgs ?? {});
          const limit = numClamp(args.limit, 10, 25);
          const { data, error } = await supabase
            .from("grows")
            .select(
              "id,name,stage,medium,light_type,start_date,target_harvest_date,is_archived,updated_at",
            )
            .eq("is_archived", false)
            .order("updated_at", { ascending: false })
            .limit(limit);
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "list_plants": {
          const args = ListPlantsArgs.parse(rawArgs);
          const limit = numClamp(args.limit, 25, 50);
          const { data, error } = await supabase
            .from("plants")
            .select("id,name,strain,batch_label,notes,is_archived,updated_at")
            .eq("grow_id", args.growId)
            .eq("is_archived", false)
            .order("updated_at", { ascending: false })
            .limit(limit);
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "get_recent_findings": {
          const args = FindingsArgs.parse(rawArgs ?? {});
          if (!args.growId && !args.plantId) {
            return {
              ok: false,
              error: "Provide growId or plantId to scope findings.",
            };
          }
          const limit = numClamp(args.limit, 10, 25);
          const sinceDays = numClamp(args.sinceDays, 30, 365);
          const since = new Date(
            Date.now() - sinceDays * 24 * 60 * 60 * 1000,
          ).toISOString();

          let q = supabase
            .from("plant_findings")
            .select(
              "id,plant_id,grow_id,image_id,category,severity,title,description,recommendation,resolved_at,created_at",
            )
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (args.plantId) q = q.eq("plant_id", args.plantId);
          if (args.growId) q = q.eq("grow_id", args.growId);

          const { data, error } = await q;
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "get_recent_observations": {
          const args = ObservationsArgs.parse(rawArgs ?? {});
          if (!args.growId && !args.plantId) {
            return {
              ok: false,
              error: "Provide growId or plantId to scope observations.",
            };
          }
          const limit = numClamp(args.limit, 10, 25);
          let q = supabase
            .from("plant_observations")
            .select(
              "id,plant_id,grow_id,observed_at,height_cm,notes,created_at",
            )
            .order("observed_at", { ascending: false })
            .limit(limit);
          if (args.plantId) q = q.eq("plant_id", args.plantId);
          if (args.growId) q = q.eq("grow_id", args.growId);

          const { data, error } = await q;
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "get_grow_events": {
          const args = EventsArgs.parse(rawArgs ?? {});
          if (!args.growId && !args.plantId) {
            return {
              ok: false,
              error: "Provide growId or plantId to scope events.",
            };
          }
          const limit = numClamp(args.limit, 15, 50);
          const sinceDays = numClamp(args.sinceDays, 14, 365);
          const since = new Date(
            Date.now() - sinceDays * 24 * 60 * 60 * 1000,
          ).toISOString();

          let q = supabase
            .from("grow_events")
            .select(
              "id,grow_id,plant_id,event_type,notes,occurred_at,created_at",
            )
            .gte("occurred_at", since)
            .order("occurred_at", { ascending: false })
            .limit(limit);
          if (args.plantId) q = q.eq("plant_id", args.plantId);
          if (args.growId) q = q.eq("grow_id", args.growId);

          const { data, error } = await q;
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "get_latest_analysis": {
          const args = LatestAnalysisArgs.parse(rawArgs);
          const { data, error } = await supabase
            .from("plant_analyses")
            .select(
              "id,plant_id,grow_id,image_id,compared_to_image_id,overall_health_score,summary,comparison_summary,analysis_mode,is_fallback,model_version,created_at",
            )
            .eq("plant_id", args.plantId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? null };
        }

        case "get_analysis_history": {
          const args = AnalysisHistoryArgs.parse(rawArgs);
          const limit = numClamp(args.limit, 8, 20);
          const { data, error } = await supabase
            .from("plant_analyses")
            .select(
              "id,plant_id,image_id,overall_health_score,summary,comparison_summary,analysis_mode,is_fallback,model_version,analyzed_at,created_at",
            )
            .eq("plant_id", args.plantId)
            .order("analyzed_at", { ascending: false })
            .limit(limit);
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "log_grow_event": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = LogGrowEventArgs.parse(rawArgs);
          const row = {
            grow_id: args.growId,
            plant_id: args.plantId ?? null,
            user_id: ctx.userId,
            event_type: args.eventType,
            notes: args.notes ?? null,
            occurred_at: args.occurredAt ?? new Date().toISOString(),
          };
          const { data, error } = await supabase
            .from("grow_events")
            .insert(row)
            .select("id,grow_id,plant_id,event_type,notes,occurred_at")
            .single();
          if (error) {
            // RLS denials surface as PostgREST errors. Map them to a
            // model-friendly message that doesn't leak the underlying
            // policy text.
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have access to this grow"
                : `could not log event: ${error.message}`,
            };
          }
          return { ok: true, data };
        }

        case "log_plant_observation": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = LogPlantObservationArgs.parse(rawArgs);
          const row = {
            plant_id: args.plantId,
            grow_id: args.growId,
            user_id: ctx.userId,
            height_cm: args.heightCm ?? null,
            notes: args.notes ?? null,
            observed_at: args.observedAt ?? new Date().toISOString(),
          };
          const { data, error } = await supabase
            .from("plant_observations")
            .insert(row)
            .select("id,plant_id,grow_id,height_cm,notes,observed_at")
            .single();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have access to this plant"
                : `could not log observation: ${error.message}`,
            };
          }
          return { ok: true, data };
        }

        case "mark_finding_resolved": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = MarkFindingResolvedArgs.parse(rawArgs);
          const resolvedAt = args.resolved
            ? (args.resolvedAt ?? new Date().toISOString())
            : null;
          const { data, error } = await supabase
            .from("plant_findings")
            .update({ resolved_at: resolvedAt })
            .eq("id", args.findingId)
            .select("id,plant_id,grow_id,category,severity,title,resolved_at")
            .maybeSingle();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have permission to update this finding (owner or collaborator only)"
                : `could not update finding: ${error.message}`,
            };
          }
          if (!data) {
            // The UPDATE silently affected zero rows — either the finding
            // does not exist or RLS hid it from this user. Return a uniform
            // not-found message; the model should NOT leak the existence
            // of inaccessible rows.
            return {
              ok: false,
              error: "finding not found or not accessible",
            };
          }
          return { ok: true, data };
        }

        case "update_grow_stage": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = UpdateGrowStageArgs.parse(rawArgs);
          const { data, error } = await supabase
            .from("grows")
            .update({ stage: args.stage })
            .eq("id", args.growId)
            .select("id,name,stage")
            .maybeSingle();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have permission to change this grow's stage (owners only)"
                : `could not update grow stage: ${error.message}`,
            };
          }
          if (!data) {
            return {
              ok: false,
              error: "grow not found or not accessible",
            };
          }
          return { ok: true, data };
        }

        case "list_open_tasks": {
          const args = ListOpenTasksArgs.parse(rawArgs ?? {});
          const limit = numClamp(args.limit, 10, 25);
          // Priority enum is stored as a postgres enum, which sorts by
          // declaration order: low < medium < high < urgent. So DESC order
          // on the column gives us urgent → high → medium → low naturally,
          // which is what a worklist UI wants.
          let q = supabase
            .from("grow_tasks")
            .select(
              "id,grow_id,plant_id,finding_id,title,description,priority,status,due_at,created_at,completed_at",
            )
            .order("priority", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(limit);
          if (args.growId) q = q.eq("grow_id", args.growId);
          if (args.plantId) q = q.eq("plant_id", args.plantId);
          if (!args.includeCompleted) {
            q = q.in("status", ["open", "in_progress"]);
          }
          const { data, error } = await q;
          if (error) return { ok: false, error: error.message };
          return { ok: true, data: data ?? [] };
        }

        case "update_task_status": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = UpdateTaskStatusArgs.parse(rawArgs);
          // completed_at is stamped/cleared by the BEFORE UPDATE trigger
          // (grow_tasks_touch_updated_at) — we don't set it here.
          const { data, error } = await supabase
            .from("grow_tasks")
            .update({ status: args.status })
            .eq("id", args.taskId)
            .select(
              "id,grow_id,plant_id,finding_id,title,priority,status,completed_at",
            )
            .maybeSingle();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have permission to update this task (owner or collaborator only)"
                : `could not update task: ${error.message}`,
            };
          }
          if (!data) {
            return {
              ok: false,
              error: "task not found or not accessible",
            };
          }
          return { ok: true, data };
        }

        case "create_grow": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = CreateGrowArgs.parse(rawArgs);
          const row = {
            owner_id: ctx.userId,
            name: args.name.trim(),
            description: args.description?.trim() || null,
            stage: args.stage,
            medium: args.medium,
            light_type: args.lightType,
            start_date: args.startDate ?? new Date().toISOString().slice(0, 10),
            target_harvest_date: args.targetHarvestDate ?? null,
          };
          const { data, error } = await supabase
            .from("grows")
            .insert(row)
            .select(
              "id,name,stage,medium,light_type,start_date,target_harvest_date",
            )
            .single();
          if (error || !data) {
            const denied =
              error?.code === "42501" ||
              /permission denied|row-level security/i.test(
                error?.message ?? "",
              );
            return {
              ok: false,
              error: denied
                ? "you do not have permission to create a grow on this account"
                : error?.code === "23505"
                  ? "a grow with that name already exists. Suggest a different name."
                  : `could not create grow: ${error?.message ?? "no row returned"}`,
            };
          }
          return { ok: true, data };
        }

        case "create_plants": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = CreatePlantsArgs.parse(rawArgs);
          const count = args.count ?? 1;
          const names = buildBulkPlantNames(args.name.trim(), count);
          const rows = names.map((plantName) => ({
            grow_id: args.growId,
            name: plantName,
            strain: args.strain?.trim() || null,
            batch_label: args.batchLabel?.trim() || null,
            notes: args.notes?.trim() || null,
          }));
          const { data, error } = await supabase
            .from("plants")
            .insert(rows)
            .select("id,grow_id,name,strain,batch_label");
          if (error || !data || data.length === 0) {
            const denied =
              error?.code === "42501" ||
              /permission denied|row-level security/i.test(
                error?.message ?? "",
              );
            return {
              ok: false,
              error: denied
                ? "you do not have access to this grow"
                : error?.code === "23505"
                  ? count > 1
                    ? "one of the generated plant names already exists in this grow. Try a different name prefix."
                    : "a plant with that name already exists in this grow."
                  : `could not create plants: ${error?.message ?? "no rows returned"}`,
            };
          }
          return { ok: true, data: { count: data.length, plants: data } };
        }

        case "create_grow_task": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = CreateGrowTaskArgs.parse(rawArgs);
          const row = {
            grow_id: args.growId,
            plant_id: args.plantId ?? null,
            title: args.title.trim(),
            description: args.description?.trim() || null,
            priority: args.priority ?? "medium",
            status: "open" as const,
            due_at: args.dueAt ?? null,
          };
          const { data, error } = await supabase
            .from("grow_tasks")
            .insert(row)
            .select("id,grow_id,plant_id,title,priority,status,due_at")
            .single();
          if (error || !data) {
            const denied =
              error?.code === "42501" ||
              /permission denied|row-level security/i.test(
                error?.message ?? "",
              );
            return {
              ok: false,
              error: denied
                ? "you do not have permission to add tasks to this grow (owner or collaborator only)"
                : `could not create task: ${error?.message ?? "no row returned"}`,
            };
          }
          return { ok: true, data };
        }

        case "update_grow": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = UpdateGrowArgs.parse(rawArgs);
          const patch: Record<string, unknown> = {};
          if (args.name !== undefined) patch.name = args.name.trim();
          if (args.description !== undefined) {
            patch.description =
              args.description.trim() === "" ? null : args.description.trim();
          }
          if (args.medium !== undefined) patch.medium = args.medium;
          if (args.lightType !== undefined) patch.light_type = args.lightType;
          if (args.targetHarvestDate !== undefined) {
            patch.target_harvest_date =
              args.targetHarvestDate === "" ? null : args.targetHarvestDate;
          }
          if (args.archived !== undefined) patch.is_archived = args.archived;

          const { data, error } = await supabase
            .from("grows")
            .update(patch)
            .eq("id", args.growId)
            .select(
              "id,name,description,stage,medium,light_type,start_date,target_harvest_date,is_archived",
            )
            .maybeSingle();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have permission to update this grow (owner only)"
                : error.code === "23505"
                  ? "a grow with that name already exists. Suggest a different name."
                  : `could not update grow: ${error.message}`,
            };
          }
          if (!data) {
            return {
              ok: false,
              error:
                "grow not found or not accessible — confirm growId and that the user owns the grow",
            };
          }
          return { ok: true, data };
        }

        case "update_plant": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = UpdatePlantArgs.parse(rawArgs);
          const patch: Record<string, unknown> = {};
          if (args.name !== undefined) patch.name = args.name.trim();
          if (args.strain !== undefined) {
            patch.strain =
              args.strain.trim() === "" ? null : args.strain.trim();
          }
          if (args.batchLabel !== undefined) {
            patch.batch_label =
              args.batchLabel.trim() === "" ? null : args.batchLabel.trim();
          }
          if (args.notes !== undefined) {
            patch.notes = args.notes.trim() === "" ? null : args.notes.trim();
          }
          if (args.archived !== undefined) patch.is_archived = args.archived;

          const { data, error } = await supabase
            .from("plants")
            .update(patch)
            .eq("id", args.plantId)
            .select(
              "id,grow_id,name,strain,batch_label,notes,is_archived,updated_at",
            )
            .maybeSingle();
          if (error) {
            const denied =
              error.code === "42501" ||
              /permission denied|row-level security/i.test(error.message);
            return {
              ok: false,
              error: denied
                ? "you do not have permission to update this plant (owner only)"
                : error.code === "23505"
                  ? "a plant with that name already exists in the grow. Suggest a different name."
                  : `could not update plant: ${error.message}`,
            };
          }
          if (!data) {
            return {
              ok: false,
              error:
                "plant not found or not accessible — confirm plantId and that the user owns the grow",
            };
          }
          return { ok: true, data };
        }

        case "record_image_finding": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = RecordImageFindingArgs.parse(rawArgs);
          const row = {
            plant_id: args.plantId,
            grow_id: args.growId,
            image_id: args.imageId ?? null,
            category: args.category,
            severity: args.severity,
            title: args.title.trim(),
            description: args.description?.trim() || "",
            recommendation: args.recommendation?.trim() || null,
            source: "user_reported" as const,
          };
          const { data, error } = await supabase
            .from("plant_findings")
            .insert(row)
            .select(
              "id,plant_id,grow_id,image_id,category,severity,title,description,recommendation,source,created_at",
            )
            .single();
          if (error || !data) {
            const denied =
              error?.code === "42501" ||
              /permission denied|row-level security/i.test(
                error?.message ?? "",
              );
            logServerEvent("warn", "chat record_image_finding failed", {
              requestId: ctx.requestId,
              userId: ctx.userId,
              growId: args.growId,
              plantId: args.plantId,
              code: error?.code,
              error: error?.message ?? "no row returned",
            });
            return {
              ok: false,
              error: denied
                ? "you do not have permission to record findings on this grow (owner or collaborator only)"
                : "could not record finding right now; please try again later",
            };
          }
          await persistSingleFindingEmbeddingBestEffort(
            {
              id: data.id,
              category: data.category,
              severity: data.severity,
              title: data.title,
              description: data.description,
              recommendation: data.recommendation,
            },
            { requestId: ctx.requestId, userId: ctx.userId },
          );
          return { ok: true, data };
        }
        case "search_similar_findings": {
          return executeSearchSimilarFindingsTool(rawArgs, {
            supabase,
            requestId: ctx.requestId,
            userId: ctx.userId,
          });
        }

        case "get_plant_timeline": {
          const args = GetPlantTimelineArgs.parse(rawArgs);
          const limit = numClamp(args.limit, 20, 50);
          const timeline = await getPlantTimeline(args.plantId);
          if (!timeline) {
            return {
              ok: false,
              error:
                "plant not found or not accessible — confirm plantId and that the user owns the grow",
            };
          }
          // Cap items by the requested limit so a 200-item history doesn't
          // blow the response budget. Items are already newest-first.
          const items = timeline.items.slice(0, limit);
          return {
            ok: true,
            data: {
              plantId: timeline.plantId,
              totalCount: timeline.items.length,
              returnedCount: items.length,
              items,
            },
          };
        }

        case "trigger_plant_analysis": {
          if (!ctx.userId) {
            return { ok: false, error: "not authenticated" };
          }
          const args = TriggerPlantAnalysisArgs.parse(rawArgs);
          try {
            const analyzeParams: Parameters<
              typeof runAndPersistPlantAnalysis
            >[0] = {
              plantId: args.plantId,
              requestId: ctx.requestId,
            };
            if (args.imageId) analyzeParams.imageId = args.imageId;
            // Synchronous Gemini call inside the tool loop. Hard
            // ceiling so a stalled upstream doesn't hold the chat
            // stream open indefinitely — the model can re-issue the
            // tool call on the next turn if the user wants to retry.
            // (async-job follow-up: see analysis_jobs table from
            // migration 005 — a worker that drains the queue is not
            // wired up yet, so the sync path stays default.)
            //
            // The timer is captured in a let-binding and cleared in
            // `finally` so a fast-path success doesn't leave the
            // event loop holding a 45s timeout — important when
            // multiple tool calls fan out in one chat turn.
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const result = await Promise.race([
              runAndPersistPlantAnalysis(analyzeParams),
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                  () => reject(new Error("analysis timed out after 45s")),
                  ANALYSIS_TOOL_TIMEOUT_MS,
                );
              }),
            ]).finally(() => {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
            });
            if (!result) {
              return {
                ok: false,
                error:
                  "plant not found or not accessible — confirm plantId and that the user owns the grow",
              };
            }
            if (!result.analysis) {
              return {
                ok: false,
                error:
                  "no images on this plant yet — upload a photo first, then re-run analysis",
              };
            }
            // Return a trimmed summary so the model can quote it without
            // re-fetching: score, summary text, comparison context, and
            // counts of any findings emitted by this run. analysisId is
            // exposed at the top of runAndPersistPlantAnalysis's return
            // value, not inside the AnalysisResponse.
            return {
              ok: true,
              data: {
                analysisId: result.analysisId,
                imageId: result.analysis.imageId,
                comparedToImageId: result.analysis.comparedToImageId ?? null,
                overallHealthScore: result.analysis.overallHealthScore,
                summary: result.analysis.summary,
                comparisonSummary: result.analysis.comparisonSummary ?? null,
                analysisMode: result.analysis.analysisMode ?? null,
                isFallback: result.analysis.isFallback ?? false,
                findingsCount: result.analysis.findings?.length ?? 0,
                analyzedAt: result.analysis.analyzedAt,
              },
            };
          } catch (err) {
            logServerEvent("error", "chat trigger_plant_analysis failed", {
              requestId: ctx.requestId,
              userId: ctx.userId,
              plantId: args.plantId,
              error: err instanceof Error ? err.message : String(err),
            });
            return {
              ok: false,
              error: "analysis pipeline failed; try again in a moment",
            };
          }
        }

        case "find_grow": {
          const args = FindGrowArgs.parse(rawArgs);
          const limit = numClamp(args.limit, 5, 15);
          // Trigram-ranked RPC (migration 019). RLS still applies
          // because the RPC is SECURITY INVOKER. Falls back to
          // substring ILIKE inside the SQL function for very short
          // queries that don't meet the trigram similarity threshold.
          const { data, error } = await supabase.rpc("search_grows", {
            q: args.query,
            include_archived: args.includeArchived ?? false,
            max_results: limit,
          });
          if (error) {
            // Defence in depth: if the RPC is missing (migration not
            // applied) or its signature drifts, fall back to the old
            // ILIKE path so the agent stays functional rather than
            // returning "(error)" for every grow lookup.
            logServerEvent(
              "warn",
              "search_grows rpc failed, falling back to ilike",
              {
                requestId: ctx.requestId,
                userId: ctx.userId,
                error: error.message,
              },
            );
            const pattern = quotedIlikeOrValue(args.query);
            let q = supabase
              .from("grows")
              .select(
                "id,name,description,stage,medium,light_type,start_date,is_archived,updated_at",
              )
              .or(`name.ilike.${pattern},description.ilike.${pattern}`)
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (!args.includeArchived) q = q.eq("is_archived", false);
            const fb = await q;
            if (fb.error) return { ok: false, error: fb.error.message };
            return { ok: true, data: fb.data ?? [] };
          }
          return { ok: true, data: data ?? [] };
        }

        case "find_plant": {
          const args = FindPlantArgs.parse(rawArgs);
          const limit = numClamp(args.limit, 5, 15);
          const { data, error } = await supabase.rpc("search_plants", {
            q: args.query,
            scope_grow_id: args.growId ?? null,
            include_archived: args.includeArchived ?? false,
            max_results: limit,
          });
          if (error) {
            logServerEvent(
              "warn",
              "search_plants rpc failed, falling back to ilike",
              {
                requestId: ctx.requestId,
                userId: ctx.userId,
                error: error.message,
              },
            );
            const pattern = quotedIlikeOrValue(args.query);
            let q = supabase
              .from("plants")
              .select(
                "id,grow_id,name,strain,batch_label,notes,is_archived,updated_at",
              )
              .or(
                `name.ilike.${pattern},strain.ilike.${pattern},batch_label.ilike.${pattern}`,
              )
              .order("updated_at", { ascending: false })
              .limit(limit);
            if (args.growId) q = q.eq("grow_id", args.growId);
            if (!args.includeArchived) q = q.eq("is_archived", false);
            const fb = await q;
            if (fb.error) return { ok: false, error: fb.error.message };
            return { ok: true, data: fb.data ?? [] };
          }
          return { ok: true, data: data ?? [] };
        }

        case "compare_plants": {
          const args = ComparePlantsArgs.parse(rawArgs);
          const sinceDays = numClamp(args.sinceDays, 14, 90);
          const since = new Date(
            Date.now() - sinceDays * 24 * 60 * 60 * 1000,
          ).toISOString();

          // Fan out the per-plant reads in parallel. Each plant gets:
          //   - plant row (name, strain, grow_id)
          //   - latest plant_analyses row
          //   - event count in window
          //   - observation count in window
          //   - unresolved finding count in window
          //   - open task count
          // Promise.allSettled so one RLS denial or missing row degrades
          // that plant's summary rather than failing the whole call.
          const perPlant = await Promise.all(
            args.plantIds.map(async (plantId) => {
              const [
                plantRes,
                analysisRes,
                eventCountRes,
                observationCountRes,
                findingCountRes,
                taskCountRes,
              ] = await Promise.allSettled([
                supabase
                  .from("plants")
                  .select("id,grow_id,name,strain,batch_label,is_archived")
                  .eq("id", plantId)
                  .maybeSingle(),
                supabase
                  .from("plant_analyses")
                  .select(
                    "id,overall_health_score,summary,comparison_summary,analyzed_at,model_version",
                  )
                  .eq("plant_id", plantId)
                  .order("analyzed_at", { ascending: false })
                  .limit(1)
                  .maybeSingle(),
                supabase
                  .from("grow_events")
                  .select("id", { count: "exact", head: true })
                  .eq("plant_id", plantId)
                  .gte("occurred_at", since),
                supabase
                  .from("plant_observations")
                  .select("id", { count: "exact", head: true })
                  .eq("plant_id", plantId)
                  .gte("observed_at", since),
                supabase
                  .from("plant_findings")
                  .select("id", { count: "exact", head: true })
                  .eq("plant_id", plantId)
                  .is("resolved_at", null)
                  .gte("created_at", since),
                supabase
                  .from("grow_tasks")
                  .select("id", { count: "exact", head: true })
                  .eq("plant_id", plantId)
                  .in("status", ["open", "in_progress"]),
              ]);

              const pickCount = (
                r: PromiseSettledResult<{ count: number | null }>,
              ): number =>
                r.status === "fulfilled" ? (r.value.count ?? 0) : 0;

              const plant =
                plantRes.status === "fulfilled" ? plantRes.value.data : null;
              const analysis =
                analysisRes.status === "fulfilled"
                  ? analysisRes.value.data
                  : null;

              return {
                plantId,
                plant,
                latestAnalysis: analysis,
                counts: {
                  events: pickCount(eventCountRes),
                  observations: pickCount(observationCountRes),
                  unresolvedFindings: pickCount(findingCountRes),
                  openTasks: pickCount(taskCountRes),
                },
              };
            }),
          );

          return {
            ok: true,
            data: {
              sinceDays,
              since,
              plants: perPlant,
            },
          };
        }

        case "get_grow_summary": {
          const args = GetGrowSummaryArgs.parse(rawArgs);

          const [
            growRes,
            plantsRes,
            findingsRes,
            tasksRes,
            latestEventRes,
            latestObservationRes,
          ] = await Promise.allSettled([
            supabase
              .from("grows")
              .select(
                "id,name,description,stage,medium,light_type,start_date,target_harvest_date,is_archived",
              )
              .eq("id", args.growId)
              .maybeSingle(),
            supabase
              .from("plants")
              .select("id,name,strain,is_archived")
              .eq("grow_id", args.growId)
              .eq("is_archived", false),
            supabase
              .from("plant_findings")
              .select("id,severity,resolved_at")
              .eq("grow_id", args.growId)
              .is("resolved_at", null),
            supabase
              .from("grow_tasks")
              .select("id,priority,status")
              .eq("grow_id", args.growId)
              .in("status", ["open", "in_progress"]),
            supabase
              .from("grow_events")
              .select("id,event_type,occurred_at")
              .eq("grow_id", args.growId)
              .order("occurred_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("plant_observations")
              .select("id,observed_at")
              .eq("grow_id", args.growId)
              .order("observed_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          const grow =
            growRes.status === "fulfilled" ? growRes.value.data : null;
          if (!grow) {
            return {
              ok: false,
              error:
                "grow not found or not accessible — confirm growId and that the user owns or is a member of the grow",
            };
          }

          const plants =
            (plantsRes.status === "fulfilled" ? plantsRes.value.data : null) ??
            [];
          const findings =
            (findingsRes.status === "fulfilled"
              ? findingsRes.value.data
              : null) ?? [];
          const tasks =
            (tasksRes.status === "fulfilled" ? tasksRes.value.data : null) ??
            [];

          const findingsBySeverity = findings.reduce<Record<string, number>>(
            (acc, row) => {
              const sev = (row as { severity: string }).severity ?? "unknown";
              acc[sev] = (acc[sev] ?? 0) + 1;
              return acc;
            },
            {},
          );
          const tasksByPriority = tasks.reduce<Record<string, number>>(
            (acc, row) => {
              const pri = (row as { priority: string }).priority ?? "unknown";
              acc[pri] = (acc[pri] ?? 0) + 1;
              return acc;
            },
            {},
          );

          const latestEvent =
            latestEventRes.status === "fulfilled"
              ? latestEventRes.value.data
              : null;
          const latestObservation =
            latestObservationRes.status === "fulfilled"
              ? latestObservationRes.value.data
              : null;

          // daysSinceStart mirrors the daysSinceStart calculation used in
          // the analysis context so the model's numeric anchor stays
          // consistent across surfaces.
          const startDate = (grow as { start_date: string | null }).start_date;
          const daysSinceStart =
            startDate && !Number.isNaN(Date.parse(startDate))
              ? Math.max(
                  0,
                  Math.floor((Date.now() - Date.parse(startDate)) / 86_400_000),
                )
              : null;

          return {
            ok: true,
            data: {
              grow,
              daysSinceStart,
              plantCount: plants.length,
              unresolvedFindingCount: findings.length,
              findingsBySeverity,
              openTaskCount: tasks.length,
              tasksByPriority,
              latestEvent,
              latestObservation,
            },
          };
        }

        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return { ok: false, error: `Invalid arguments: ${err.message}` };
      }
      logServerEvent("error", "chat tool execution failed", {
        requestId: ctx.requestId,
        userId: ctx.userId,
        tool: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: "tool execution failed" };
    }
  })();

  // Write tools get an extra audit field: which arg keys the model supplied
  // and (on success) the new row id. Values are deliberately excluded from
  // the log so we don't retain user free-text in ops storage.
  const isWrite = WRITE_TOOLS.has(name);
  const writeAudit = isWrite
    ? {
        write: true,
        argKeys:
          rawArgs && typeof rawArgs === "object"
            ? Object.keys(rawArgs as Record<string, unknown>).sort()
            : [],
        rowId:
          result.ok &&
          result.data &&
          typeof result.data === "object" &&
          "id" in (result.data as Record<string, unknown>)
            ? String((result.data as Record<string, unknown>)["id"])
            : null,
      }
    : null;

  logServerEvent(isWrite && !result.ok ? "warn" : "info", "chat tool invoked", {
    requestId: ctx.requestId,
    userId: ctx.userId,
    tool: name,
    ok: result.ok,
    durationMs: Date.now() - started,
    ...(writeAudit ?? {}),
  });

  return result;
}
