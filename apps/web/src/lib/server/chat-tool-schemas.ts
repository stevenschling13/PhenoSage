import "server-only";
import { z } from "zod";

// Pure data + Zod schemas extracted from chat-tools.ts so the executor
// module stays focused on behavior. Anything tool-shaped that does not
// touch I/O lives here: enum lists, length caps, shared refinements,
// per-tool argument schemas, and the write-tool allowlist used for
// audit logging.

export const MAX_NOTES_LENGTH = 2_000;

export const EVENT_TYPES = [
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

export const GROW_STAGES = [
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
] as const;

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "dismissed",
] as const;

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const GROW_MEDIA = [
  "soil",
  "coco",
  "hydro",
  "aero",
  "living_soil",
  "other",
] as const;

export const LIGHT_TYPES = [
  "hps",
  "cmh",
  "led",
  "t5",
  "sun",
  "mixed",
  "other",
] as const;

export const FINDING_CATEGORIES = [
  "nutrient_deficiency",
  "nutrient_toxicity",
  "pest",
  "disease",
  "environmental",
  "training",
  "general",
  "positive",
] as const;

export const FINDING_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const isoDatetimeNotFuture = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a valid ISO 8601 datetime",
  })
  .refine((s) => Date.parse(s) <= Date.now() + 60_000, {
    message: "must not be more than 1 minute in the future",
  });

export const isoDateNotFarFuture = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be a valid date",
  })
  .refine((s) => Date.parse(s) <= Date.now() + 24 * 60 * 60 * 1000, {
    message: "must not be more than 1 day in the future",
  });

// Target-harvest-date accepts either a YYYY-MM-DD string (set) or an empty
// string (clear). undefined means "leave the existing value untouched".
export const isoDateOrEmpty = z
  .string()
  .refine((s) => s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s), {
    message: "must be YYYY-MM-DD or empty to clear",
  })
  .refine((s) => s === "" || !Number.isNaN(Date.parse(s)), {
    message: "must be a valid date",
  });

export const ListGrowsArgs = z.object({ limit: z.number().optional() });

export const ListPlantsArgs = z.object({
  growId: z.string().min(1),
  limit: z.number().optional(),
});

export const FindingsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
  sinceDays: z.number().optional(),
});

export const ObservationsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
});

export const EventsArgs = z.object({
  growId: z.string().min(1).optional(),
  plantId: z.string().min(1).optional(),
  limit: z.number().optional(),
  sinceDays: z.number().optional(),
});

export const LatestAnalysisArgs = z.object({ plantId: z.string().min(1) });

export const AnalysisHistoryArgs = z.object({
  plantId: z.string().min(1),
  limit: z.number().optional(),
});

export const LogGrowEventArgs = z.object({
  growId: z.string().min(1),
  plantId: z.string().min(1).optional(),
  eventType: z.enum(EVENT_TYPES),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  occurredAt: isoDatetimeNotFuture.optional(),
});

export const LogPlantObservationArgs = z
  .object({
    plantId: z.string().min(1),
    growId: z.string().min(1),
    heightCm: z.number().positive().max(1_000).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional(),
    observedAt: isoDatetimeNotFuture.optional(),
  })
  .refine(
    (v) => v.heightCm !== undefined || (v.notes?.trim().length ?? 0) > 0,
    { message: "supply at least one of heightCm or notes" },
  );

export const MarkFindingResolvedArgs = z.object({
  findingId: z.string().min(1),
  resolved: z.boolean(),
  resolvedAt: isoDatetimeNotFuture.optional(),
});

export const UpdateGrowStageArgs = z.object({
  growId: z.string().min(1),
  stage: z.enum(GROW_STAGES),
});

export const ListOpenTasksArgs = z
  .object({
    growId: z.string().min(1).optional(),
    plantId: z.string().min(1).optional(),
    includeCompleted: z.boolean().optional(),
    limit: z.number().optional(),
  })
  .refine((v) => v.growId !== undefined || v.plantId !== undefined, {
    message: "supply growId or plantId",
  });

export const UpdateTaskStatusArgs = z.object({
  taskId: z.string().min(1),
  status: z.enum(TASK_STATUSES),
});

export const CreateGrowArgs = z
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

