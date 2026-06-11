"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/server/auth";
import {
  AUTH_GENERIC_FAILURE,
  AUTH_MISCONFIGURED,
  AuthConfigError,
  describeAuthError,
  getAuthConfigViolations,
  isNextNotFoundError,
  isNextRedirectError,
} from "@/lib/server/auth-errors";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit";

export type AuthFormState = {
  ok: boolean;
  message: string;
  /** Echo the email back so the form can repopulate it after a failure. */
  email?: string;
} | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function readForm(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

function validate(email: string, password: string, needPassword: boolean) {
  if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
  if (needPassword && password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

function callbackUrl() {
  const base = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
  return `${base.replace(/\/$/, "")}/auth/callback`;
}

function fail(email: string, message: string): AuthFormState {
  return { ok: false, message, email };
}

/**
 * Run a Supabase auth call and convert any thrown error into a
 * friendly {@link AuthFormState}. Re-throws Next.js navigation
 * sentinels (`redirect()`, `notFound()`) so they keep working.
 */
async function runAuth(
  email: string,
  fn: () => Promise<AuthFormState>,
): Promise<AuthFormState> {
  try {
    return await fn();
  } catch (err) {
    if (isNextRedirectError(err) || isNextNotFoundError(err)) throw err;
    if (err instanceof AuthConfigError) {
      console.error("[auth] misconfigured:", err.missing.join(", "));
      return fail(email, AUTH_MISCONFIGURED);
    }
    // Anything else: surface a friendly message but log full detail
    // server-side so engineers can diagnose without the user ever
    // seeing a stack trace or "fetch failed".
    console.error("[auth] unexpected failure:", err);
    return fail(email, describeAuthError(err) || AUTH_GENERIC_FAILURE);
  }
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readForm(formData);
  const problem = validate(email, password, true);
  if (problem) return fail(email, problem);

  // Pre-flight env check so a misconfigured deploy returns a friendly
  // message instead of erroring out inside Supabase's fetch layer.
  if (getAuthConfigViolations().length > 0) {
    console.error("[auth] missing env:", getAuthConfigViolations().join(", "));
    return fail(email, AUTH_MISCONFIGURED);
  }

  // Fail-closed rate limit BEFORE we call Supabase. Two reasons to do it
  // here and not after: (1) Supabase's own throttling is generous enough
  // that a credential-stuffing burst can still get many tries through in
  // 15 minutes; (2) consuming a Supabase API call per attacker request
  // wastes our project quota.
  const rl = await applyAuthRateLimit({ email, attemptKind: "sign-in" });
  if (!rl.ok) return fail(email, rl.message);

  return runAuth(email, async () => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return fail(email, describeAuthError(error));
    redirect("/dashboard");
  });
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readForm(formData);
  const problem = validate(email, password, true);
  if (problem) return fail(email, problem);

  // Server-side gate for the age / legal-compliance acknowledgment. The
  // checkbox is required markup-wise too, but never trust the client —
  // a crafted POST without it must not create an account.
  if (formData.get("legal_ack") !== "on") {
    return fail(
      email,
      "Confirm you are of legal age and agree to the Terms and Privacy Policy.",
    );
  }

  if (getAuthConfigViolations().length > 0) {
    console.error("[auth] missing env:", getAuthConfigViolations().join(", "));
    return fail(email, AUTH_MISCONFIGURED);
  }

  // Sign-up is also rate-limited: an attacker spraying signups can
  // exhaust mailer quota and pollute the user table even when the
  // account never gets confirmed.
  const rl = await applyAuthRateLimit({ email, attemptKind: "sign-up" });
  if (!rl.ok) return fail(email, rl.message);

  return runAuth(email, async () => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) return fail(email, describeAuthError(error));

    if (data.session) redirect("/dashboard");
    return {
      ok: true,
      message: "Check your email for a confirmation link to finish sign-up.",
      email,
    };
  });
}

export async function signInWithOtpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email } = readForm(formData);
  const problem = validate(email, "", false);
  if (problem) return fail(email, problem);

  if (getAuthConfigViolations().length > 0) {
    console.error("[auth] missing env:", getAuthConfigViolations().join(", "));
    return fail(email, AUTH_MISCONFIGURED);
  }

  // Magic-link requests are the most aggressive abuse vector here: an
  // attacker can spam emails without any password guess, so it must
  // share the same fail-closed envelope as sign-in / sign-up.
  const rl = await applyAuthRateLimit({ email, attemptKind: "otp" });
  if (!rl.ok) return fail(email, rl.message);

  return runAuth(email, async () => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) return fail(email, describeAuthError(error));

    return {
      ok: true,
      message:
        "Magic link sent. Check your email and click the link to sign in.",
      email,
    };
  });
}

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch (err) {
    // Sign-out is best-effort: even if Supabase is unreachable we want to
    // get the user back to the public landing page rather than show a
    // crash. Log so the issue is still surfaced in observability.
    console.error("[auth] sign-out failure (continuing):", err);
  }
  redirect("/");
}
