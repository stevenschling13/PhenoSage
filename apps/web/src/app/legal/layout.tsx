import Link from "next/link";
import { Container } from "@/components/ui/container";

// Shared shell for the public legal pages (/legal/terms, /legal/privacy).
// Static, unauthenticated, linked from the landing footer and the
// sign-up acknowledgment checkbox.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <Container
          width="md"
          className="flex items-center justify-between py-4 text-sm"
        >
          <Link href="/" className="font-semibold hover:text-foreground">
            PhenoSage
          </Link>
          <nav className="flex items-center gap-4 text-muted-foreground">
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </nav>
        </Container>
      </header>
      <main>
        <Container width="md" className="py-10">
          <article className="space-y-6 text-sm leading-relaxed text-muted-foreground [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
            {children}
          </article>
        </Container>
      </main>
    </div>
  );
}
