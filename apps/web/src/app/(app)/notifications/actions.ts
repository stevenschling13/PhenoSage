"use server";

import { revalidatePath } from "next/cache";

import { isNextFrameworkError } from "@/lib/server/auth-errors";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationActionResult,
} from "@/lib/server/notifications";
import { logServerEvent } from "@/lib/server/request-id";

// Both actions follow the React 19 / Next.js 16 typed-Result pattern:
// they never throw for business-logic failures (validation, RLS,
// missing rows). Throws are reserved for true infrastructure faults,
// which the surrounding error boundary will pick up.

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  try {
    const result = await markNotificationRead(notificationId);
    if (result.ok) {
      revalidatePath("/notifications");
      revalidatePath("/dashboard");
    }
    return result;
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "markNotificationReadAction threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: "unknown",
      message: "We couldn't update that notification. Please retry.",
    };
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  try {
    const result = await markAllNotificationsRead();
    if (result.ok) {
      revalidatePath("/notifications");
      revalidatePath("/dashboard");
    }
    return result;
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "markAllNotificationsReadAction threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: "unknown",
      message: "We couldn't update notifications. Please retry.",
    };
  }
}
