import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import {
  createSupabaseServerClient,
  getServerSession,
} from "@/lib/server/auth";
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

const PathParamsSchema = z.object({
  plantId: z.string().uuid(),
  findingId: z.string().uuid(),
});

const ResolutionStateSchema = z.enum([
  "pending",
  "confirmed",
  "rejected",
  "false_positive",
]);

const ResolutionBodySchema = z.object({
  state: ResolutionStateSchema,
  // UI-side cap to match the migration's 2000-char db check with headroom.
  note: z.string().trim().max(500).optional(),
});

interface RouteParams {
  params: Promise<{ plantId: string; findingId: string }>;
}

/**
 * PATCH /api/plants/[plantId]/findings/[findingId]/resolution
 *
 * Records a user's confidence-ledger decision on an AI finding:
 * confirm / reject / mark as false positive, with an optional note.
 * The migration 20260519180000 trigger auto-dismisses the linked
 * grow_task when state flips to rejected or false_positive.
 *
 * Auth: owner + collaborator (RLS enforces).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const parsedPath = PathParamsSchema.safeParse(await params);
  if (!parsedPath.success) {
    return apiError(
      400,
      "BAD_REQUEST",
      "Invalid plant or finding id",
      requestId,
    );
  }

  const rate = await rateLimit({
    key: `finding-resolution:${rateLimitKeyFromRequest(request, session.user.id)}`,
    // Plenty of headroom for batch-confirming a backlog without enabling
    // a scripted thrash. Resolution is a single-row update; cost is low.
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many resolution updates. Try again shortly.",
      requestId,
      { retryAfterSeconds: 10 },
    );
  }

  const parsedBody = await parseJsonBody(request, ResolutionBodySchema);
  if (!parsedBody.ok) {
    return apiError(
      parsedBody.status,
      parsedBody.status === 415
        ? "UNSUPPORTED_MEDIA_TYPE"
        : "UNPROCESSABLE_ENTITY",
      parsedBody.error,
      requestId,
    );
  }

  const context = await getAuthorizedPlantContext(parsedPath.data.plantId);
  if (!context) {
    return apiError(
      404,
      "NOT_FOUND",
      "Plant not found or access denied",
      requestId,
    );
  }

  // User-scoped client → RLS enforces the migration 007 contributor policy.
  // Viewers get a 0-row UPDATE which we surface as 403 below.
  const supabase = await createSupabaseServerClient();
  const update = {
    resolution_state: parsedBody.data.state,
    // pending clears any stale note; otherwise coerce empty / whitespace-only
    // notes (which Zod's .trim() turns into "") to null via ||, so downstream
    // filters can rely on null == "no note".
    resolution_note:
      parsedBody.data.state === "pending" ? null : parsedBody.data.note || null,
  };

  const { data, error } = await supabase
    .from("plant_findings")
    .update(update)
    .eq("id", parsedPath.data.findingId)
    .eq("plant_id", context.plantId)
    .select("id, resolution_state, resolution_note")
    .maybeSingle();

  if (error) {
    const denied =
      error.code === "42501" ||
      /permission denied|row-level security/i.test(error.message ?? "");
    logServerEvent("warn", "finding resolution update failed", {
      requestId,
      plantId: context.plantId,
      findingId: parsedPath.data.findingId,
      code: error.code ?? null,
      denied,
    });
    if (denied) {
      return apiError(
        403,
        "FORBIDDEN",
        "You do not have permission to update findings on this grow.",
        requestId,
      );
    }
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Failed to update finding resolution.",
      requestId,
    );
  }

  if (!data) {
    // RLS returned 0 rows: either the finding doesn't belong to this plant
    // (404 semantics) or the user is a viewer (which the policy excludes,
    // returning 0 rows on UPDATE rather than a 42501 error). Both collapse
    // to NOT_FOUND so we don't disclose existence to viewers.
    return apiError(
      404,
      "NOT_FOUND",
      "Finding not found or access denied",
      requestId,
    );
  }

  return apiSuccess(
    200,
    {
      id: data.id as string,
      resolutionState: data.resolution_state as z.infer<
        typeof ResolutionStateSchema
      >,
      resolutionNote: (data.resolution_note as string | null) ?? undefined,
    },
    requestId,
  );
}
