import { UuidSchema } from "@phenosage/shared";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { getLatestPlantAnalysis } from "@/lib/server/plants";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

// GET /api/plants/[plantId]/analysis/latest
// Returns the most recent AnalysisResponse for a plant.
// Proxied through Next.js — the browser never calls the analysis service directly.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      apiError(401, "UNAUTHORIZED", "Unauthorized", requestId),
      requestId,
    );
  }

  const { plantId } = await params;
  if (!UuidSchema.safeParse(plantId).success) {
    return apiError(422, "UNPROCESSABLE_ENTITY", "Invalid plantId", requestId);
  }

  try {
    const analysis = await getLatestPlantAnalysis(plantId);
    if (!analysis) {
      return attachRequestId(
        NextResponse.json(
          { plantId, analysis: null, requestId },
          { status: 200 },
        ),
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ plantId, analysis, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "latest plant analysis fetch failed", {
      requestId,
      plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      apiError(
        500,
        "INTERNAL_ERROR",
        "Failed to load latest analysis",
        requestId,
      ),
      requestId,
    );
  }
}
