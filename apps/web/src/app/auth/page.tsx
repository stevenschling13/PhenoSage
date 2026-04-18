import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign In" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string; next?: string }>;

export default async function AuthPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getServerUser();
  if (user) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Welcome to PhenoSage
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          Sign in or create your account to get started.
        </p>
        <SignInForm {...(error ? { initialError: error } : {})} />
      </div>
    </main>
  );
}
