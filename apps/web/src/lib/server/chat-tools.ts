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

export async function executeChatTool(
  name: string,
  rawArgs: unknown,
  ctx: { userId: string | null; requestId: string },
): Promise<ToolResult> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
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
          .select("id,plant_id,grow_id,observed_at,height_cm,notes,created_at")
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
          .select("id,grow_id,plant_id,event_type,notes,occurred_at,created_at")
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
}
