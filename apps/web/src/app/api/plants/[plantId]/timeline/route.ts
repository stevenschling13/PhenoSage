import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { getPlantTimeline } from "@/lib/server/plants";
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

  try {
    const timeline = await getPlantTimeline(plantId);
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
