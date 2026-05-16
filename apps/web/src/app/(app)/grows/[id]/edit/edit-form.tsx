"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/form-error-summary";
import { useActionWithRecovery } from "@/lib/client/action-runner";
import {
  updateGrowActionInitialState,
  type UpdateGrowActionResult,
} from "../action-state";
import { updateGrowAction } from "../actions";

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

const inputClassName =
  "mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

function describedBy(id: string, hasError: boolean): string | undefined {
  return hasError ? `${id}-error` : undefined;
}

function FieldError({
  fieldId,
  message,
}: {
  fieldId: string;
  message: string | undefined;
}) {
  if (!message) return null;
  return (
    <p id={`${fieldId}-error`} className="mt-2 text-sm text-danger">
      {message}
    </p>
  );
}

export interface EditGrowFormInitial {
  description: string;
  lightType: (typeof lightTypes)[number]["value"];
  medium: (typeof growMedia)[number]["value"];
  name: string;
  stage: (typeof growStages)[number]["value"];
  startDate: string;
  targetHarvestDate: string;
}

export function EditGrowForm({
  growId,
  initial,
}: {
  growId: string;
  initial: EditGrowFormInitial;
}) {
  // Same recovery story as create-grow: transient throws retry once,
  // permanent errors keep the user on the form with a clear escape
  // hatch back to the detail page (their input is preserved).
  const {
    state,
    isPending,
    run: runUpdate,
  } = useActionWithRecovery<UpdateGrowActionResult>(
    updateGrowActionInitialState,
    { fallbackUrl: `/grows/${growId}` },
  );

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [stage, setStage] = useState<EditGrowFormInitial["stage"]>(
    initial.stage,
  );
  const [medium, setMedium] = useState<EditGrowFormInitial["medium"]>(
    initial.medium,
  );
  const [lightType, setLightType] = useState<EditGrowFormInitial["lightType"]>(
    initial.lightType,
  );
  const [startDate, setStartDate] = useState(initial.startDate);
  const [targetHarvestDate, setTargetHarvestDate] = useState(
    initial.targetHarvestDate,
  );

  async function handleAction(formData: FormData) {
    try {
      await runUpdate(() => updateGrowAction(growId, formData));
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("updateGrowAction failed after retries", err);
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
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-success/40 bg-success/10 px-4 py-4 text-sm leading-6 text-foreground"
          role="status"
        >
          <p className="font-medium">Grow updated.</p>
          <p className="mt-1 text-muted-foreground">
            If your screen didn&apos;t move on its own, tap below to continue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              className={buttonStyles({ size: "sm" })}
              href={state.recoveryUrl}
            >
              Back to grow
            </Link>
          </div>
        </div>
      ) : null}

      {state.status === "error" && state.recoveryUrl ? (
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
          Need to step away?{" "}
          <Link className="text-accent underline" href={state.recoveryUrl}>
            Back to the grow
          </Link>{" "}
          — your form input stays here when you come back.
        </div>
      ) : null}

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
            onChange={(event) =>
              setStage(event.target.value as EditGrowFormInitial["stage"])
            }
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
            onChange={(event) =>
              setMedium(event.target.value as EditGrowFormInitial["medium"])
            }
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
            onChange={(event) =>
              setLightType(
                event.target.value as EditGrowFormInitial["lightType"],
              )
            }
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
            onChange={(event) => setStartDate(event.target.value)}
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
            ? "Saving changes..."
            : "Changes apply immediately to plants, timelines, and assistant context."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href={`/grows/${growId}`}
          >
            Cancel
          </Link>
          <Button
            aria-busy={isPending || undefined}
            disabled={isPending}
            size="md"
            type="submit"
          >
            {isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
