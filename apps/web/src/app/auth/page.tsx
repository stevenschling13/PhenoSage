import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign In" };

export default function AuthPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Welcome to PhenoSage
        </h1>
        <p className="mb-8 text-sm text-gray-500">
          Sign in or create your account to get started.
        </p>

        {/* TODO: Replace with Supabase Auth UI or custom auth form */}
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
          Auth form placeholder
          <br />
          Connect Supabase Auth here
        </div>
      </div>
    </main>
  );
}
