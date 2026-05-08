import Link from "next/link";
import { AlertIcon } from "@/components/icons";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-16 sm:px-6 lg:px-8">
      <Card className="w-full">
        <CardContent className="flex flex-col items-start gap-5 p-8 sm:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] border border-border bg-surface text-accent shadow-sm">
            <AlertIcon className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Not found
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
              This page does not exist.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              The route may have moved, or the link that sent you here was
              incomplete. Return to a known workspace surface instead of staying
              on a dead end.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className={buttonStyles({})} href="/">
              Go home
            </Link>
            <Link
              className={buttonStyles({ variant: "surface" })}
              href="/dashboard"
            >
              Open dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
