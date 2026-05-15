"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  updateTimezoneAction,
  updateTimezoneActionInitialState,
  type UpdateTimezoneActionResult,
} from "./actions";

const inputClassName =
  "mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

// Build the IANA timezone list at runtime so the component stays in
// sync with whatever Node/ICU build is shipped with the deployed
// runtime. `supportedValuesOf` is in every Node ≥ 18 baseline.
function loadZoneList(): string[] {
  const supported = (
    Intl as { supportedValuesOf?: (_k: "timeZone") => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      // Falls through to the minimal fallback below.
    }
  }
  // Tiny fallback covering the major continental zones so the dropdown
  // still works on a runtime that doesn't expose `supportedValuesOf`.
  return [
    "UTC",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
  ];
}

function buildZoneList(initialTimezone: string): string[] {
  const all = loadZoneList();
  if (initialTimezone && !all.includes(initialTimezone))
    all.unshift(initialTimezone);
  return all;
}

export function SettingsTimezoneForm({
  initialTimezone,
}: {
  initialTimezone: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<UpdateTimezoneActionResult>(
    updateTimezoneActionInitialState,
  );
  const [timezone, setTimezone] = useState(initialTimezone || "UTC");
  // Zone list is computed lazily once at mount. `Intl.supportedValuesOf`
  // works on the SSR server (Node ≥ 18) and the client, so the initial
  // render shape matches and React doesn't re-hydrate the dropdown.
  const [zones] = useState<string[]>(() => buildZoneList(initialTimezone));
  const [isPending, startTransition] = useTransition();
  const messageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.message) messageRef.current?.focus();
  }, [state.message]);

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await updateTimezoneAction(formData);
        setState(result);
        if (result.status === "success") router.refresh();
      } catch (err) {
        console.error("updateTimezoneAction failed unexpectedly", err);
        setState({
          message:
            "Something went wrong saving your timezone. Please try again in a moment.",
          status: "error",
        });
      }
    });
  }

  const isError = state.status === "error";

  return (
    <form action={handleAction} className="space-y-4" noValidate>
      <div>
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="user-timezone"
        >
          Timezone
        </label>
        <select
          aria-describedby="user-timezone-help"
          aria-invalid={isError || undefined}
          className={inputClassName}
          id="user-timezone"
          name="timezone"
          onChange={(event) => setTimezone(event.target.value)}
          value={timezone}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p
          className="mt-2 text-sm text-muted-foreground"
          id="user-timezone-help"
        >
          Your daily summary uses this timezone to decide what counts as
          “today”. UTC is used until you pick one.
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
          {isPending ? "Saving..." : "Save timezone"}
        </Button>
      </div>
    </form>
  );
}
