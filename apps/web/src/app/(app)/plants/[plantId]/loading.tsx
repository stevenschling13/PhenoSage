import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlantLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
    >
      <span className="sr-only">Loading plant details...</span>
      
      {/* Page header skeleton */}
      <div className="space-y-3 mb-8">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-8">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx}>
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Data strip skeleton */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        <div className="space-y-6">
          {/* Timeline card */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex gap-2">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-24" />
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Skeleton className="h-8 w-24" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Analysis card */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3 w-56" />
              </div>
              <div className="rounded-[1.25rem] border border-border/70 bg-background-subtle/70 p-5">
                <div className="flex gap-2 mb-3">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6 mt-2" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Upload panel skeleton */}
          <div className="rounded-[1.45rem] border border-dashed border-border-strong/70 bg-background-subtle/70 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-full" />
              </div>
              <Skeleton className="h-11 w-11 rounded-2xl" />
            </div>
            <div className="mt-5 space-y-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-[1.15rem]" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>

          {/* Findings rail skeleton */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex gap-2">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-5 w-14" />
                ))}
              </div>
              {Array.from({ length: 2 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 p-4"
                >
                  <div className="flex gap-2 mb-2">
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-3/4 mt-2" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
