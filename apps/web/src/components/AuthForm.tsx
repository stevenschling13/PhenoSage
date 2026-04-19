"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircleIcon, ShieldIcon, SparkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createSupabaseBrowserClient,
  hasSupabaseBrowserEnv,
} from "@/lib/supabase";
import { useRouter } from "next/navigation";

type FieldErrors = {
  email?: string | undefined;
  password?: string | undefined;
};

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRouting, startTransition] = useTransition();

  const router = useRouter();
  const authReady = hasSupabaseBrowserEnv();
  const supabase = useMemo(
    () => (authReady ? createSupabaseBrowserClient() : null),
    [authReady],
  );

  const isBusy = loading || isRouting;

  const introCopy = useMemo(
    () =>
      isSignUp
        ? "Create a secure operator account. Email confirmation keeps the workspace private."
        : "Sign in to review plant health, image history, and assistant context in one workspace.",
    [isSignUp],
  );

  function validate() {
    const errors: FieldErrors = {};

    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Use a valid work email.";
    }

    if (!password) {
      errors.password = "Password is required.";
    } else if (isSignUp && password.length < 8) {
      errors.password = "Use at least 8 characters for account security.";
    }

    return errors;
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validate();
    setFieldErrors(nextErrors);
    setLoading(true);
    setMessage(null);

    if (Object.keys(nextErrors).length > 0) {
      setLoading(false);
      return;
    }

    if (!supabase) {
      setLoading(false);
      setMessage({
        type: "error",
        text: "Supabase auth is not configured in this environment yet.",
      });
      return;
    }

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        setMessage({
          type: "success",
          text: "Verification link sent. Confirm your email to activate the workspace.",
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        startTransition(() => {
          router.push("/dashboard");
          router.refresh();
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "PhenoSage could not complete authentication.",
      });
    } finally {
      setLoading(false);
    }
  };

  const inputClassName =
    "mt-2 block w-full rounded-[1.15rem] border bg-surface px-4 py-3 text-sm text-foreground shadow-soft transition placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

  return (
    <div className="w-full space-y-6">
      <div className="space-y-4">
        <div className="inline-flex rounded-full border border-border/80 bg-background-subtle p-1">
          <button
            aria-pressed={!isSignUp}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              !isSignUp
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setIsSignUp(false);
              setFieldErrors({});
              setMessage(null);
            }}
            type="button"
          >
            Sign in
          </button>
          <button
            aria-pressed={isSignUp}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              isSignUp
                ? "bg-surface text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setIsSignUp(true);
              setFieldErrors({});
              setMessage(null);
            }}
            type="button"
          >
            Create account
          </button>
        </div>

        <p className="text-sm leading-6 text-muted-foreground">{introCopy}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/80 p-3">
            <ShieldIcon className="mb-3 h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-foreground">
              Private images
            </p>
          </div>
          <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/80 p-3">
            <SparkIcon className="mb-3 h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-foreground">
              Structured findings
            </p>
          </div>
          <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/80 p-3">
            <CheckCircleIcon className="mb-3 h-4 w-4 text-accent" />
            <p className="text-sm font-semibold text-foreground">
              Same-origin AI routes
            </p>
          </div>
        </div>
      </div>

      <form className="space-y-5" onSubmit={handleAuth}>
        {!authReady ? (
          <div className="rounded-[1.2rem] border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
            Auth environment variables are not configured here yet. You can
            review the interface, but secure sign-in will remain disabled until
            Supabase public keys are provided.
          </div>
        ) : null}
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="email"
          >
            Email
          </label>
          <input
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
            id="email"
            type="email"
            placeholder="operator@growroom.co"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
            className={`${inputClassName} ${
              fieldErrors.email
                ? "border-danger/70 focus-visible:ring-danger/35"
                : "border-border/80"
            }`}
            required
          />
          {fieldErrors.email ? (
            <p className="mt-2 text-sm text-danger" id="email-error">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor="password"
            >
              Password
            </label>
            {isSignUp ? (
              <Badge tone="accent">Minimum 8 characters</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                Required for private workspace access
              </span>
            )}
          </div>
          <input
            aria-describedby={
              fieldErrors.password ? "password-error" : undefined
            }
            aria-invalid={fieldErrors.password ? true : undefined}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            id="password"
            type="password"
            placeholder="Enter your secure password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((current) => ({
                ...current,
                password: undefined,
              }));
            }}
            className={`${inputClassName} ${
              fieldErrors.password
                ? "border-danger/70 focus-visible:ring-danger/35"
                : "border-border/80"
            }`}
            required
          />
          {fieldErrors.password ? (
            <p className="mt-2 text-sm text-danger" id="password-error">
              {fieldErrors.password}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {isSignUp
                ? "You will verify your email before the workspace unlocks."
                : "Credentials never leave the secure auth flow."}
            </p>
          )}
        </div>

        {message ? (
          <div
            aria-live="polite"
            className={`rounded-[1.2rem] border px-4 py-3 text-sm ${
              message.type === "success"
                ? "border-success/20 bg-success/10 text-success"
                : "border-danger/20 bg-danger/10 text-danger"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <div className="space-y-3">
          <Button disabled={isBusy || !authReady} fullWidth type="submit">
            {isBusy
              ? "Preparing workspace..."
              : isSignUp
                ? "Create secure workspace"
                : "Enter workspace"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {isSignUp
              ? "Already operating in PhenoSage?"
              : "Need an operator account first?"}{" "}
            <button
              className="font-semibold text-accent hover:text-accent-strong"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setFieldErrors({});
                setMessage(null);
              }}
              type="button"
            >
              {isSignUp ? "Sign in instead" : "Create one here"}
            </button>
          </p>
        </div>
      </form>
    </div>
  );
}
