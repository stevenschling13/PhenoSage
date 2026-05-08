import Image from "next/image";
import { cn } from "@/lib/cn";

interface ImageComparisonProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

function Frame({ src, label }: { src: string; label: string }) {
  return (
    <figure className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="relative aspect-square w-full">
        <Image
          alt={label}
          className="object-cover"
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          src={src}
          unoptimized
        />
      </div>
      <figcaption className="border-t border-border bg-background/85 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </figcaption>
    </figure>
  );
}

export function ImageComparison({
  beforeImage,
  afterImage,
  beforeLabel = "Before",
  afterLabel = "After",
  className,
}: ImageComparisonProps) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <Frame label={beforeLabel} src={beforeImage} />
      <Frame label={afterLabel} src={afterImage} />
    </div>
  );
}
