import { AnalyzeRequestSchema, UuidSchema } from "@phenosage/shared";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { enqueuePlantAnalysisJob } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

interface RouteParams {
  params: Promise<{ plantId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);

  const user = await getServerUser();
  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 5,
    windowMs: 60_000,
  });
  if (!rate.ok)
    return apiError(429, "RATE_LIMITED", "Too many requests", requestId);

  const { plantId } = await params;
  if (!UuidSchema.safeParse(plantId).success) {
    return apiError(422, "UNPROCESSABLE_ENTITY", "Invalid plantId", requestId);
  }

  const parsedBody = await parseJsonBody(request, AnalyzeRequestSchema);
  if (!parsedBody.ok) {
    if (parsedBody.status === 415) {
      return apiError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        parsedBody.error,
        requestId,
      );
    }
    if (parsedBody.status === 422) {
      return apiError(422, "UNPROCESSABLE_ENTITY", parsedBody.error, requestId);
    }
    return apiError(400, "BAD_REQUEST", parsedBody.error, requestId);
  }

  try {
    const result = await enqueuePlantAnalysisJob({
      plantId,
      imageId: parsedBody.data.imageId,
      ...(parsedBody.data.idempotencyKey
        ? { idempotencyKey: parsedBody.data.idempotencyKey }
        : {}),
      requestId,
    });

    if (!result)
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
    return attachRequestId(
      NextResponse.json(
        {
          analysisJob: {
            id: result.job.id,
            imageId: result.job.image_id,
            status: result.job.status,
            attemptCount: result.job.attempt_count,
            queuedAt: result.job.queued_at,
          },
          requestId,
        },
        { status: 202 },
      ),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant analysis failed", {
      requestId,
      plantId,
      imageId: parsedBody.data.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Plant analysis failed", requestId);
  }
}
