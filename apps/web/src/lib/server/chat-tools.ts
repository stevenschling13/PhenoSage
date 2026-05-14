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
  {
    type: "function" as const,
    function: {
      name: "mark_finding_resolved",
      description:
        "Mark an AI-generated plant finding as resolved (or re-open it). Use when the user confirms they've addressed an issue ('I flushed the deficiency yesterday and it looks better' → mark the matching nutrient_deficiency finding resolved) or wants to re-open one they thought was fixed. Resolution sets `resolved_at` to now (or a supplied timestamp); re-opening clears it. You can only modify this field — severity, category, and description are immutable.",
      parameters: {
        type: "object",
        properties: {
          findingId: {
            type: "string",
            description:
              "Finding ID to update. Required. If you don't know it, call get_recent_findings first.",
          },
          resolved: {
            type: "boolean",
            description:
              "true to mark resolved (sets resolved_at), false to re-open (clears resolved_at). Required.",
          },
          resolvedAt: {
            type: "string",
            description:
              "ISO 8601 timestamp the issue was actually resolved. Omit to use now. Ignored when resolved=false. Cannot be in the future.",
          },
        },
        required: ["findingId", "resolved"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_grow_stage",
      description:
        "Transition the entire grow to a new growth stage. Use when the user says they switched the room/tent — 'I flipped the tent to flower yesterday', 'moved everyone to veg'. Stage is a property of the GROW, not individual plants (schema constraint today), so this affects every plant in that grow. Only grow OWNERS can change stage today (collaborators get a permission error). Returns the updated stage.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description: "Grow ID to update. Required.",
          },
          stage: {
            type: "string",
            enum: [
              "germination",
              "seedling",
              "vegetative",
              "pre_flower",
              "flower",
              "late_flower",
              "harvest",
              "dry_cure",
            ],
            description:
              "New stage. Use 'pre_flower' for the stretch / first-pistils transition, 'late_flower' for the final 2-3 weeks before harvest, 'dry_cure' for post-harvest dry+cure.",
          },
        },
        required: ["growId", "stage"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_open_tasks",
      description:
        "List actionable tasks for a grow or plant. Tasks are auto-created from high/critical AI findings, and may also be created manually. Use to surface what the grower should do next, or to ground a reply in their actual worklist. Returns open + in_progress tasks by default, newest urgent first.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID to scope to. Either growId or plantId is required.",
          },
          plantId: {
            type: "string",
            description:
              "Plant ID to scope to (filters tasks where plant_id matches). Either growId or plantId is required.",
          },
          includeCompleted: {
            type: "boolean",
            description:
              "Set true to include done + dismissed tasks too. Default false (only open + in_progress).",
          },
          limit: {
            type: "number",
            description: "Max tasks. Default 10, max 25.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task_status",
      description:
        "Transition a grow_task to a new status — typically 'done' when the grower says they completed the action, or 'dismissed' when the task no longer applies (e.g. a false-positive finding). Setting status to 'done' or 'dismissed' stamps completed_at; setting it back to 'open' or 'in_progress' clears completed_at. Returns the updated task. Owner + collaborator only.",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "Task ID to update. Required.",
          },
          status: {
            type: "string",
            enum: ["open", "in_progress", "done", "dismissed"],
            description: "New status. Required.",
          },
        },
        required: ["taskId", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_grow",
      description:
        "Create a new grow record on the user's behalf. Use when the user wants to set up a brand-new tent / room / cultivation program — 'start a new grow called North Tent in soil under LED', 'I'm beginning week 1 of a hydro flower run, set it up'. Always confirm at least name + stage + medium + light before calling. The grow is owned by the current user. Returns the new grow id and name so follow-up tools (create_plants, etc.) can reference it.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Operator-facing grow name (1-120 chars). Required. Examples: 'North Tent A', 'Greenhouse Spring 2026', 'Veg Room B'.",
          },
          stage: {
            type: "string",
            enum: [
              "germination",
              "seedling",
              "vegetative",
              "pre_flower",
              "flower",
              "late_flower",
              "harvest",
              "dry_cure",
            ],
            description:
              "Current stage. Pick the most specific match for what the grower is doing today (default to 'seedling' for a fresh start when unclear).",
          },
          medium: {
            type: "string",
            enum: ["soil", "coco", "hydro", "aero", "living_soil", "other"],
            description: "Cultivation medium.",
          },
          lightType: {
            type: "string",
            enum: ["hps", "cmh", "led", "t5", "sun", "mixed", "other"],
            description: "Primary light source.",
          },
          startDate: {
            type: "string",
            description:
              "ISO 8601 date (YYYY-MM-DD) the grow began. Omit to default to today. Cannot be more than 1 day in the future.",
          },
          targetHarvestDate: {
            type: "string",
            description:
              "Optional ISO 8601 date (YYYY-MM-DD) the grower is aiming to harvest. Must be on or after startDate.",
          },
          description: {
            type: "string",
            description:
              "Optional free-text notes about the room / cultivar / facility (up to 2000 chars).",
          },
        },
        required: ["name", "stage", "medium", "lightType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_plants",
      description:
        "Create one or more plant records inside an existing grow. Use immediately after create_grow when the user describes how many plants they're running, or any time they say 'add N plants to <grow>'. When count > 1, names are auto-suffixed with zero-padded numbers (e.g. 'Plant 01', 'Plant 02'; 'NL 10' two-digit padding when count >= 10). Returns the list of created plant ids and names so the model can reference specific plants in follow-up.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Target grow ID. Required. If unknown, call list_grows first.",
          },
          name: {
            type: "string",
            description:
              "Plant name (count=1) or name prefix (count>1). 1-115 chars; the bulk path appends ' NN' so keep room for the suffix.",
          },
          count: {
            type: "number",
            description:
              "How many plants to create. Default 1. Maximum 25 per call.",
          },
          strain: {
            type: "string",
            description:
              "Optional cultivar / strain name applied to every plant created in this call.",
          },
          batchLabel: {
            type: "string",
            description:
              "Optional tray or batch reference applied to every plant.",
          },
          notes: {
            type: "string",
            description:
              "Optional free-text notes applied to every plant (up to 2000 chars).",
          },
        },
        required: ["growId", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_grow_task",
      description:
        "Create a manual task in a grow's worklist. Use when the user asks for a reminder, follow-up action, or to capture something they need to do later — 'remind me to flush in 3 days', 'add a task to check trichomes Friday'. Tasks auto-created from AI findings already exist; this tool is for grower-initiated reminders only. Returns the new task id.",
      parameters: {
        type: "object",
        properties: {
          growId: {
            type: "string",
            description:
              "Grow ID the task belongs to. Required. If unknown, call list_grows first.",
          },
          plantId: {
            type: "string",
            description:
              "Optional plant ID when the task targets a single plant.",
          },
          title: {
            type: "string",
            description:
              "Short, action-oriented title (1-200 chars). Examples: 'Flush plants 3 and 4', 'Check trichomes Friday'.",
          },
          description: {
            type: "string",
            description: "Optional longer detail (up to 2000 chars).",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description:
              "Task priority. Default 'medium'. Use 'urgent' only when the grower flags an immediate issue.",
          },
          dueAt: {
            type: "string",
            description:
              "Optional ISO 8601 datetime when the task is due. Must be in the future.",
          },
        },
        required: ["growId", "title"],
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

const GROW_STAGES = [
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
] as const;

const MarkFindingResolvedArgs = z.object({
  findingId: z.string().min(1),
  resolved: z.boolean(),
  resolvedAt: isoDatetimeNotFuture.optional(),
});

const UpdateGrowStageArgs = z.object({
  growId: z.string().min(1),
  stage: z.enum(GROW_STAGES),
});

const TASK_STATUSES = ["open", "in_progress", "done", "dismissed"] as const;

const ListOpenTasksArgs = z
  .object({
    growId: z.string().min(1).optional(),
    plantId: z.string().min(1).optional(),
    includeCompleted: z.boolean().optional(),
    limit: z.number().optional(),
  })
  .refine((v) => v.growId !== undefined || v.plantId !== undefined, {
    message: "supply growId or plantId",
  });

const UpdateTaskStatusArgs = z.object({
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUSES),
});

const GROW_MEDIA = [
  "soil",
  "coco",
  "hydro",
  "aero",
  "living_soil",
  "other",
] as const;
const LIGHT_TYPES = [
  "hps",
  "cmh",
  "led",
  "t5",
  "sun",
  "mixed",
  "other",
] as const;

const isoDateNotFarFuture = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a valid date",
  })
  .refine((s) => Date.parse(s) <= Date.now() + 24 * 60 * 60 * 1000, {
    message: "must not be more than 1 day in the future",
  });

