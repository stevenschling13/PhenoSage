"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import {
  updateEmailPreferencesActionInitialState,
  type UpdateEmailPreferencesActionResult,
} from "./action-state";
import { updateEmailPreferencesAction } from "./actions";

const checkboxClassName =
  "h-4 w-4 rounded border-border/70 bg-surface text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

const SEVERITY_OPTIONS: Array<{
  value: "info" | "low" | "medium" | "high" | "critical";
  label: string;
}> = [
  { value: "info", label: "All severities" },
  { value: "low", label: "Low and above" },
  { value: "medium", label: "Medium and above" },
  { value: "high", label: "High and above" },
  { value: "critical", label: "Critical only (default)" },
];

export interface SettingsEmailFormProps {
  initialEmailDailySummary: boolean;
  initialEmailFindingAlerts: boolean;
  initialEmailAlertSeverityFloor:
    | "info"
    | "low"
    | "medium"
    | "high"
    | "critical";
}

export function SettingsEmailForm({
  initialEmailDailySummary,
  initialEmailFindingAlerts,
  initialEmailAlertSeverityFloor,
}: SettingsEmailFormProps) {
  const router = useRouter();
  const [state, setState] = useState<UpdateEmailPreferencesActionResult>(
    updateEmailPreferencesActionInitialState,
  );
  const [dailySummary, setDailySummary] = useState(initialEmailDailySummary);
  const [findingAlerts, setFindingAlerts] = useState(initialEmailFindingAlerts);
  const [severityFloor, setSeverityFloor] = useState(
    initialEmailAlertSeverityFloor,
  );
  const [isPending, startTransition] = useTransition();
  const messageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.message) messageRef.current?.focus();
  }, [state.message]);

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await updateEmailPreferencesAction(formData);
        setState(result);
        if (result.status === "success") router.refresh();
      } catch (err) {
        console.error("updateEmailPreferencesAction failed unexpectedly", err);
        setState({
          message:
            "Something went wrong saving your notification settings. Please try again in a moment.",
          status: "error",
        });
      }
    });
  }

  const isError = state.status === "error";

  return (
    <form action={handleAction} className="space-y-4" noValidate>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">
          Email channels
        </legend>
        <label className="flex items-start gap-3">
          <input
            checked={dailySummary}
            className={checkboxClassName}
            name="emailDailySummary"
            onChange={(event) => setDailySummary(event.target.checked)}
            type="checkbox"
          />
          <span className="text-sm text-foreground">
            Daily summary
            <span className="block text-xs text-muted-foreground">
              One email per day in your local timezone, sent only when
              there&#39;s new activity to report.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            checked={findingAlerts}
            className={checkboxClassName}
            name="emailFindingAlerts"
            onChange={(event) => setFindingAlerts(event.target.checked)}
            type="checkbox"
          />
          <span className="text-sm text-foreground">
            Finding alerts
            <span className="block text-xs text-muted-foreground">
              Real-time email when a high- or critical-severity finding is
              detected — useful for catching crop-loss issues early.
            </span>
          </span>
        </label>
      </fieldset>

      <div>
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="email-alert-severity-floor"
        >
          Alert email threshold
        </label>
        <select
          aria-describedby="email-alert-severity-floor-help"
          className="mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          disabled={!findingAlerts}
          id="email-alert-severity-floor"
          name="emailAlertSeverityFloor"
          onChange={(event) =>
            setSeverityFloor(
              event.target
                .value as SettingsEmailFormProps["initialEmailAlertSeverityFloor"],
            )
          }
          value={severityFloor}
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p
          className="mt-2 text-sm text-muted-foreground"
          id="email-alert-severity-floor-help"
        >
          Only findings at or above this severity trigger an email. In-app
          notifications are unaffected.
        </p>
      </div>

      {state.message ? (
        <div
          ref={messageRef}
          aria-live={isError ? "assertive" : "polite"}
          role={isError ? "alert" : "status"}
          tabIndex={-1}
          className={`rounded-[1.15rem] border px-4 py-3 text-sm focus:outline-none focus-visible:ring-2 ${
            isError
              ? "border-danger/20 bg-danger/10 text-danger focus-visible:ring-danger/40"
              : "border-success/20 bg-success/10 text-success focus-visible:ring-success/40"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} size="sm" type="submit" variant="surface">
          {isPending ? "Saving..." : "Save notifications"}
        </Button>
      </div>
    </form>
  );
}
