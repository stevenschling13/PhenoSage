import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { getServerSession } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign In" };

export default async function AuthPage() {
  const session = await getServerSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-700">PhenoSage</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your AI-powered grow operating system.
          </p>
        </div>

        <AuthForm />
      </div>
    </main>
  );
}
