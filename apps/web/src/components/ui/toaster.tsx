"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        className:
          "!bg-[rgb(var(--ps-surface))] !border !border-[rgb(var(--ps-line)/var(--ps-line-strength))] !text-[rgb(var(--ps-ink))] !shadow-soft",
        descriptionClassName: "!text-[rgb(var(--ps-muted))]",
      }}
      closeButton
      richColors
    />
  );
}
