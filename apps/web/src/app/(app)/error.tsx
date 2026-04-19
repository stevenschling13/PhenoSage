"use client";

import { AlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="app-page">
      <section className="surface-panel-elevated max-w-3xl p-8">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[1.4rem] bg-danger/10 text-danger">
          <AlertIcon className="h-6 w-6" />
        </div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground">
            Workspace load failed
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            PhenoSage could not finish rendering this workspace view. Retry the
            request or return once the supporting service is healthy.
          </p>
          <p className="rounded-[1.2rem] border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error.message}
          </p>
        </div>
        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>
      </section>
    </main>
  );
}
