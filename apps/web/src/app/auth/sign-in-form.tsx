"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import {
  signInAction,
  signUpAction,
  signInWithOtpAction,
  type AuthFormState,
} from "./actions";

type Mode = "sign-in" | "sign-up" | "magic-link";

const TABS: { id: Mode; label: string }[] = [
  { id: "sign-in", label: "Sign in" },
  { id: "sign-up", label: "Sign up" },
  { id: "magic-link", label: "Magic link" },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} fullWidth size="md">
      {pending ? "Please wait…" : label}
    </Button>
  );
}

function EmailField({ defaultValue }: { defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        defaultValue={defaultValue ?? ""}
        required
      />
    </div>
  );
}

function PasswordField({ autoComplete }: { autoComplete: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="password">Password</Label>
      <Input
        id="password"
        name="password"
        type="password"
        minLength={8}
        autoComplete={autoComplete}
        placeholder="••••••••"
        required
      />
      <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
    </div>
  );
}

function Feedback({
  state,
  initialError,
}: {
  state: AuthFormState;
  initialError?: string | undefined;
}) {
  const message = state?.message ?? initialError ?? "";
  const ref = useRef<HTMLDivElement | null>(null);
  const isOk = state?.ok === true;

  useEffect(() => {
    if (message && !isOk) {
      ref.current?.focus();
    }
  }, [message, isOk]);

  if (!message) return null;
  return (
    <div
      ref={ref}
      role={isOk ? "status" : "alert"}
      aria-live={isOk ? "polite" : "assertive"}
      tabIndex={-1}
      className={cn(
        "rounded-md border px-3 py-2 text-sm animate-fade-in focus:outline-none focus-visible:ring-2",
        isOk
          ? "border-success/30 bg-success/10 text-success focus-visible:ring-success/40"
          : "border-destructive/30 bg-destructive/10 text-destructive focus-visible:ring-destructive/40",
      )}
    >
      {message}
    </div>
  );
}

export function SignInForm({
  initialError,
}: {
  initialError?: string | undefined;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({
    "sign-in": null,
    "sign-up": null,
    "magic-link": null,
  });

  const [signInState, signInFormAction] = useActionState<
    AuthFormState,
    FormData
  >(signInAction, null);
  const [signUpState, signUpFormAction] = useActionState<
    AuthFormState,
    FormData
  >(signUpAction, null);
  const [otpState, otpFormAction] = useActionState<AuthFormState, FormData>(
    signInWithOtpAction,
    null,
  );

  const tabId = (id: Mode) => `auth-tab-${id}`;
  const panelId = (id: Mode) => `auth-panel-${id}`;

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft")
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = TABS.length - 1;
    else return;
    e.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    setMode(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Authentication method"
        className="flex rounded-md border border-border bg-muted/50 p-1"
      >
        {TABS.map((tab, index) => {
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={panelId(tab.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => setMode(tab.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                active
                  ? "bg-card text-foreground shadow-elevation-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {mode === "sign-in" && (
        <form
          action={signInFormAction}
          className="space-y-4"
          role="tabpanel"
          id={panelId("sign-in")}
          aria-labelledby={tabId("sign-in")}
          key={`sign-in-${signInState?.email ?? ""}`}
        >
          <EmailField defaultValue={signInState?.email ?? ""} />
          <PasswordField autoComplete="current-password" />
          <Feedback state={signInState} initialError={initialError} />
          <SubmitButton label="Sign in" />
        </form>
      )}

      {mode === "sign-up" && (
        <form
          action={signUpFormAction}
          className="space-y-4"
          role="tabpanel"
          id={panelId("sign-up")}
          aria-labelledby={tabId("sign-up")}
          key={`sign-up-${signUpState?.email ?? ""}`}
        >
          <EmailField defaultValue={signUpState?.email ?? ""} />
          <PasswordField autoComplete="new-password" />
          <Feedback state={signUpState} />
          <SubmitButton label="Create account" />
        </form>
      )}

      {mode === "magic-link" && (
        <form
          action={otpFormAction}
          className="space-y-4"
          role="tabpanel"
          id={panelId("magic-link")}
          aria-labelledby={tabId("magic-link")}
          key={`magic-link-${otpState?.email ?? ""}`}
        >
          <EmailField defaultValue={otpState?.email ?? ""} />
          <Feedback state={otpState} />
          <SubmitButton label="Send magic link" />
        </form>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {mode === "sign-in" && (
          <>
            No account yet?{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              onClick={() => {
                setMode("sign-up");
                tabRefs.current["sign-up"]?.focus();
              }}
            >
              Create an account
            </button>
            .
          </>
        )}
        {mode === "sign-up" && (
          <>
            Already have one?{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              onClick={() => {
                setMode("sign-in");
                tabRefs.current["sign-in"]?.focus();
              }}
            >
              Sign in instead
            </button>
            .
          </>
        )}
        {mode === "magic-link" && "We'll email you a one-click sign-in link."}
      </p>
    </div>
  );
}
