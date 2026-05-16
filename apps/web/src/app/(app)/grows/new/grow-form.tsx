"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/form-error-summary";
import { useActionWithRecovery } from "@/lib/client/action-runner";
import { createGrowAction } from "../actions";
import {
  createGrowActionInitialState,
  type CreateGrowActionResult,
} from "../action-state";

const FIELD_META = {
  name: { label: "Grow name", targetId: "grow-name" },
  description: { label: "Description", targetId: "grow-description" },
  stage: { label: "Stage", targetId: "grow-stage" },
  medium: { label: "Medium", targetId: "grow-medium" },
  lightType: { label: "Light type", targetId: "grow-light-type" },
  startDate: { label: "Start date", targetId: "start-date" },
  targetHarvestDate: {
    label: "Target harvest date",
    targetId: "target-harvest-date",
  },
} as const;

function describedBy(id: string, hasError: boolean): string | undefined {
  return hasError ? `${id}-error` : undefined;
}

const growStages = [
  { label: "Germination", value: "germination" },
  { label: "Seedling", value: "seedling" },
  { label: "Vegetative", value: "vegetative" },
  { label: "Pre-flower", value: "pre_flower" },
  { label: "Flower", value: "flower" },
  { label: "Late flower", value: "late_flower" },
  { label: "Harvest", value: "harvest" },
  { label: "Dry / cure", value: "dry_cure" },
] as const;

const growMedia = [
  { label: "Soil", value: "soil" },
  { label: "Coco", value: "coco" },
  { label: "Hydro", value: "hydro" },
  { label: "Aero", value: "aero" },
  { label: "Living soil", value: "living_soil" },
  { label: "Other", value: "other" },
] as const;

const lightTypes = [
  { label: "LED", value: "led" },
  { label: "HPS", value: "hps" },
  { label: "CMH", value: "cmh" },
  { label: "T5", value: "t5" },
  { label: "Sun", value: "sun" },
  { label: "Mixed", value: "mixed" },
  { label: "Other", value: "other" },
] as const;

type Preset = {
  description: string;
  label: string;
  lightType: (typeof lightTypes)[number]["value"];
  medium: (typeof growMedia)[number]["value"];
  stage: (typeof growStages)[number]["value"];
};

const presets: Preset[] = [
  {
    description: "Most common indoor setup. Soil in fabric pots under LED.",
    label: "Indoor LED · soil",
    lightType: "led",
    medium: "soil",
    stage: "seedling",
  },
  {
    description: "Faster feeding loop in coco coir under LED.",
    label: "Indoor LED · coco",
    lightType: "led",
    medium: "coco",
    stage: "seedling",
  },
  {
    description: "Recirculating or DWC hydro with LED canopy lighting.",
    label: "Indoor LED · hydro",
    lightType: "led",
    medium: "hydro",
    stage: "seedling",
  },
  {
    description: "Outdoor or greenhouse soil under natural sun.",
    label: "Outdoor · sun",
    lightType: "sun",
    medium: "soil",
    stage: "vegetative",
  },
];

const inputClassName =
  "mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

