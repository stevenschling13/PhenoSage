import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { getPlantTimeline, MAX_TIMELINE_LIMIT } from "@/lib/server/plants";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

// GET /api/plants/[plantId]/timeline
// Returns the ordered list of plant images + observations for a plant.
// Optional `?limit=N` (1..MAX_TIMELINE_LIMIT) caps the per-source row
// count so a plant with a long history never ships an unbounded JSON.
// Defaults to DEFAULT_TIMELINE_LIMIT.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const { plantId } = await params;

  // Parse the optional `?limit=N`. Validation policy: present but
  // non-integer or out-of-range yields 400 — silent coercion would
  // mask client bugs that we want to surface. Missing falls through
  // to the helper's default.
  let limit: number | undefined;
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const trimmed = rawLimit.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (
      !Number.isFinite(parsed) ||
      String(parsed) !== trimmed ||
      parsed < 1 ||
      parsed > MAX_TIMELINE_LIMIT
    ) {
      return attachRequestId(
        NextResponse.json(
          {
            error: `limit must be an integer between 1 and ${MAX_TIMELINE_LIMIT}.`,
            requestId,
          },
          { status: 400 },
        ),
        requestId,
      );
    }
    limit = parsed;
  }

  try {
    const timeline = await getPlantTimeline(
      plantId,
      limit !== undefined ? { limit } : {},
    );
    if (!timeline) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ ...timeline, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant timeline fetch failed", {
      requestId,
      plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to load timeline",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}
