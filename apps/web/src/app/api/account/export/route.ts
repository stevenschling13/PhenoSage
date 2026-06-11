import { NextRequest, NextResponse } from "next/server";
import { exportAccountData } from "@/lib/server/account";
import { apiError } from "@/lib/server/api-errors";
import { getServerSession, getServerUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/account/export
//
// Data-portability export: everything the authenticated user can see,
// as a downloadable JSON file. Queries run on the session client so
// RLS is the authorization boundary. Rate-limited — assembling the
// export fans out one query per table.
export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const user = await getServerUser();
  const rate = await rateLimit({
    key: `account-export:${user?.id ?? "anon"}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many export requests. Try again in an hour.",
      requestId,
      { retryAfterSeconds: 3600 },
    );
  }

  try {
    const data = await exportAccountData();
    if (!data) {
      return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
    }
    const filename = `phenosage-export-${data.exportedAt.slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    logServerEvent("error", "account export failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Export failed. Please try again.",
      requestId,
    );
  }
}
