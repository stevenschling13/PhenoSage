import "server-only";
import { createSupabaseServerClient } from "./auth";
import { logServerEvent } from "./request-id";
import type { GrowContextSummary } from "./chat-prompt";

type GrowRow = {
  id: string;
  name: string;
  stage: string | null;
  medium: string | null;
  light_type: string | null;
  start_date: string | null;
};

type FindingRow = {
  title: string;
  category: string;
  severity: string;
  created_at: string;
  plants: { name: string } | { name: string }[] | null;
};

function daysSince(startDate: string | null): number | null {
  if (!startDate) return null;
  const start = new Date(startDate).getTime();
  if (Number.isNaN(start)) return null;
  const diff = Date.now() - start;
  if (diff < 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export async function loadGrowContextSummary(
  growId: string | null,
): Promise<GrowContextSummary | null> {
  if (!growId) return null;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "chat context client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const { data: grow, error: growErr } = await supabase
    .from("grows")
    .select("id,name,stage,medium,light_type,start_date")
    .eq("id", growId)
    .maybeSingle();

  if (growErr || !grow) {
    if (growErr) {
      logServerEvent("error", "chat context grow lookup failed", {
        error: growErr.message,
        growId,
      });
    }
    return null;
  }

  const g = grow as GrowRow;

  const { count: plantCount } = await supabase
    .from("plants")
    .select("id", { count: "exact", head: true })
    .eq("grow_id", g.id)
    .eq("is_archived", false);

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: findings, error: findingsErr } = await supabase
    .from("plant_findings")
    .select("title,category,severity,created_at,plants(name)")
    .eq("grow_id", g.id)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(10);

  if (findingsErr) {
    logServerEvent("error", "chat context findings lookup failed", {
      error: findingsErr.message,
      growId,
    });
  }

  const recentFindings = ((findings ?? []) as FindingRow[]).map((f) => {
    const plantsField = f.plants;
    const plantName = Array.isArray(plantsField)
      ? (plantsField[0]?.name ?? null)
      : (plantsField?.name ?? null);
    return {
      title: f.title,
      category: f.category,
      severity: f.severity,
      plantName,
      createdAt: f.created_at,
    };
  });

  return {
    growId: g.id,
    name: g.name,
    stage: g.stage,
    medium: g.medium,
    lightType: g.light_type,
    startDate: g.start_date,
    daysSinceStart: daysSince(g.start_date),
    plantCount: plantCount ?? 0,
    recentFindings,
  };
}
