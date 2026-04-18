import type { Metadata } from "next";
import Link from "next/link";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getServerUser();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.email?.split("@")[0] || "Grower"}
        </h1>
        <Link
          href="/grows"
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
        >
          My Grows
        </Link>
      </div>

      {/* Quick stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Active Grows", value: "—" },
          { label: "Plants Tracked", value: "—" },
          { label: "Health Checks", value: "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border bg-white p-6 shadow-sm"
          >
            <p className="text-sm text-gray-500">{stat.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent activity placeholder */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Recent activity
        </h2>
        <p className="text-sm text-gray-400 italic">
          No activity yet. Create a grow to get started.
        </p>
      </div>

      {/* Navigation shortcuts */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center rounded-xl border bg-white p-6 text-center shadow-sm hover:bg-gray-50 transition-colors"
          >
            <span className="mb-2 text-2xl">{link.icon}</span>
            <span className="text-sm font-medium text-gray-700">
              {link.label}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

const navLinks = [
  { href: "/grows", icon: "🌱", label: "Grows" },
  { href: "/assistant", icon: "💬", label: "Assistant" },
  { href: "/settings", icon: "⚙️", label: "Settings" },
  { href: "/auth", icon: "👤", label: "Account" },
];
