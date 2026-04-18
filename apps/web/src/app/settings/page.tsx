import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">Settings</h1>

      <div className="space-y-6">
        <section className="rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Profile</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Display name
              </label>
              {/* TODO: Wire to Supabase profiles table update */}
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
                placeholder="Your name"
                disabled
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Notifications
          </h2>
          <p className="text-sm text-gray-400">
            {/* TODO: Add notification preferences */}
            Notification preferences coming in Milestone 2.
          </p>
        </section>

        <section className="rounded-xl border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 text-red-600">
            Danger Zone
          </h2>
          <p className="text-sm text-gray-400">
            {/* TODO: Delete account flow */}
            Account deletion coming soon.
          </p>
        </section>
      </div>

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
