"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  plantId: string;
}

type UIState =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "uploading" }
  | { kind: "registering" }
  | { kind: "analyzing" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export function PhotoUploader({ plantId }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<UIState>({ kind: "idle" });
  const router = useRouter();

  const handle = useCallback(
    async (file: File) => {
      if (!ALLOWED.has(file.type)) {
        setState({ kind: "error", message: "Unsupported image type" });
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setState({ kind: "error", message: "Image is larger than 15 MB" });
        return;
      }

      setState({ kind: "signing" });
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId,
          contentType: file.type,
          fileName: file.name,
        }),
      });
      if (!signRes.ok) {
        const err = await safeText(signRes);
        setState({ kind: "error", message: `Could not sign upload: ${err}` });
        return;
      }
      const signed = (await signRes.json()) as {
        signedUrl: string;
        token: string;
        storagePath: string;
      };

      setState({ kind: "uploading" });
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        const err = await safeText(put);
        setState({ kind: "error", message: `Upload failed: ${err}` });
        return;
      }

      setState({ kind: "registering" });
      const register = await fetch(`/api/plants/${plantId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: signed.storagePath }),
      });
      if (!register.ok) {
        const err = await safeText(register);
        setState({
          kind: "error",
          message: `Could not save image record: ${err}`,
        });
        return;
      }
      const registered = (await register.json()) as {
        image: { id: string };
      };

      setState({ kind: "analyzing" });
      const analyze = await fetch(`/api/plants/${plantId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: registered.image.id }),
      });
      if (!analyze.ok) {
        const err = await safeText(analyze);
        setState({
          kind: "error",
          message: `Analysis failed: ${err}`,
        });
        router.refresh();
        return;
      }

      setState({ kind: "done" });
      router.refresh();
    },
    [plantId, router],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handle(file);
  };

  const statusMessage = (() => {
    switch (state.kind) {
      case "signing":
        return "Requesting upload URL…";
      case "uploading":
        return "Uploading image…";
      case "registering":
        return "Saving image record…";
      case "analyzing":
        return "Running AI analysis…";
      case "done":
        return "Analysis complete.";
      case "error":
        return state.message;
      default:
        return "Choose a photo to upload.";
    }
  })();

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={onInputChange}
      />
      <button
        type="button"
        className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        onClick={() => inputRef.current?.click()}
        disabled={
          state.kind === "signing" ||
          state.kind === "uploading" ||
          state.kind === "registering" ||
          state.kind === "analyzing"
        }
      >
        Upload plant photo
      </button>
      <p
        className={`text-xs ${
          state.kind === "error" ? "text-red-600" : "text-gray-500"
        }`}
        role={state.kind === "error" ? "alert" : undefined}
      >
        {statusMessage}
      </p>
    </div>
  );
}

async function safeText(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string };
    return j.error ?? `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}
