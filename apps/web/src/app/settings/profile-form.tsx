"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { updateProfileAction, type ProfileFormState } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

interface Props {
  email: string;
  initialDisplayName: string;
}

export function ProfileForm({ email, initialDisplayName }: Props) {
  const [state, action] = useActionState<ProfileFormState, FormData>(
    updateProfileAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly
          className="bg-muted/40"
        />
        <p className="text-xs text-muted-foreground">
          Used for login and alerts. Contact support to change.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          maxLength={80}
          defaultValue={initialDisplayName}
          placeholder="Your name"
          autoComplete="name"
        />
        <p className="text-xs text-muted-foreground">
          Shown on the dashboard and in shared grows.
        </p>
      </div>

      {state && (
        <div
          role={state.ok ? "status" : "alert"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm animate-fade-in",
            state.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {state.message}
        </div>
      )}

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </form>
  );
}
