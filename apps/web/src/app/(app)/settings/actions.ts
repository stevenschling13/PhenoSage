"use server";

import { revalidatePath } from "next/cache";
import { getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { getDbClient } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/request-id";
import { isValidTimezone } from "@/lib/server/timezone";

export type UpdateDisplayNameActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateDisplayNameActionInitialState: UpdateDisplayNameActionResult =
  {
    status: "idle",
  };

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function updateDisplayNameAction(
  formData: FormData,
): Promise<UpdateDisplayNameActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to update your profile.",
      status: "error",
    };
  }

  const displayName = asTrimmedString(formData.get("displayName"));
  if (displayName.length > 60) {
    return {
      message: "Keep the display name under 60 characters.",
      status: "error",
    };
  }

  try {
    const db = getDbClient();
    const { error } = await db.from("profiles").upsert(
      {
        display_name: displayName || null,
        id: user.id,
      },
      { onConflict: "id" },
    );

    if (error) {
      logServerEvent("error", "update display name upsert failed", {
        error: error.message,
        userId: user.id,
      });
      return {
        message:
          error.code === "23505"
            ? "That display name is already in use."
            : `Could not save the display name: ${error.message}`,
        status: "error",
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/settings");

    return {
      message: displayName
        ? "Display name saved."
        : "Display name cleared. Email will be used as the fallback label.",
      status: "success",
    };
  } catch (err) {
    // Re-throw Next framework control-flow signals untouched.
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "update display name action threw", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      message:
        "We couldn't save your display name right now. Please try again in a moment.",
      status: "error",
    };
  }
}

// ─── Timezone preference ─────────────────────────────────────────────

export type UpdateTimezoneActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateTimezoneActionInitialState: UpdateTimezoneActionResult = {
  status: "idle",
};

// Friendly copy for the SQLSTATE codes this path can plausibly throw.
// `22023` is the migration's validation trigger telling us the IANA
// name is unrecognised — surface that in user copy. Everything else
// follows the same pattern createGrowAction uses (no raw provider
// text reaches the client).
const TIMEZONE_SQLSTATE_COPY: Record<string, string> = {
  "22023": "We don't recognise that timezone. Please pick one from the list.",
  "42501":
    "You don't have permission to update this preference. Please refresh and sign in again.",
  "23503":
    "Your account couldn't be linked to a preference row. Please refresh and try again.",
  "57014": "The save took too long. Please try again in a moment.",
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

export async function updateTimezoneAction(
  formData: FormData,
): Promise<UpdateTimezoneActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to update your timezone.",
      status: "error",
    };
  }

  const timezone = asTrimmedString(formData.get("timezone"));
  if (!timezone) {
    return {
      message: "Pick a timezone from the list before saving.",
      status: "error",
    };
  }
  // Validate at the edge so an obviously bad value never reaches Postgres.
  // The migration trigger is the authoritative check (race-safe), this
  // is just a friendlier failure path for the common case.
  if (!isValidTimezone(timezone)) {
    return {
      message:
        "We don't recognise that timezone. Please pick one from the list.",
      status: "error",
    };
  }

  try {
    const db = getDbClient();
    const { error } = await db.from("user_preferences").upsert(
      {
        user_id: user.id,
        timezone,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      logServerEvent("error", "update timezone upsert failed", {
        error: error.message,
        code: error.code,
        userId: user.id,
      });
      const mapped = error.code
        ? TIMEZONE_SQLSTATE_COPY[error.code]
        : undefined;
      return {
        message:
          mapped ??
          "We couldn't save your timezone right now. Please try again in a moment.",
        status: "error",
      };
    }

    revalidatePath("/settings");

    return {
      message: `Timezone saved (${timezone}).`,
      status: "success",
    };
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "update timezone action threw", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      message:
        "We couldn't save your timezone right now. Please try again in a moment.",
      status: "error",
    };
  }
}

// ─── Email-notification preferences (Tier 2.2) ───────────────────────

export type UpdateEmailPreferencesActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateEmailPreferencesActionInitialState: UpdateEmailPreferencesActionResult =
  {
    status: "idle",
  };

const VALID_EMAIL_SEVERITY_FLOORS = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

// Friendly copy mirrors the timezone path. `23514` is the migration's
// CHECK constraint on `email_alert_severity_floor` — we already
// validate at the edge, but the constraint is the authoritative guard
// in case someone POSTs raw form data outside the UI.
const EMAIL_PREFS_SQLSTATE_COPY: Record<string, string> = {
  "23514":
    "We couldn't save those notification settings — please pick a valid severity.",
  "42501":
    "You don't have permission to update this preference. Please refresh and sign in again.",
  "23503":
    "Your account couldn't be linked to a preference row. Please refresh and try again.",
  "57014": "The save took too long. Please try again in a moment.",
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

export async function updateEmailPreferencesAction(
  formData: FormData,
): Promise<UpdateEmailPreferencesActionResult> {
  const user = await getServerUser();
  if (!user) {
    return {
      message: "You must be signed in to update your notification settings.",
      status: "error",
    };
  }

  // Checkboxes only POST when checked — read presence rather than value
  // so the absence of a key means "off". This mirrors how Next's
  // `useActionState` ferries form data from a plain HTML form.
  const dailySummary = formData.get("emailDailySummary") !== null;
  const findingAlerts = formData.get("emailFindingAlerts") !== null;
  const severityFloor = asTrimmedString(
    formData.get("emailAlertSeverityFloor"),
  );

  if (severityFloor && !VALID_EMAIL_SEVERITY_FLOORS.has(severityFloor)) {
    return {
      message:
        "Pick a valid severity floor (info, low, medium, high, critical).",
      status: "error",
    };
  }

  try {
    const db = getDbClient();
    const { error } = await db.from("user_preferences").upsert(
      {
        user_id: user.id,
        email_daily_summary: dailySummary,
        email_finding_alerts: findingAlerts,
        // Default to `critical` if the form omitted the field — matches
        // DEFAULT_USER_PREFERENCES so a user who never saw the radio
        // group still ends up in a sane state.
        email_alert_severity_floor: severityFloor || "critical",
      },
      { onConflict: "user_id" },
    );

    if (error) {
      logServerEvent("error", "update email prefs upsert failed", {
        error: error.message,
        code: error.code,
        userId: user.id,
      });
      const mapped = error.code
        ? EMAIL_PREFS_SQLSTATE_COPY[error.code]
        : undefined;
      return {
        message:
          mapped ??
          "We couldn't save your notification settings right now. Please try again in a moment.",
        status: "error",
      };
    }

    revalidatePath("/settings");

    return {
      message: "Notification settings saved.",
      status: "success",
    };
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    logServerEvent("error", "update email prefs action threw", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      message:
        "We couldn't save your notification settings right now. Please try again in a moment.",
      status: "error",
    };
  }
}
