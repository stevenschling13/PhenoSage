"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/server/auth";

export type AuthFormState = {
  ok: boolean;
  message: string;
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

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readForm(formData);
  const problem = validate(email, password, true);
  if (problem) return { ok: false, message: problem };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  redirect("/dashboard");
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password } = readForm(formData);
  const problem = validate(email, password, true);
  if (problem) return { ok: false, message: problem };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl() },
  });
  if (error) return { ok: false, message: error.message };

  if (data.session) redirect("/dashboard");
  return {
    ok: true,
    message: "Check your email for a confirmation link to finish sign-up.",
  };
}

export async function signInWithOtpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email } = readForm(formData);
  const problem = validate(email, "", false);
  if (problem) return { ok: false, message: problem };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl() },
  });
  if (error) return { ok: false, message: error.message };

  return {
    ok: true,
    message: "Magic link sent. Check your email and click the link to sign in.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
