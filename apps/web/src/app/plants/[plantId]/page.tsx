import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Plant Detail" };

interface Props {
  params: Promise<{ plantId: string }>;
}

export default async function PlantPage({ params }: Props) {
  const { plantId } = await params;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link href="/grows" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to grows
        </Link>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-gray-900">Plant</h1>
      <p className="mb-8 text-sm text-gray-400">ID: {plantId}</p>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Photo Timeline
            </h2>
            <div className="rounded-lg border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              {/* TODO: Render plant_images ordered by takenAt */}
              No photos yet. Upload the first photo.
            </div>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              AI Analysis
            </h2>
            <div className="rounded-lg border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              {/* TODO: Render latest AnalysisResponse */}
              Upload a photo to trigger analysis.
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Upload Photo
            </h2>
            <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
              {/* TODO: Wire upload to /api/uploads/sign → Supabase Storage */}
              Photo upload component
            </div>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Findings
            </h2>
            <p className="text-sm text-gray-400">
              No findings yet.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