const CreateGrowArgs = z
  .object({
    name: z.string().min(1).max(120),
    stage: z.enum(GROW_STAGES),
    medium: z.enum(GROW_MEDIA),
    lightType: z.enum(LIGHT_TYPES),
    startDate: isoDateNotFarFuture.optional(),
    targetHarvestDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
      .refine((s) => !Number.isNaN(Date.parse(s)), {
        message: "must be a valid date",
      })
      .optional(),
    description: z.string().max(MAX_NOTES_LENGTH).optional(),
  })
  .refine(
    (v) =>
      !v.targetHarvestDate ||
      !v.startDate ||
      v.targetHarvestDate >= v.startDate,
    {
      message: "targetHarvestDate must be on or after startDate",
      path: ["targetHarvestDate"],
    },
  );

const CreatePlantsArgs = z.object({
  growId: z.string().min(1),
  name: z.string().min(1).max(115),
  count: z.number().int().min(1).max(25).optional(),
  strain: z.string().max(120).optional(),
  batchLabel: z.string().max(120).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const CreateGrowTaskArgs = z.object({
  growId: z.string().min(1),
  plantId: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(MAX_NOTES_LENGTH).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "must be a valid ISO 8601 datetime",
    })
    .refine((s) => Date.parse(s) > Date.now() - 60_000, {
      message: "dueAt must be in the future",
    })
    .optional(),
});

function buildBulkPlantNames(prefix: string, count: number): string[] {
  if (count <= 1) return [prefix];
  const pad = count >= 10 ? 2 : 1;
  return Array.from(
    { length: count },
    (_, i) => `${prefix} ${String(i + 1).padStart(pad, "0")}`,
  );
}

// Tools whose names start the model down a write path. The executor logs
// arg keys (never values) for these so we have an audit trail without
// retaining free-text user content in the request log.
const WRITE_TOOLS = new Set<string>([
  "log_grow_event",
  "log_plant_observation",
  "mark_finding_resolved",
  "update_grow_stage",
  "update_task_status",
  "create_grow",
  "create_plants",
  "create_grow_task",
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
