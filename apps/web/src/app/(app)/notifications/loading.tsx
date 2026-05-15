import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
    >
      <span className="sr-only">Loading notifications...</span>
      
      {/* Page header skeleton */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between mb-8">
        <div className="space-y-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      {/* Notification cards */}
      <section className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Card key={idx}>
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-5 w-full max-w-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Info card skeleton */}
      <Card className="mt-6">
        <CardContent className="flex items-start gap-3 p-5">
          <Skeleton className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
