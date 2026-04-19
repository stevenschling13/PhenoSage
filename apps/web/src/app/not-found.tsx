import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { ArrowLeftIcon, LeafIcon } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center bg-hero-gradient">
      <Container width="md" className="text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <LeafIcon width={26} height={26} />
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-primary">
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          We couldn&apos;t find that page
        </h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          The link may have changed, or the page hasn&apos;t shipped yet. Head
          back to the dashboard to keep going.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button
            asChild
            variant="outline"
            leftIcon={<ArrowLeftIcon width={16} height={16} />}
          >
            <Link href="/">Home</Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      </Container>
    </main>
  );
}
