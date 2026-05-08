import { UuidSchema } from "@phenosage/shared";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { runAndPersistPlantAnalysis } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

const AnalyzeRequestSchema = z.object({ imageId: UuidSchema.optional() });

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
    const result = await runAndPersistPlantAnalysis({
      plantId,
      ...(parsedBody.data.imageId ? { imageId: parsedBody.data.imageId } : {}),
      requestId,
    });

    if (!result)
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
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
    logServerEvent("error", "plant analysis failed", {
      requestId,
      plantId,
      imageId: parsedBody.data.imageId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Plant analysis failed", requestId);
  }
}
