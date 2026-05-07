"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { createGrowAction, type CreateGrowState } from "./actions";

const STAGES: { value: string; label: string }[] = [
  { value: "germination", label: "Germination" },
  { value: "seedling", label: "Seedling" },
  { value: "vegetative", label: "Vegetative" },
  { value: "pre_flower", label: "Pre-flower" },
  { value: "flower", label: "Flower" },
  { value: "late_flower", label: "Late flower" },
  { value: "harvest", label: "Harvest" },
  { value: "dry_cure", label: "Dry / cure" },
];

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? "Creating…" : "Create grow"}
    </Button>
  );
}

export function NewGrowForm({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const [state, action] = useActionState<CreateGrowState, FormData>(
    createGrowAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className={className}>
        <Button
          size="sm"
          leftIcon={<PlusIcon width={16} height={16} />}
          onClick={() => setOpen(true)}
        >
          New grow
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-elevation-2",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            New grow
          </h3>
          <p className="text-xs text-muted-foreground">
            Give it a name and pick a stage. You can refine details later.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close form"
          onClick={() => setOpen(false)}
        >
          <CloseIcon width={16} height={16} />
        </Button>
      </div>

      <form ref={formRef} action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="grow-name">Name</Label>
          <Input
            ref={firstFieldRef}
            id="grow-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="Tent A — Blueberry"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grow-stage">Stage</Label>
          <select
            id="grow-stage"
            name="stage"
            defaultValue="seedling"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {state && !state.ok && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <CreateButton />
        </div>
      </form>
    </div>
  );
}
