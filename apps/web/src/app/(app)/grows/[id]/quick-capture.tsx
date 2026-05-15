"use client";

import { useId, useState, useCallback, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CameraIcon, CheckCircleIcon, UploadIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const maxFileSize = 15 * 1024 * 1024;

interface QuickCaptureProps {
  plantId: string;
  plantName: string;
}

type CaptureNotice = {
  tone: "danger" | "success" | "warning";
  text: string;
};

export function QuickCapture({ plantId, plantName }: QuickCaptureProps) {
  const inputId = useId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleFileSelection(nextFile: File | null) {
    setNotice(null);

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!acceptedTypes.includes(nextFile.type)) {
      setFile(null);
      setNotice({
        tone: "danger",
        text: "Use JPG, PNG, WEBP, or HEIC images only.",
      });
      return;
    }

    if (nextFile.size > maxFileSize) {
      setFile(null);
      setNotice({
        tone: "danger",
        text: "Keep each image under 15 MB.",
      });
      return;
    }

    setFile(nextFile);
  }

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelection(droppedFile);
    }
  }, []);

  async function handleQuickCapture() {
    if (!file || isSubmitting) return;

    setIsSubmitting(true);
    setNotice(null);

    try {
      // Step 1: Sign the upload URL
      const signResponse = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId,
          contentType: file.type,
          fileName: file.name,
        }),
      });

      const signPayload = (await signResponse.json()) as {
        error?: string;
        imageId?: string;
        storagePath?: string;
        token?: string;
      };

      if (!signResponse.ok) {
        throw new Error(signPayload.error || "Upload signing failed.");
      }

      if (
        !signPayload.storagePath ||
        !signPayload.token ||
        !signPayload.imageId
      ) {
        throw new Error("Upload preparation did not return required data.");
      }

      // Step 2: Upload to Supabase Storage
      const { createSupabaseBrowserClient } =
        await import("@/lib/supabase-client");
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("plant-images")
        .uploadToSignedUrl(signPayload.storagePath, signPayload.token, file, {
          contentType: file.type,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // Step 3: Finalize the upload record
      const finalizeResponse = await fetch(`/api/plants/${plantId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId: signPayload.imageId,
          source: "upload",
          storagePath: signPayload.storagePath,
        }),
      });

      if (!finalizeResponse.ok) {
        const finalizePayload = (await finalizeResponse.json()) as {
          error?: string;
        };
        throw new Error(finalizePayload.error || "Failed to persist image.");
      }

      // Step 4: Trigger analysis in background
      fetch(`/api/plants/${plantId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: signPayload.imageId }),
      }).catch(() => {
        // Analysis failure shouldn't block the success message
      });

      setNotice({
        tone: "success",
        text: `Photo uploaded to ${plantName}. Analysis running in background.`,
      });
      toast.success("Quick capture complete", {
        description: `Photo uploaded to ${plantName}. Analysis running.`,
      });
      setFile(null);
      router.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Upload failed.";
      setNotice({
        tone: "danger",
        text: errorMessage,
      });
      toast.error("Upload failed", {
        description: errorMessage,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "rounded-[1.15rem] border border-dashed p-4 transition-colors",
        isDragOver
          ? "border-[rgb(var(--ps-accent))] bg-[rgb(var(--ps-accent-soft))]"
          : "border-border-strong/70 bg-background-subtle/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-accent shadow-soft"
          >
            <CameraIcon className={cn("h-4 w-4", isDragOver && "scale-110")} />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              Quick capture for {plantName}
            </p>
            <p className="text-xs text-muted-foreground">
              {isDragOver
                ? "Drop to upload"
                : "Drag an image or click to select"}
            </p>
          </div>
        </div>
        <Badge tone="accent">Fast upload</Badge>
      </div>

      <div className="mt-4">
        <input
          accept={acceptedTypes.join(",")}
          className="sr-only"
          id={inputId}
          onChange={(e) => handleFileSelection(e.target.files?.[0] ?? null)}
          type="file"
        />

        {file ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-success" />
            </div>
            <div className="flex gap-2">
              <Button
                aria-busy={isSubmitting || undefined}
                disabled={isSubmitting}
                onClick={handleQuickCapture}
                size="sm"
                className="flex-1"
              >
                {isSubmitting ? "Uploading..." : "Upload & Analyze"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFile(null)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <label
            className={buttonStyles({
              className: "w-full justify-center cursor-pointer",
              size: "sm",
              variant: "surface",
            })}
            htmlFor={inputId}
          >
            <UploadIcon className="mr-2 h-4 w-4" />
            Select image
          </label>
        )}
      </div>

      {notice ? (
        <div
          aria-live={notice.tone === "danger" ? "assertive" : "polite"}
          role={notice.tone === "danger" ? "alert" : "status"}
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-xs",
            notice.tone === "success" &&
              "border border-success/20 bg-success/10 text-success",
            notice.tone === "warning" &&
              "border border-warning/20 bg-warning/10 text-warning",
            notice.tone === "danger" &&
              "border border-danger/20 bg-danger/10 text-danger",
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
