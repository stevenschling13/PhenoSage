import "server-only";
import type {
  AnalysisFinding,
  FindingResolutionState,
  GrowTask,
} from "@phenosage/shared";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";

// ─── Triage Inbox ──────────────────────────────────────────────────────────
//
// Cross-grow "what needs my attention" view. Pulls pending AI findings
// (resolution_state = 'pending') and open/in-progress tasks across every
// grow the current user belongs to, joined with grow + plant context so
// the UI doesn't need to follow up with N name lookups.
//
// Authorization is enforced entirely by RLS via the user-scoped supabase
// client — there is no manual grow-membership filter here. If a user is
// removed from a grow mid-session, the next render correctly hides those
// rows.

const PENDING_STATE: FindingResolutionState = "pending";

type GrowRow = {
  id: string;
  name: string;
};

type PlantRow = {
  id: string;
  name: string;
  grow_id: string;
};

type FindingRow = {
  id: string;
  plant_id: string;
  grow_id: string;
  image_id: string | null;
  category: AnalysisFinding["category"];
  severity: AnalysisFinding["severity"];
  confidence_score: number | null;
  title: string;
  description: string;
  recommendation: string | null;
  source: NonNullable<AnalysisFinding["source"]>;
  resolution_state: NonNullable<AnalysisFinding["resolutionState"]>;
  resolution_note: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  grow_id: string;
  plant_id: string | null;
  finding_id: string | null;
  title: string;
  description: string | null;
  priority: GrowTask["priority"];
  status: GrowTask["status"];
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export interface TriageFinding {
  id: string;
  plantId: string;
  plantName: string;
  growId: string;
  growName: string;
  category: AnalysisFinding["category"];
  severity: AnalysisFinding["severity"];
  title: string;
  description: string;
  recommendation?: string;
  resolutionState: FindingResolutionState;
  createdAt: string;
}

export interface TriageTask {
  id: string;
  plantId?: string;
  plantName?: string;
  growId: string;
  growName: string;
  findingId?: string;
  title: string;
  description?: string;
  priority: GrowTask["priority"];
  status: GrowTask["status"];
  dueAt?: string;
  createdAt: string;
}

export interface TriageInbox {
  findings: TriageFinding[];
  tasks: TriageTask[];
}

const EMPTY_INBOX: TriageInbox = { findings: [], tasks: [] };

// Stable severity / priority rank so the inbox shows the most urgent
// item first regardless of which row the caller iterates.
const SEVERITY_RANK: Record<AnalysisFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const PRIORITY_RANK: Record<GrowTask["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export async function getTriageInbox(): Promise<TriageInbox> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "triage inbox client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_INBOX;
  }

  // Per-source soft-degrade: a single failing query never takes down the
  // page. Mirrors the workspace-overview pattern.
  const [growsSettled, plantsSettled, findingsSettled, tasksSettled] =
    await Promise.allSettled([
      supabase.from("grows").select("id,name"),
      supabase.from("plants").select("id,name,grow_id").limit(500),
      supabase
        .from("plant_findings")
        .select(
          "id,plant_id,grow_id,image_id,category,severity,confidence_score,title,description,recommendation,source,resolution_state,resolution_note,created_at",
        )
        .eq("resolution_state", PENDING_STATE)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("grow_tasks")
        .select("*")
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  function unwrap<T>(
    label: string,
    settled: PromiseSettledResult<{
      data: T[] | null;
      error: { message: string } | null;
    }>,
  ): T[] {
    if (settled.status === "rejected") {
      logServerEvent("error", "triage inbox query rejected", {
        source: label,
        error:
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason),
      });
      return [];
    }
    if (settled.value.error) {
      logServerEvent("error", "triage inbox query failed", {
        source: label,
        error: settled.value.error.message,
      });
      return [];
    }
    return settled.value.data ?? [];
  }

  const grows = unwrap<GrowRow>("grows", growsSettled);
  const plants = unwrap<PlantRow>("plants", plantsSettled);
  const findings = unwrap<FindingRow>("plant_findings", findingsSettled);
  const tasks = unwrap<TaskRow>("grow_tasks", tasksSettled);

  const growNameById = new Map(grows.map((g) => [g.id, g.name]));
  const plantNameById = new Map(plants.map((p) => [p.id, p.name]));

  const triageFindings: TriageFinding[] = findings
    .map((row) => {
      const finding: TriageFinding = {
        id: row.id,
        plantId: row.plant_id,
        plantName: plantNameById.get(row.plant_id) ?? "Unknown plant",
        growId: row.grow_id,
        growName: growNameById.get(row.grow_id) ?? "Unknown grow",
        category: row.category,
        severity: row.severity,
        title: row.title,
        description: row.description,
        resolutionState: row.resolution_state,
        createdAt: row.created_at,
      };
      if (row.recommendation) finding.recommendation = row.recommendation;
      return finding;
    })
    .sort((a, b) => {
      const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rank !== 0) return rank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const triageTasks: TriageTask[] = tasks
    .map((row) => {
      const task: TriageTask = {
        id: row.id,
        growId: row.grow_id,
        growName: growNameById.get(row.grow_id) ?? "Unknown grow",
        title: row.title,
        priority: row.priority,
        status: row.status,
        createdAt: row.created_at,
      };
      if (row.plant_id) {
        task.plantId = row.plant_id;
        task.plantName = plantNameById.get(row.plant_id) ?? "Unknown plant";
      }
      if (row.finding_id) task.findingId = row.finding_id;
      if (row.description) task.description = row.description;
      if (row.due_at) task.dueAt = row.due_at;
      return task;
    })
    .sort((a, b) => {
      const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (rank !== 0) return rank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return { findings: triageFindings, tasks: triageTasks };
}
