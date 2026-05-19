"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImagePreflightResult } from "@phenosage/shared";
import { CheckCircleIcon, UploadIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

type UploadNotice = {
  tone: "danger" | "success" | "warning";
  text: string;
};

// Once the upload + finalize succeeds, the panel transitions into a
// "captured" state. From there the user either accepts the AI Capture
// Coach's verdict (auto-analyze on ok=true) or chooses to retake / force
// analyze when the preflight surfaces a quality issue. The id of the
// pending image is held in component state so the "Analyze anyway"
// button can re-fire the analyze call without re-uploading.
interface CapturedImage {
  imageId: string;
  preflight: ImagePreflightResult;
}

const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const maxFileSize = 15 * 1024 * 1024;

export function UploadPhotoPanel({ plantId }: { plantId: string }) {
  const inputId = useId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);

  async function triggerAnalyze(imageId: string): Promise<UploadNotice> {
    const analysisResponse = await fetch("/api/analyze", {
      body: JSON.stringify({ image_id: imageId, plant_id: plantId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const analysisPayload = (await analysisResponse.json()) as {
      data?: { job_id?: string; status?: string };
      error?: string;
    };
    if (!analysisResponse.ok || !analysisPayload.data?.job_id) {
      return {
        tone: "warning",
        text:
          analysisPayload.error ||
          "Image uploaded successfully, but analysis is unavailable right now.",
      };
    }
    return {
      tone: "success",
      text: "Image uploaded and queued for analysis. Refresh shortly to view the latest result.",
    };
  }

  async function analyzeCapturedAnyway() {
    if (!captured || isSubmitting) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const next = await triggerAnalyze(captured.imageId);
      setNotice(next);
      setCaptured(null);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function discardCapture() {
    // We deliberately leave the storage object + plant_images row in
    // place. Cleanup is a separate, future feature — and keeping the
    // capture means the user can still ask the copilot about it later
    // if they change their mind.
    setCaptured(null);
    setNotice(null);
  }

  function handleFileSelection(nextFile: File | null) {
    setNotice(null);
    setCaptured(null);

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

      // AI Capture Coach: run a non-destructive quality check before
      // paying for the vision call. We deliberately fail OPEN — if the
      // preflight service is unreachable, proceed to analyze rather than
      // stranding the user. The pre-analysis gate on the FastAPI side
      // still catches genuinely unanalysable images.
      let preflight: ImagePreflightResult | null = null;
      try {
        const preflightResponse = await fetch(
          `/api/plants/${encodeURIComponent(plantId)}/preflight`,
          {
            body: JSON.stringify({ imageId: signed.imageId }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        );
        if (preflightResponse.ok) {
          const preflightPayload = (await preflightResponse.json()) as {
            data?: ImagePreflightResult;
          };
          preflight = preflightPayload.data ?? null;
        }
      } catch {
        // Network blip — fall through to the analyze step.
      }

      if (preflight && !preflight.ok) {
        setCaptured({ imageId: signed.imageId, preflight });
        setNotice({ tone: "warning", text: preflight.hint });
        setFile(null);
        return;
      }

      const next = await triggerAnalyze(signed.imageId);
      setNotice(next);
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

          {captured ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                aria-busy={isSubmitting || undefined}
                disabled={isSubmitting}
                onClick={() => void analyzeCapturedAnyway()}
                variant="surface"
                className="flex-1 justify-center"
              >
                {isSubmitting ? "Analyzing..." : "Analyze anyway"}
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={discardCapture}
                variant="ghost"
                className="flex-1 justify-center"
              >
                Choose a different photo
              </Button>
            </div>
          ) : (
            <Button
              aria-busy={isSubmitting || undefined}
              disabled={!file || isSubmitting}
              fullWidth
              onClick={() => void prepareUpload()}
            >
              {isSubmitting ? "Uploading photo..." : "Upload photo"}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-[1.25rem] border border-border/70 bg-surface/80 p-4 text-sm leading-6 text-muted-foreground">
        Accepted formats: JPG, PNG, WEBP, HEIC. Secure upload URLs are created
        server-side so no private keys reach the browser.
      </div>
    </div>
  );
}
