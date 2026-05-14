"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/form-error-summary";
type GrowRecord = { id: string; name: string; stage: string | null };
import {
  createPlantAction,
  createPlantActionInitialState,
  type CreatePlantActionResult,
} from "../actions";
import { MAX_BULK_PLANT_COUNT } from "../constants";

const FIELD_META = {
  count: { label: "How many plants", targetId: "plant-count" },
  growId: { label: "Grow", targetId: "plant-grow" },
  name: { label: "Plant name", targetId: "plant-name" },
} as const;

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
  if (!message) {
    return null;
  }

  return (
    <p id={`${fieldId}-error`} className="mt-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function PlantForm({
  defaultGrowId,
  grows,
}: {
  defaultGrowId: string;
  grows: GrowRecord[];
}) {
  const router = useRouter();
  const [state, setState] = useState<CreatePlantActionResult>(
    createPlantActionInitialState,
  );
  const [isPending, startTransition] = useTransition();
  const [growId, setGrowId] = useState(defaultGrowId);
  const [name, setName] = useState("");
  const [strain, setStrain] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(1);
  const isBulk = count > 1;
  const pad = count >= 10 ? 2 : 1;
  const trimmedName = name.trim();
  const previewBase = trimmedName || "Plant";
  const bulkPreview = isBulk
    ? [
        `${previewBase} ${String(1).padStart(pad, "0")}`,
        `${previewBase} ${String(2).padStart(pad, "0")}`,
        count > 3
          ? `…through ${previewBase} ${String(count).padStart(pad, "0")}`
          : count === 3
            ? `${previewBase} ${String(3).padStart(pad, "0")}`
            : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await createPlantAction(formData);
        setState(result);
        if (result.status === "success" && result.redirectTo) {
          router.push(result.redirectTo);
        }
      } catch (err) {
        // Safety net so an unexpected throw can never crash into the
        // (app)/error.tsx boundary.
        console.error("createPlantAction failed unexpectedly", err);
        setState({
          message:
            "Something went wrong saving the plant. Please try again in a moment.",
          status: "error",
        });
      }
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
          htmlFor="plant-grow"
        >
          Grow
        </label>
        <select
          aria-describedby={describedBy(
            "plant-grow",
            Boolean(state.fieldErrors?.growId),
          )}
          aria-invalid={Boolean(state.fieldErrors?.growId) || undefined}
          className={inputClassName}
          id="plant-grow"
          name="growId"
          onChange={(event) => setGrowId(event.target.value)}
          value={growId}
        >
          {grows.map((grow) => (
            <option key={grow.id} value={grow.id}>
              {grow.name}
              {grow.stage ? ` · ${grow.stage.replaceAll("_", " ")}` : ""}
            </option>
          ))}
        </select>
        <FieldError fieldId="plant-grow" message={state.fieldErrors?.growId} />
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="plant-name"
          >
            {isBulk ? "Name prefix" : "Plant name"}
          </label>
          <input
            aria-describedby={describedBy(
              "plant-name",
              Boolean(state.fieldErrors?.name),
            )}
            aria-invalid={Boolean(state.fieldErrors?.name) || undefined}
            className={inputClassName}
            id="plant-name"
            maxLength={120}
            name="name"
            onChange={(event) => setName(event.target.value)}
            placeholder={isBulk ? "Plant" : "Plant 01"}
            required
            value={name}
          />
          <FieldError fieldId="plant-name" message={state.fieldErrors?.name} />
          {isBulk ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Each plant gets a zero-padded number appended — e.g. {bulkPreview}
              .
            </p>
          ) : null}
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="plant-count"
          >
            How many plants?
          </label>
          <input
            aria-describedby={describedBy(
              "plant-count",
              Boolean(state.fieldErrors?.count),
            )}
            aria-invalid={Boolean(state.fieldErrors?.count) || undefined}
            className={inputClassName}
            id="plant-count"
            inputMode="numeric"
            max={MAX_BULK_PLANT_COUNT}
            min={1}
            name="count"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next >= 1) {
                setCount(Math.min(next, MAX_BULK_PLANT_COUNT));
              } else if (event.target.value === "") {
                setCount(1);
              }
            }}
            type="number"
            value={count}
          />
          <FieldError
            fieldId="plant-count"
            message={state.fieldErrors?.count}
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Up to {MAX_BULK_PLANT_COUNT} at once. Strain, batch, and notes apply
            to every plant.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="plant-strain"
          >
            Strain
          </label>
          <input
            className={inputClassName}
            id="plant-strain"
            name="strain"
            onChange={(event) => setStrain(event.target.value)}
            placeholder="Optional cultivar name"
            value={strain}
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="plant-batch-label"
          >
            Batch label
          </label>
          <input
            className={inputClassName}
            id="plant-batch-label"
            name="batchLabel"
            onChange={(event) => setBatchLabel(event.target.value)}
            placeholder="Optional tray or batch reference"
            value={batchLabel}
          />
        </div>
      </div>

      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="plant-notes"
        >
          Notes
        </label>
        <textarea
          className={`${inputClassName} min-h-[120px] resize-y`}
          id="plant-notes"
          name="notes"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes about phenotype, training, or recent context."
          value={notes}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
        <p
          aria-live="polite"
          className="text-sm leading-6 text-muted-foreground"
        >
          {isPending
            ? isBulk
              ? `Creating ${count} plants...`
              : "Creating plant..."
            : isBulk
              ? `${count} plants will be created and you'll land back on the grow registry.`
              : "The new plant opens directly into its upload and timeline workspace."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/plants"
          >
            Cancel
          </Link>
          <Button
            aria-busy={isPending || undefined}
            disabled={isPending}
            size="md"
            type="submit"
          >
            {isPending
              ? isBulk
                ? `Creating ${count} plants...`
                : "Creating plant..."
              : isBulk
                ? `Create ${count} plants`
                : "Create plant"}
          </Button>
        </div>
      </div>
    </form>
  );
}
