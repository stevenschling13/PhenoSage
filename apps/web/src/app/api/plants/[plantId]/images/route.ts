import { NextRequest, NextResponse } from "next/server";
import { UploadFinalizeRequestSchema, UuidSchema } from "@phenosage/shared";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import {
  enqueuePlantAnalysisJob,
  getPlantTimeline,
  persistPlantImageUpload,
} from "@/lib/server/plants";
import { apiError } from "@/lib/server/api-errors";
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
  if (!UuidSchema.safeParse(plantId).success) {
    return apiError(422, "UNPROCESSABLE_ENTITY", "Invalid plantId", requestId);
  }

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

    const images = timeline.items.filter((item) => item.type === "image");
    return attachRequestId(
      NextResponse.json({ plantId, images, requestId }),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant image listing failed", {
      requestId,
      plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return attachRequestId(
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to load plant images",
          requestId,
        },
        { status: 500 },
      ),
      requestId,
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return attachRequestId(
      NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 }),
      requestId,
    );
  }

  const user = await getServerUser();
  const rate = rateLimit({
    key: rateLimitKeyFromRequest(request, user?.id ?? null),
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return attachRequestId(
      NextResponse.json(
        {
          error: "Too many upload preparations. Try again shortly.",
          requestId,
        },
        { status: 429 },
      ),
      requestId,
    );
  }

  const { plantId } = await params;
  if (!UuidSchema.safeParse(plantId).success) {
    return apiError(422, "UNPROCESSABLE_ENTITY", "Invalid plantId", requestId);
  }

  const parsedBody = await parseJsonBody(request, UploadFinalizeRequestSchema);
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
    const prepared = await persistPlantImageUpload({
      imageId: parsedBody.data.imageId,
      plantId,
      ...(parsedBody.data.takenAt ? { takenAt: parsedBody.data.takenAt } : {}),
      ...(parsedBody.data.source ? { source: parsedBody.data.source } : {}),
      ...(parsedBody.data.notes ? { notes: parsedBody.data.notes } : {}),
      storagePath: parsedBody.data.storagePath,
    });

    if (!prepared) {
      return attachRequestId(
        NextResponse.json(
          { error: "Plant not found or access denied", requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    const job = await enqueuePlantAnalysisJob({
      plantId,
      imageId: parsedBody.data.imageId,
      requestId,
      ...(parsedBody.data.idempotencyKey
        ? { idempotencyKey: parsedBody.data.idempotencyKey }
        : {}),
    });

    return attachRequestId(
      NextResponse.json(
        {
          ...prepared,
          analysisJob: job
            ? {
                id: job.job.id,
                status: job.job.status,
                attemptCount: job.job.attempt_count,
                queuedAt: job.job.queued_at,
              }
            : null,
          requestId,
        },
        { status: 201 },
      ),
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "plant image finalize failed", {
      requestId,
      plantId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(500, "INTERNAL_ERROR", "Image finalize failed", requestId);
  }
}
