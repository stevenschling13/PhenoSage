import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm text-brand-700">
          Web-first AI grow OS
        </div>
        <h1 className="mb-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          Your plants deserve
          <br />
          <span className="text-brand-600">professional intelligence</span>
        </h1>
        <p className="mb-10 max-w-2xl text-xl text-gray-600">
          PhenoSage combines visual AI diagnosis, longitudinal plant tracking,
          a grow-aware chatbot, and proactive alerts — all in one web app.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Link
            href="/auth"
            className="rounded-lg bg-brand-600 px-8 py-3 text-lg font-semibold text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            Get started free
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 px-8 py-3 text-lg font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            View demo
          </Link>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t bg-white px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">
            Four pillars of grow intelligence
          </h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="rounded-xl border p-6">
                <div className="mb-3 text-3xl">{pillar.icon}</div>
                <h3 className="mb-2 font-semibold text-gray-900">
                  {pillar.title}
                </h3>
                <p className="text-sm text-gray-600">{pillar.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} PhenoSage. Web-first, privacy-respecting.
      </footer>
    </main>
  );
}

const pillars = [
  {
    icon: "🔬",
    title: "Visual Grow Doctor",
    description:
      "Upload plant photos and receive structured AI evaluations with severity-ranked findings.",
  },
  {
    icon: "📊",
    title: "Longitudinal Intelligence",
    description:
      "Compare new photos to prior uploads. Track health scores over your entire grow timeline.",
  },
  {
    icon: "💬",
    title: "Grow-aware Copilot",
    description:
      "Chat with an AI that knows your strains, your history, and your grow environment.",
  },
  {
    icon: "🔔",
    title: "Proactive Alerts",
    description:
      "Daily summaries, task generation, and reminders tailored to your grow stage.",
  },
];