function FieldError({
  fieldId,
  message,
}: {
  fieldId: string;
  message: string | undefined;
}) {
  if (!message) {
    return null;
  }

  return (
    <p id={`${fieldId}-error`} className="mt-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function GrowForm({ initialStartDate }: { initialStartDate: string }) {
  // useActionWithRecovery handles three failure modes for us:
  //   1. Transient throws (network blip, ChunkLoadError) are retried
  //      once with backoff before surfacing an error to the user.
  //   2. router.push failures don't strand the user — `state.recoveryUrl`
  //      always points at a known-good page, and the form renders a
  //      manual "Continue" CTA when navigation didn't take over.
  //   3. Validation / RLS errors flow through unchanged so field-level
  //      messages still render.
  // /grows is the universal fallback because it's the page the action
  // intends to land on anyway; any successful create is visible there.
  const {
    state,
    isPending,
    run: runCreateGrow,
  } = useActionWithRecovery<CreateGrowActionResult>(
    createGrowActionInitialState,
    { fallbackUrl: "/grows" },
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Preset["stage"]>("seedling");
  const [medium, setMedium] = useState<Preset["medium"]>("soil");
  const [lightType, setLightType] = useState<Preset["lightType"]>("led");
  const [startDate, setStartDate] = useState(initialStartDate);
  // The server renders `initialStartDate` from a UTC slice of `new Date()`,
  // which can be one day ahead of the user's local clock for negative-UTC
  // timezones late in the day. We hydrate with the SSR value to avoid a
  // hydration mismatch, then on mount swap in a locally-computed today —
  // but only if the user hasn't already edited the field. After the first
  // user edit `startDateAutoSyncedRef` flips and we never override their
  // input. This is a one-shot post-hydration sync to a browser-only value
  // (the user's local date), which is the canonical legitimate use of
  // setState-in-effect; the lint rule's general "avoid cascading renders"
  // guidance doesn't apply because the effect runs once and is gated.
  const startDateAutoSyncedRef = useRef(false);
  useEffect(() => {
    if (startDateAutoSyncedRef.current) return;
    startDateAutoSyncedRef.current = true;
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (localToday !== initialStartDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration sync to local timezone; see comment above.
      setStartDate(localToday);
    }
  }, [initialStartDate]);
  const [targetHarvestDate, setTargetHarvestDate] = useState("");
  const [activePresetLabel, setActivePresetLabel] = useState<string | null>(
    null,
  );

  function applyPreset(preset: Preset) {
    setStage(preset.stage);
    setMedium(preset.medium);
    setLightType(preset.lightType);
    setActivePresetLabel(preset.label);
  }

  async function handleAction(formData: FormData) {
    try {
      await runCreateGrow(() => createGrowAction(formData));
    } catch (err) {
      // The runner has already updated component state with an
      // error-shaped result + recoveryUrl. Re-throws here are expected
      // when retries are exhausted — log for diagnostics, don't crash.
      if (typeof console !== "undefined") {
        console.error("createGrowAction failed after retries", err);
      }
    }
  }

  return (
    <form action={handleAction} className="space-y-5" noValidate>
      <FormErrorSummary
        message={state.message}
        fieldErrors={state.fieldErrors}
        fieldMeta={FIELD_META}
      />

      {state.status === "success" && state.recoveryUrl ? (
        // Defence-in-depth recovery banner. router.push is fired by the
        // runner on success; if for any reason it didn't navigate (a
        // chunk error, a blocked transition, the user disabled JS
        // routing), this CTA is the manual continue. Once navigation
        // takes effect this component unmounts so the user never
        // notices it under happy-path conditions.
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-success/40 bg-success/10 px-4 py-4 text-sm leading-6 text-foreground"
          role="status"
        >
          <p className="font-medium">Grow created.</p>
          <p className="mt-1 text-muted-foreground">
            If your screen didn&apos;t move on its own, tap below to continue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              className={buttonStyles({ size: "sm" })}
              href={state.recoveryUrl}
            >
              Continue to grow registry
            </Link>
          </div>
        </div>
      ) : null}

      {state.status === "error" && state.recoveryUrl ? (
        // After a permanent error AND retries exhausted, give the user a
        // fallback page so they're never stranded on a dead form. The
        // fieldErrors above tell them what to fix; the link below tells
        // them where to go if they want to bail.
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
          Need to step away?{" "}
          <Link className="text-accent underline" href={state.recoveryUrl}>
            Open the grow registry
          </Link>{" "}
          — your form input stays here when you come back.
        </div>
      ) : null}

      <div
        aria-label="Quick-start presets"
        className="rounded-[1.15rem] border border-border/70 bg-background-subtle/40 px-4 py-4"
        role="group"
      >
        <p className="text-sm font-medium text-foreground">
          Quick-start a typical setup
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Tap a preset to fill stage, medium, and light — you can still tweak
          any field before saving.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((preset) => {
            const isActive = activePresetLabel === preset.label;
            return (
              <button
                aria-pressed={isActive}
                className={
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 " +
                  (isActive
                    ? "border-accent bg-accent/10 text-accent-strong"
                    : "border-border/80 bg-surface text-foreground hover:border-accent/60")
                }
                key={preset.label}
                onClick={() => applyPreset(preset)}
                title={preset.description}
                type="button"
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="grow-name"
        >
          Grow name
        </label>
        <input
          aria-describedby={describedBy(
            "grow-name",
            Boolean(state.fieldErrors?.name),
          )}
          aria-invalid={Boolean(state.fieldErrors?.name) || undefined}
          className={inputClassName}
          id="grow-name"
          maxLength={120}
          name="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="North tent A"
          required
          value={name}
        />
        <FieldError fieldId="grow-name" message={state.fieldErrors?.name} />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="grow-description"
        >
          Description
        </label>
        <textarea
          aria-describedby={describedBy(
            "grow-description",
            Boolean(state.fieldErrors?.description),
          )}
          aria-invalid={Boolean(state.fieldErrors?.description) || undefined}
          className={`${inputClassName} min-h-[120px] resize-y`}
          id="grow-description"
          maxLength={2_000}
          name="description"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Where this grow lives, the cultivar, or anything you'd want to remember later."
          value={description}
        />
        <FieldError
          fieldId="grow-description"
          message={state.fieldErrors?.description}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Optional. Use this for location, room constraints, or handoff notes
          (up to 2,000 characters).
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="grow-stage"
          >
            Stage
          </label>
          <select
            aria-describedby={describedBy(
              "grow-stage",
              Boolean(state.fieldErrors?.stage),
            )}
            aria-invalid={Boolean(state.fieldErrors?.stage) || undefined}
            className={inputClassName}
            id="grow-stage"
            name="stage"
            onChange={(event) => {
              setStage(event.target.value as Preset["stage"]);
              setActivePresetLabel(null);
            }}
            value={stage}
          >
            {growStages.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError fieldId="grow-stage" message={state.fieldErrors?.stage} />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="grow-medium"
          >
            Medium
          </label>
          <select
            aria-describedby={describedBy(
              "grow-medium",
              Boolean(state.fieldErrors?.medium),
            )}
            aria-invalid={Boolean(state.fieldErrors?.medium) || undefined}
            className={inputClassName}
            id="grow-medium"
            name="medium"
            onChange={(event) => {
              setMedium(event.target.value as Preset["medium"]);
              setActivePresetLabel(null);
            }}
            value={medium}
          >
            {growMedia.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError
            fieldId="grow-medium"
            message={state.fieldErrors?.medium}
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="grow-light-type"
          >
            Light type
          </label>
          <select
            aria-describedby={describedBy(
              "grow-light-type",
              Boolean(state.fieldErrors?.lightType),
            )}
            aria-invalid={Boolean(state.fieldErrors?.lightType) || undefined}
            className={inputClassName}
            id="grow-light-type"
            name="lightType"
            onChange={(event) => {
              setLightType(event.target.value as Preset["lightType"]);
              setActivePresetLabel(null);
            }}
            value={lightType}
          >
            {lightTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError
            fieldId="grow-light-type"
            message={state.fieldErrors?.lightType}
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="start-date"
          >
            Start date
          </label>
          <input
            aria-describedby={describedBy(
              "start-date",
              Boolean(state.fieldErrors?.startDate),
            )}
            aria-invalid={Boolean(state.fieldErrors?.startDate) || undefined}
            className={inputClassName}
            id="start-date"
            name="startDate"
            onChange={(event) => {
              startDateAutoSyncedRef.current = true;
              setStartDate(event.target.value);
            }}
            required
            type="date"
            value={startDate}
          />
          <FieldError
            fieldId="start-date"
            message={state.fieldErrors?.startDate}
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="target-harvest-date"
          >
            Target harvest date
          </label>
          <input
            aria-describedby={describedBy(
              "target-harvest-date",
              Boolean(state.fieldErrors?.targetHarvestDate),
            )}
            aria-invalid={
              Boolean(state.fieldErrors?.targetHarvestDate) || undefined
            }
            className={inputClassName}
            id="target-harvest-date"
            min={startDate || undefined}
            name="targetHarvestDate"
            onChange={(event) => setTargetHarvestDate(event.target.value)}
            type="date"
            value={targetHarvestDate}
          />
          <FieldError
            fieldId="target-harvest-date"
            message={state.fieldErrors?.targetHarvestDate}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
        <p
          aria-live="polite"
          className="text-sm leading-6 text-muted-foreground"
        >
          {isPending
            ? "Saving the grow..."
            : "Next: add your first plant so image history and assistant context have a home."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/grows"
          >
            Cancel
          </Link>
          <Button
            aria-busy={isPending || undefined}
            disabled={isPending}
            size="md"
            type="submit"
          >
            {isPending ? "Creating grow..." : "Create grow"}
          </Button>
        </div>
      </div>
    </form>
  );
}
