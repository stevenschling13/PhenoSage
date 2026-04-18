"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
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
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-brand-400"
    >
      {pending ? "Please wait…" : label}
    </button>
  );
}

function EmailField() {
  return (
    <div>
      <label
        htmlFor="email"
        className="mb-1 block text-sm font-medium text-gray-700"
      >
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}

function PasswordField({ autoComplete }: { autoComplete: string }) {
  return (
    <div>
      <label
        htmlFor="password"
        className="mb-1 block text-sm font-medium text-gray-700"
      >
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        minLength={8}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <p className="mt-1 text-xs text-gray-500">Minimum 8 characters.</p>
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
  if (!message) return null;
  const isOk = state?.ok === true;
  return (
    <div
      role={isOk ? "status" : "alert"}
      className={`rounded-lg border px-3 py-2 text-sm ${
        isOk
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
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

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex rounded-lg border bg-gray-50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === tab.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "sign-in" && (
        <form action={signInFormAction} className="space-y-4">
          <EmailField />
          <PasswordField autoComplete="current-password" />
          <Feedback state={signInState} initialError={initialError} />
          <SubmitButton label="Sign in" />
        </form>
      )}

      {mode === "sign-up" && (
        <form action={signUpFormAction} className="space-y-4">
          <EmailField />
          <PasswordField autoComplete="new-password" />
          <Feedback state={signUpState} />
          <SubmitButton label="Create account" />
        </form>
      )}

      {mode === "magic-link" && (
        <form action={otpFormAction} className="space-y-4">
          <EmailField />
          <Feedback state={otpState} />
          <SubmitButton label="Send magic link" />
        </form>
      )}

      <p className="text-center text-xs text-gray-500">
        {mode === "sign-in" && "No account yet? Switch to Sign up."}
        {mode === "sign-up" && "Already have one? Switch to Sign in."}
        {mode === "magic-link" && "We'll email you a one-click sign-in link."}
      </p>
    </div>
  );
}
