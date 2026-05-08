"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
type GrowRecord = { id: string; name: string; stage: string | null };
import {
  createPlantAction,
  createPlantActionInitialState,
  type CreatePlantActionResult,
} from "../actions";

const inputClassName =
  "mt-2 block w-full rounded-[1.15rem] border border-border/80 bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

function FieldError({ message }: { message: string | undefined }) {
  if (!message) {
    return null;
  }

  return <p className="mt-2 text-sm text-danger">{message}</p>;
}

export function PlantForm({
  defaultGrowId,
  grows,
}: {
  defaultGrowId: string;
  grows: GrowRecord[];
}) {
  const [state, setState] = useState<CreatePlantActionResult>(
    createPlantActionInitialState,
  );
  const [isPending, startTransition] = useTransition();
  const [growId, setGrowId] = useState(defaultGrowId);
  const [name, setName] = useState("");
  const [strain, setStrain] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [notes, setNotes] = useState("");

  async function handleAction(formData: FormData) {
    startTransition(async () => {
      const result = await createPlantAction(formData);
      setState(result);
    });
  }

  return (
    <form action={handleAction} className="space-y-5">
      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="plant-grow"
        >
          Grow
        </label>
        <select
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
        <FieldError message={state.fieldErrors?.growId} />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor="plant-name"
        >
          Plant name
        </label>
        <input
          className={inputClassName}
          id="plant-name"
          name="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="Plant 01"
          required
          value={name}
        />
        <FieldError message={state.fieldErrors?.name} />
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

      {state.message ? (
        <div className="rounded-[1.15rem] border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
        <p className="text-sm leading-6 text-muted-foreground">
          The new plant opens directly into its upload and timeline workspace.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href="/plants"
          >
            Cancel
          </Link>
          <Button disabled={isPending} size="md" type="submit">
            {isPending ? "Creating plant..." : "Create plant"}
          </Button>
        </div>
      </div>
    </form>
  );
}
