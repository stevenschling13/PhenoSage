import { Skeleton } from "@/components/ui/skeleton";

export default function AssistantLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading assistant"
      className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col gap-4 px-4 py-12 sm:px-6"
    >
      <span className="sr-only">Loading the grow copilot…</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-3/4" />
      <Skeleton className="mt-auto h-12 w-full" />
    </main>
  );
}
