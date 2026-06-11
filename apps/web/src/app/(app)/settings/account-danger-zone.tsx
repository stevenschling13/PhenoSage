"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Phase = "idle" | "confirming" | "deleting" | "error";

export function AccountDangerZone() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirmText, setConfirmText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleDelete() {
    setPhase("deleting");
    setErrorMessage("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setErrorMessage(
          body?.error?.message ?? "Account deletion failed. Please try again.",
        );
        setPhase("error");
        return;
      }
      // The auth user is gone; leave the workspace entirely.
      window.location.href = "/";
    } catch {
      setErrorMessage("Account deletion failed. Please try again.");
      setPhase("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Download everything in your account — grows, plants, findings,
          analyses, chat history — as a single JSON file.
        </p>
        <Button asChild fullWidth variant="surface">
          <a href="/api/account/export" download>
            Export my data
          </a>
        </Button>
      </div>

      <div className="space-y-2 rounded-[1.2rem] border border-destructive/30 bg-destructive/5 px-4 py-4">
        <p className="text-sm font-medium text-destructive">Delete account</p>
        <p className="text-xs text-muted-foreground">
          Permanently removes your account, every grow, all photos, and all chat
          history. This cannot be undone — export your data first.
        </p>

        {phase === "idle" && (
          <Button
            fullWidth
            variant="surface"
            onClick={() => setPhase("confirming")}
          >
            Delete my account…
          </Button>
        )}

        {(phase === "confirming" ||
          phase === "deleting" ||
          phase === "error") && (
          <div className="space-y-2">
            <Label htmlFor="delete-confirm" className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to
              confirm
            </Label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              disabled={phase === "deleting"}
            />
            {errorMessage && (
              <p role="alert" className="text-xs text-destructive">
                {errorMessage}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                fullWidth
                variant="surface"
                disabled={phase === "deleting"}
                onClick={() => {
                  setPhase("idle");
                  setConfirmText("");
                  setErrorMessage("");
                }}
              >
                Cancel
              </Button>
              <Button
                fullWidth
                loading={phase === "deleting"}
                disabled={confirmText !== "DELETE" || phase === "deleting"}
                onClick={handleDelete}
              >
                {phase === "deleting" ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
