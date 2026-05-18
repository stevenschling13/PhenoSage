import { cn } from "@/lib/cn";
import { SignedImage } from "@/components/signed-image";

interface ImageComparisonProps {
  /** Plant whose images are being compared. Used by `<SignedImage>` to
   *  request a fresh signed URL from `/api/uploads/refresh` if the
   *  initial one expires before the user finishes viewing the page. */
  plantId: string;
  before: ComparisonFrame;
  after: ComparisonFrame;
  className?: string;
}

interface ComparisonFrame {
  /** The plant_images row id. Together with `plantId`, this is what
   *  `/api/uploads/refresh` uses to re-issue a download URL after the
   *  initial one expires. */
  imageId: string;
  /** Server-rendered signed download URL with a 10-60 minute TTL. */
  signedUrl: string;
  /** Optional human label shown beneath the frame. */
  label?: string;
}

function Frame({
  plantId,
  frame,
  fallbackLabel,
}: {
  plantId: string;
  frame: ComparisonFrame;
  fallbackLabel: string;
}) {
  const label = frame.label ?? fallbackLabel;
  return (
    <figure className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="relative aspect-square w-full">
        {/* `key={frame.imageId}` resets the SignedImage one-shot retry
            budget whenever the underlying image changes — the React
            "reset state by changing key" idiom recommended by the
            component itself. */}
        <SignedImage
          key={frame.imageId}
          plantId={plantId}
          imageId={frame.imageId}
          initialSrc={frame.signedUrl}
          alt={label}
          className="absolute inset-0 h-full w-full object-cover"
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-muted/60 px-3 text-center text-xs font-medium text-muted-foreground">
              Image unavailable
            </div>
          }
        />
      </div>
      <figcaption className="border-t border-border bg-background/85 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </figcaption>
    </figure>
  );
}

export function ImageComparison({
  plantId,
  before,
  after,
  className,
}: ImageComparisonProps) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <Frame plantId={plantId} frame={before} fallbackLabel="Before" />
      <Frame plantId={plantId} frame={after} fallbackLabel="After" />
    </div>
  );
}
