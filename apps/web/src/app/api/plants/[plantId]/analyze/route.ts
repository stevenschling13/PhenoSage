import { NextRequest } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { runAndPersistPlantAnalysis } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const user = await getServerUser();
  const rate = await rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many analysis requests. Try again shortly.",
      requestId,
      { retryAfterSeconds: 30 },
    );
  }

  const { plantId } = await params;
  const body = (await request.json().catch(() => ({}))) as { imageId?: string };

  try {
    const result = await runAndPersistPlantAnalysis({
      plantId,
      ...(body.imageId ? { imageId: body.imageId } : {}),
      requestId,
    });

    if (!result) {
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
    }

    if (!result.analysis) {
      return apiError(
        404,
        "NOT_FOUND",
        "No plant images are available to analyze",
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ analysis: result.analysis, requestId }),
      requestId,
    );
  } catch (error) {
    // Log the underlying cause for operators but never echo the raw exception
    // text to the browser — it can include "fetch failed", upstream URLs, env
    // variable names, or stack-trace fragments.
    logServerEvent("error", "plant analysis failed", {
      requestId,
      plantId,
      imageId: body.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Plant analysis failed. Please try again.",
      requestId,
    );
  }
}
