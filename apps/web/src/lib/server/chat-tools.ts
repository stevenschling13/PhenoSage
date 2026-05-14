import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

// Tool definitions exposed to OpenAI. The handlers are intentionally
// thin — they call the user-scoped Supabase client which is RLS-gated,
// so a user can never read another user's data through a chat tool call.

export const CHAT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_grows",
      description:
        "List the user's grows (most recently updated first). Use when the user references a grow but you don't yet know which one, or to find candidate grows by stage.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max grows to return. Default 10, max 25.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_plants",
      description:
        "List plants in a given grow. Returns id, name, strain, batch label, notes.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string", description: "Grow ID to scope to." },
          limit: { type: "number", description: "Max plants. Default 25." },
        },
        required: ["growId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_findings",
      description:
        "Return the most recent plant findings (diagnoses from image analysis) for a grow or plant. Use to ground advice in observed evidence.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: { type: "number", description: "Max findings. Default 10." },
          sinceDays: {
            type: "number",
            description: "Only findings within the last N days. Default 30.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_observations",
      description:
        "Return the most recent grower-recorded plant observations (height, notes) for a grow or plant.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: {
            type: "number",
            description: "Max observations. Default 10.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_grow_events",
      description:
        "Return recent grow events (water, feed, top, lst, defoliate, transplant, ipm, harvest, observation, note, etc.) for a grow or plant. Critical for diagnosing watering / feeding / training issues.",
      parameters: {
        type: "object",
        properties: {
          growId: { type: "string" },
          plantId: { type: "string" },
          limit: { type: "number", description: "Max events. Default 15." },
          sinceDays: { type: "number", description: "Default 14." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_latest_analysis",
      description:
        "Return the most recent image analysis (overall health score, summary, comparison summary) for a plant.",
      parameters: {
        type: "object",
        properties: {
          plantId: { type: "string" },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_analysis_history",
      description:
        "Return the recent image-analysis history for a plant (newest first) so you can describe trends over time. Each row includes overall_health_score, summary, comparison_summary, model_version, and created_at — use these to discuss progression, regression, or stability.",
      parameters: {
        type: "object",
        properties: {
          plantId: { type: "string" },
          limit: {
            type: "number",
            description: "Max history rows. Default 8, max 20.",
          },
        },
        required: ["plantId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_grow_event",
      description:
        "Record a cultivation action the grower just performed: water, feed, top, fim, lst, defoliate, transplant, ipm (pest treatment), harvest, observation, note, other. Use this when the user describes something they DID — 'I just watered tent 2', 'fed plant 3 with FloraNova at 800 EC', 'topped #4 above the 5th node'. Always confirm the grow (and plant, if specific) and the event_type before calling. The event is attributed to the current user and timestamped to now unless occurredAt is supplied. Returns the new event id.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID the event belongs to. Required. If unknown, call list_grows first.",
          },
          plantId: {
            type: "string",
            description:
              "Optional plant ID when the action targeted a single plant. Omit for whole-grow events (e.g. environmental adjustments).",
          },
          eventType: {
            type: "string",
            enum: [
              "water",
              "feed",
              "top",
              "fim",
              "lst",
              "defoliate",
              "transplant",
              "ipm",
              "harvest",
              "observation",
              "note",
              "other",
            ],
            description:
              "Event category. Pick the most specific match. Use 'other' only when no category fits.",
          },
          notes: {
            type: "string",
            description:
              "Free-text detail (product, dose, EC/pH, observed runoff, branch trained, etc.). Up to 2000 chars.",
          },
          occurredAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the action actually happened. Omit to use now. Cannot be in the future.",
          },
        },
        required: ["growId", "eventType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_plant_observation",
      description:
        "Record a manual observation about a single plant — typically height in cm and/or a free-text note ('node 5 inter-nodal spacing tightening, pistils fattening'). Use when the user reports a measurement or qualitative observation. Returns the new observation id.",
      parameters: {
        type: "object",
        properties: {
          plantId: {
            type: "string",
            description: "Plant ID being observed. Required.",
          },
          growId: {
            type: "string",
            description:
              "Grow ID the plant belongs to. Required so the row can be RLS-checked.",
          },
          heightCm: {
            type: "number",
            description:
              "Height in centimetres (numeric, two decimals). Omit if not measured.",
          },
          notes: {
            type: "string",
            description:
              "Free-text observation (up to 2000 chars). At least one of heightCm or notes must be supplied.",
          },
          observedAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the observation was made. Omit to use now. Cannot be in the future.",
          },
        },
        required: ["plantId", "growId"],
        additionalProperties: false,
      },
    },
  },
];

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const numClamp = (n: unknown, def: number, max: number): number => {
  const parsed = typeof n === "number" && Number.isFinite(n) ? n : def;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
};

const ListGrowsArgs = z.object({ limit: z.number().optional() });
const ListPlantsArgs = z.object({
  growId: z.string().min(1),
  limit: z.number().optional(),
});
const FindingsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
  sinceDays: z.number().optional(),
});
const ObservationsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
});
const EventsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
  sinceDays: z.number().optional(),
});
const LatestAnalysisArgs = z.object({ plantId: z.string().min(1) });
const AnalysisHistoryArgs = z.object({
  plantId: z.string().min(1),
  limit: z.number().optional(),
});

const EVENT_TYPES = [
  "water",
  "feed",
  "top",
  "fim",
  "lst",
  "defoliate",
  "transplant",
  "ipm",
  "harvest",
  "observation",
  "note",
  "other",
] as const;

const MAX_NOTES_LENGTH = 2_000;

const isoDatetimeNotFuture = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a valid ISO 8601 datetime",
  })
  .refine((s) => Date.parse(s) <= Date.now() + 60_000, {
    message: "must not be more than 1 minute in the future",
  });

const LogGrowEventArgs = z.object({
  growId: z.string().min(1),
  plantId: z.string().min(1).optional(),
  eventType: z.enum(EVENT_TYPES),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  occurredAt: isoDatetimeNotFuture.optional(),
});

const LogPlantObservationArgs = z
  .object({
    plantId: z.string().min(1),
    growId: z.string().min(1),
    heightCm: z.number().positive().max(1_000).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional(),
    observedAt: isoDatetimeNotFuture.optional(),
  })
  .refine((v) => v.heightCm !== undefined || (v.notes && v.notes.length > 0), {
    message: "supply at least one of heightCm or notes",
  });

// Tools whose names start the model down a write path. The executor logs
// arg keys (never values) for these so we have an audit trail without
// retaining free-text user content in the request log.
const WRITE_TOOLS = new Set<string>([
  "log_grow_event",
  "log_plant_observation",
]);

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
