import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <main className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            Grow Copilot
          </h1>
          <p className="text-xs text-gray-400">
            AI assistant scoped to your grow
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* AI welcome message */}
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600 text-sm font-bold">
              AI
            </div>
            <div className="rounded-2xl rounded-tl-none bg-white border px-4 py-3 text-sm text-gray-700 max-w-lg">
              Hello! I&apos;m your grow copilot. I have access to your plants,
              timeline, and observations. Ask me anything about your grow.
            </div>
          </div>

          {/* TODO: Render ChatMessage list from /api/chat thread */}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          {/* TODO: Wire to POST /api/chat with streaming */}
          <input
            type="text"
            placeholder="Ask about your grow..."
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            disabled
          />
          <button
            className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            disabled
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