export const CreatePlantsArgs = z.object({
  growId: z.string().min(1),
  name: z.string().min(1).max(115),
  count: z.number().int().min(1).max(25).optional(),
  strain: z.string().max(120).optional(),
  batchLabel: z.string().max(120).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});

export const CreateGrowTaskArgs = z.object({
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

export const UpdateGrowArgs = z
  .object({
    growId: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(MAX_NOTES_LENGTH).optional(),
    medium: z.enum(GROW_MEDIA).optional(),
    lightType: z.enum(LIGHT_TYPES).optional(),
    targetHarvestDate: isoDateOrEmpty.optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.medium !== undefined ||
      v.lightType !== undefined ||
      v.targetHarvestDate !== undefined ||
      v.archived !== undefined,
    { message: "supply at least one field to update" },
  );

export const ComparePlantsArgs = z.object({
  plantIds: z.array(z.string().min(1)).min(2).max(4),
  sinceDays: z.number().optional(),
});

export const GetGrowSummaryArgs = z.object({
  growId: z.string().min(1),
});

export const FindGrowArgs = z.object({
  query: z.string().min(1).max(120),
  includeArchived: z.boolean().optional(),
  limit: z.number().optional(),
});

export const FindPlantArgs = z.object({
  query: z.string().min(1).max(120),
  growId: z.string().min(1).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().optional(),
});

export const GetPlantTimelineArgs = z.object({
  plantId: z.string().min(1),
  limit: z.number().optional(),
});

export const TriggerPlantAnalysisArgs = z.object({
  plantId: z.string().min(1),
  imageId: z.string().min(1).optional(),
});

export const RecordImageFindingArgs = z.object({
  plantId: z.string().min(1),
  growId: z.string().min(1),
  category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(FINDING_SEVERITIES),
  title: z.string().min(1).max(200),
  description: z.string().max(MAX_NOTES_LENGTH).optional(),
  recommendation: z.string().max(MAX_NOTES_LENGTH).optional(),
  imageId: z.string().min(1).optional(),
});

export const UpdatePlantArgs = z
  .object({
    plantId: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    strain: z.string().max(120).optional(),
    batchLabel: z.string().max(120).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.strain !== undefined ||
      v.batchLabel !== undefined ||
      v.notes !== undefined ||
      v.archived !== undefined,
    { message: "supply at least one field to update" },
  );

export function buildBulkPlantNames(prefix: string, count: number): string[] {
  if (count <= 1) return [prefix];
  const pad = count >= 10 ? 2 : 1;
  return Array.from(
    { length: count },
    (_, i) => `${prefix} ${String(i + 1).padStart(pad, "0")}`,
  );
}

// PostgREST `ilike` requires us to escape the % and _ wildcards so a user
// query like "50%" matches the literal characters rather than acting as a
// wildcard. Belt-and-braces — also caps the query length to keep the LIKE
// pattern bounded.
export function escapeIlikePattern(input: string): string {
  return input.slice(0, 120).replace(/[%_\\]/g, (m) => `\\${m}`);
}

// Build a value safe to interpolate into a PostgREST `.or()` filter
// string. PostgREST's `.or()` parser treats `,` `.` `(` `)` `"` as
// reserved tokens that delimit predicates; if a raw ILIKE value contains
// any of them, the parser will split mid-value and an attacker (or a
// well-meaning user typing "50%, droopy") can graft an extra predicate
// onto the OR. Wrapping the value in double quotes opts the parser into
// literal-string mode, where the two characters that still need
// escaping are `"` (which would close the string) and `\` (the escape
// character itself). Escape both before wrapping; otherwise a bare `\`
// in the input would be consumed by the parser as the start of an
// escape sequence and the resulting ILIKE value would be wrong.
export function quotedIlikeOrValue(input: string): string {
  const escaped = escapeIlikePattern(input).replace(/[\\"]/g, "\\$&");
  return `"%${escaped}%"`;
}

// Tools whose names start the model down a write path. The executor logs
// arg keys (never values) for these so we have an audit trail without
// retaining free-text user content in the request log.
export const WRITE_TOOLS = new Set<string>([
  "log_grow_event",
  "log_plant_observation",
  "mark_finding_resolved",
  "update_grow_stage",
  "update_task_status",
  "create_grow",
  "create_plants",
  "create_grow_task",
  "update_grow",
  "update_plant",
  "record_image_finding",
  "trigger_plant_analysis",
]);
