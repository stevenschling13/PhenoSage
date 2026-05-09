"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  updateDisplayNameAction,
  updateDisplayNameActionInitialState,
  type UpdateDisplayNameActionResult,
} from "./actions";

const inputClassName =
  "mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

export function SettingsProfileForm({
  email,
  initialDisplayName,
}: {
  email: string;
  initialDisplayName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<UpdateDisplayNameActionResult>(
    updateDisplayNameActionInitialState,
  );
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [isPending, startTransition] = useTransition();
  const messageRef = useRef<HTMLDivElement | null>(null);

  // Focus the status panel when a result lands so screen readers announce it
  // and keyboard users land on the feedback rather than hunting for it.
  useEffect(() => {
    if (state.message) {
      messageRef.current?.focus();
    }
  }, [state.message]);

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      const result = await updateDisplayNameAction(formData);
      setState(result);
      if (result.status === "success") {
        router.refresh();
      }
    });
  }

  const isError = state.status === "error";

  return (
    <form action={handleAction} className="space-y-4" noValidate>
      <div>
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="account-email"
        >
          Authenticated email
        </label>
        <input
          className={`${inputClassName} text-muted-foreground`}
          id="account-email"
          readOnly
          value={email}
        />
      </div>
      <div>
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="display-name"
        >
          Display name
        </label>
        <input
          aria-describedby="display-name-help"
          aria-invalid={isError || undefined}
          className={inputClassName}
          id="display-name"
          maxLength={60}
          name="displayName"
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="How your workspace should label you"
          value={displayName}
        />
        <p
          className="mt-2 text-sm text-muted-foreground"
          id="display-name-help"
        >
          This label appears in the dashboard and workspace shell. Leave it
          blank to fall back to your email-derived operator name. Maximum 60
          characters.
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
          {isPending ? "Saving..." : "Save display name"}
        </Button>
      </div>
    </form>
  );
}
