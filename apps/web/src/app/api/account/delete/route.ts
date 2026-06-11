import { NextRequest } from "next/server";
import { z } from "zod";
import { deleteAccount } from "@/lib/server/account";
import { apiError, apiSuccess } from "@/lib/server/api-errors";
import {
  createSupabaseServerClient,
  getServerSession,
  getServerUser,
} from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rate-limit";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";
import { parseJsonBody } from "@/lib/server/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/account/delete
//
// Permanently deletes the authenticated user's account: storage objects
// first, then the auth user (every DB row cascades — see migration
// 20260611160000). Requires the literal confirmation string so a
// stray fetch or CSRF-style trigger can't destroy an account; the
// session cookie alone is not enough.
const ConfirmSchema = z.object({ confirm: z.literal("DELETE") });

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  const session = await getServerSession();
  if (!session) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }
  const user = await getServerUser();
  if (!user) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized", requestId);
  }

  const rate = await rateLimit({
    key: `account-delete:${user.id}`,
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.ok) {
    return apiError(
      429,
      "RATE_LIMITED",
      "Too many deletion attempts. Try again in an hour.",
      requestId,
      { retryAfterSeconds: 3600 },
    );
  }

  const parsed = await parseJsonBody(request, ConfirmSchema);
  if (!parsed.ok) {
    return apiError(
      parsed.status,
      parsed.status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "UNPROCESSABLE_ENTITY",
      'Confirmation required: send { "confirm": "DELETE" }.',
      requestId,
    );
  }

  try {
    const result = await deleteAccount(user.id, requestId);

    // Best-effort sign-out to clear the now-dangling session cookies;
    // the auth user is already gone, so a failure here is harmless.
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Cookie cleanup only — the session is invalid either way.
    }

    return apiSuccess(
      200,
      {
        deleted: true,
        storage_objects_removed: result.deletedStorageObjects,
      },
      requestId,
    );
  } catch (error) {
    logServerEvent("error", "account delete failed", {
      requestId,
      userId: user.id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Account deletion failed. Please try again or contact the operator.",
      requestId,
    );
  }
}
