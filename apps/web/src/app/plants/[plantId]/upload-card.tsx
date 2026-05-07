"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, UploadIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// HEIC is accepted for upload, but only Safari can render it in <img>.
// We hide the preview thumbnail for HEIC and show a labeled placeholder.
const PREVIEWABLE = ["image/jpeg", "image/png", "image/webp"];

export function UploadCard({ plantId }: { plantId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canPreview = file != null && PREVIEWABLE.includes(file.type);

  useEffect(() => {
    if (!file || !PREVIEWABLE.includes(file.type)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const validate = useCallback((picked: File): string | null => {
    if (!ACCEPTED.includes(picked.type)) {
      return "Use a JPG, PNG, WebP, or HEIC image.";
    }
    if (picked.size > MAX_BYTES) {
      return `File is too large. Max ${formatBytes(MAX_BYTES)}.`;
    }
    return null;
  }, []);

  const choose = useCallback(
    (picked: File | null) => {
      if (!picked) return;
      const error = validate(picked);
      if (error) {
        // Discard any previously-staged file so the next click of Upload
        // can't accidentally send the old one.
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        setStatus({ kind: "error", message: error });
        return;
      }
      setFile(picked);
      setStatus({ kind: "idle" });
    },
    [validate],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    choose(e.target.files?.[0] ?? null);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    choose(e.dataTransfer.files?.[0] ?? null);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const clear = () => {
    setFile(null);
    setStatus({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async () => {
    if (!file) return;
    setStatus({ kind: "uploading" });
    try {
      const res = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId,
          fileName: file.name,
          contentType: file.type,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        signedUrl?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed (${res.status}).`);
      }

      // Upload pipeline lands once Supabase Storage signed URL is wired.
      if (!data.signedUrl) {
        setStatus({
          kind: "success",
          message:
            data.message ??
            "Photo prepared. Storage upload coming online soon.",
        });
        return;
      }

      const put = await fetch(data.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage upload failed (${put.status}).`);

      setStatus({ kind: "success", message: "Photo uploaded." });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setStatus({ kind: "error", message });
    }
  };

  const busy = status.kind === "uploading";

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        onChange={onChange}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      {!file ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a photo"
          onClick={() => inputRef.current?.click()}
          onKeyDown={onKeyDown}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed bg-muted/30 px-4 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dragOver
              ? "border-primary bg-accent"
              : "border-border hover:border-primary/40 hover:bg-accent/40",
          )}
        >
          <UploadIcon
            width={24}
            height={24}
            className="mb-2 text-muted-foreground"
          />
          <p className="text-sm font-medium text-foreground">
            Drag a photo here
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            or click to browse
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {canPreview && previewUrl ? (
            <div className="overflow-hidden rounded-md border border-border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={file.name}
                className="h-44 w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/30 text-center">
              <UploadIcon
                width={22}
                height={22}
                className="text-muted-foreground"
              />
              <p className="text-xs font-medium text-foreground">
                HEIC selected
              </p>
              <p className="text-[11px] text-muted-foreground">
                Preview not supported in this browser. Upload still works.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={file.name}>
              {file.name}
            </span>
            <span className="shrink-0">{formatBytes(file.size)}</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={busy}
              leftIcon={<CloseIcon width={14} height={14} />}
            >
              Remove
            </Button>
            <Button
              type="button"
              size="sm"
              loading={busy}
              onClick={upload}
              leftIcon={
                busy ? undefined : <UploadIcon width={14} height={14} />
              }
            >
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {status.message}
        </div>
      )}
      {status.kind === "success" && (
        <div
          role="status"
          className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
        >
          {status.message}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        JPG, PNG, WebP, or HEIC · up to {formatBytes(MAX_BYTES)}.
      </p>
    </div>
  );
}
