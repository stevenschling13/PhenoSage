import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <main className="app-page">
      <div className="space-y-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-5 w-[34rem] max-w-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-44 rounded-[1.5rem]" />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_340px]">
        <Skeleton className="min-h-[420px] rounded-[1.75rem]" />
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-[1.5rem]" />
          <Skeleton className="h-56 rounded-[1.5rem]" />
        </div>
      </div>
    </main>
  );
}
