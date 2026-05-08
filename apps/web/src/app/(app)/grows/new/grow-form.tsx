"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/form-error-summary";
import {
  createGrowAction,
  createGrowActionInitialState,
  type CreateGrowActionResult,
} from "../actions";

const FIELD_META = {
  name: { label: "Grow name", targetId: "grow-name" },
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
  const [state, setState] = useState<CreateGrowActionResult>(
    createGrowActionInitialState,
  );
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState("seedling");
  const [medium, setMedium] = useState("soil");
  const [lightType, setLightType] = useState("led");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [targetHarvestDate, setTargetHarvestDate] = useState("");

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      const result = await createGrowAction(formData);
      setState(result);
    });
  }

  return (
    <form action={handleAction} className="space-y-5" noValidate>
      <FormErrorSummary
        message={state.message}
        fieldErrors={state.fieldErrors}
        fieldMeta={FIELD_META}
      />

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
          className={`${inputClassName} min-h-[120px] resize-y`}
          id="grow-description"
          name="description"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional room notes, cultivar program details, or operator context."
          value={description}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Optional. Use this for location, room constraints, or handoff notes.
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
            onChange={(event) => setStage(event.target.value)}
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
            onChange={(event) => setMedium(event.target.value)}
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
            onChange={(event) => setLightType(event.target.value)}
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
        <p className="text-sm leading-6 text-muted-foreground">
          This creates the grow record immediately and makes it available to the
          dashboard and plant flows.
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
