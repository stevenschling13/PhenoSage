import { UploadSignRequestSchema } from "@phenosage/shared";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { apiError } from "@/lib/server/api-errors";
import { preparePlantImageUpload } from "@/lib/server/plants";
import { rateLimit, rateLimitKeyFromRequest } from "@/lib/server/rate-limit";
import {
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
} from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const user = await getServerUser();
  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return apiError(429, "RATE_LIMITED", "Too many requests", requestId);
  }

  const parsedBody = await parseJsonBody(request, UploadSignRequestSchema);
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
    const prepared = await preparePlantImageUpload({
      ...parsedBody.data,
      requestId,
    });

    if (!prepared) {
      return apiError(
        404,
        "NOT_FOUND",
        "Plant not found or access denied",
        requestId,
      );
    }

    return attachRequestId(
      NextResponse.json({ ...prepared, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "upload signing failed", {
      requestId,
      plantId: parsedBody.data.plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Upload signing failed", requestId);
  }
}
