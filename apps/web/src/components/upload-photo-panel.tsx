"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, UploadIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

type UploadNotice = {
  tone: "danger" | "success" | "warning";
  text: string;
};

const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const maxFileSize = 15 * 1024 * 1024;

export function UploadPhotoPanel({ plantId }: { plantId: string }) {
  const inputId = useId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<UploadNotice | null>(null);

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
        text: "Keep each image under 15 MB so uploads stay fast on mobile.",
      });
      return;
    }

    setFile(nextFile);
  }

  async function prepareUpload() {
    if (!file || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const response = await fetch("/api/upload/sign", {
        body: JSON.stringify({
          contentType: file.type,
          fileName: file.name,
          plantId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const payload = (await response.json()) as {
        data?: {
          imageId?: string;
          storagePath?: string;
          token?: string;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Upload signing failed.");
      }

      const signed = payload.data ?? {};
      if (!signed.storagePath || !signed.token || !signed.imageId) {
        throw new Error(
          "Upload preparation did not return the required storage token.",
        );
      }

      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("plant-images")
        .uploadToSignedUrl(signed.storagePath, signed.token, file, {
          contentType: file.type,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const finalizeResponse = await fetch("/api/upload/finalize", {
        body: JSON.stringify({
          imageId: signed.imageId,
          plantId,
          source: "upload",
          storagePath: signed.storagePath,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const finalizePayload = (await finalizeResponse.json()) as {
        error?: string;
      };

      if (!finalizeResponse.ok) {
        throw new Error(
          finalizePayload.error || "Failed to persist uploaded image.",
        );
      }

      const analysisResponse = await fetch("/api/analyze", {
        body: JSON.stringify({ image_id: signed.imageId, plant_id: plantId }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const analysisPayload = (await analysisResponse.json()) as {
        data?: { job_id?: string; status?: string };
        error?: string;
      };

      if (!analysisResponse.ok || !analysisPayload.data?.job_id) {
        setNotice({
          tone: "warning",
          text:
            analysisPayload.error ||
            "Image uploaded successfully, but analysis is unavailable right now.",
        });
        setFile(null);
        router.refresh();
        return;
      }

      setNotice({
        tone: "success",
        text: "Image uploaded and queued for analysis. Refresh shortly to view the latest result.",
      });
      setFile(null);
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "Upload preparation failed.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[1.45rem] border border-dashed border-border-strong/70 bg-background-subtle/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Badge tone="accent">Primary action</Badge>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.04em] text-foreground">
              Upload a new plant photo
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Capture the same angle each time to make longitudinal comparisons
              stronger and alerts more reliable.
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface text-accent shadow-soft">
            <UploadIcon className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <input
            accept={acceptedTypes.join(",")}
            className="sr-only"
            id={inputId}
            onChange={(event) =>
              handleFileSelection(event.target.files?.[0] ?? null)
            }
            type="file"
          />
          <label
            className={buttonStyles({
              className: "w-full justify-center",
              variant: "surface",
            })}
            htmlFor={inputId}
          >
            Choose image
          </label>

          <div className="rounded-[1.15rem] border border-border/70 bg-surface px-4 py-3 text-sm text-muted-foreground">
            {file ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB · {file.type}
                  </p>
                </div>
                <CheckCircleIcon className="h-5 w-5 text-success" />
              </div>
            ) : (
              "No image selected yet. Baseline captures work best with consistent framing and lighting."
            )}
          </div>

          {notice ? (
            <div
              aria-live={notice.tone === "danger" ? "assertive" : "polite"}
              role={notice.tone === "danger" ? "alert" : "status"}
              className={`rounded-[1.15rem] border px-4 py-3 text-sm ${
                notice.tone === "success"
                  ? "border-success/20 bg-success/10 text-success"
                  : notice.tone === "warning"
                    ? "border-warning/20 bg-warning/10 text-warning"
                    : "border-danger/20 bg-danger/10 text-danger"
              }`}
            >
              {notice.text}
            </div>
          ) : null}

          <Button
            aria-busy={isSubmitting || undefined}
            disabled={!file || isSubmitting}
            fullWidth
            onClick={() => void prepareUpload()}
          >
            {isSubmitting ? "Uploading photo..." : "Upload photo"}
          </Button>
        </div>
      </div>

      <div className="rounded-[1.25rem] border border-border/70 bg-surface/80 p-4 text-sm leading-6 text-muted-foreground">
        Accepted formats: JPG, PNG, WEBP, HEIC. Secure upload URLs are created
        server-side so no private keys reach the browser.
      </div>
    </div>
  );
}
