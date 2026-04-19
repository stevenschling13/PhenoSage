export function SkipLink({ href = "#main-content" }: { href?: string }) {
  return (
    <a href={href} className="skip-link">
      Skip to main content
    </a>
  );
}
