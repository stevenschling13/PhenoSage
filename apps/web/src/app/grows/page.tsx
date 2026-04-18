import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Grows" };

export default function GrowsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Grows</h1>
        {/* TODO: Open create grow modal/sheet */}
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          + New Grow
        </button>
      </div>

      <div className="rounded-xl border bg-white p-10 text-center">
        <p className="text-gray-400">
          No grows yet.{" "}
          <span className="text-brand-600">Create your first grow</span> to
          start tracking your plants.
        </p>
      </div>

      {/* TODO: Render grows list from Supabase */}
      <p className="mt-4 text-xs text-gray-400">
        Grows are loaded server-side via Supabase with RLS.
      </p>

      <div className="mt-8">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to dashboard
        </Link>
      </div>
    </main>
  );
}
