import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/server/auth";
import { authorizePlantAccess } from "@/lib/server/authorization";
import { getDbClient } from "@/lib/server/db";
import { getSignedImageUrl } from "@/lib/server/storage";
import { PhotoUploader } from "./photo-uploader";

export const metadata: Metadata = { title: "Plant" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ plantId: string }>;
}

interface ImageRow {
  id: string;
  storage_path: string;
  created_at: string;
  taken_at: string | null;
}

interface AnalysisRow {
  overall_health_score: number;
  summary: string;
  model_version: string;
  analyzed_at: string;
  image_id: string;
  comparison_summary: string | null;
}

interface FindingRow {
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string | null;
  created_at: string;
}

export default async function PlantPage({ params }: Props) {
  const { plantId } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/auth?next=/plants/${plantId}`);

  const access = await authorizePlantAccess(user.id, plantId);
  if (!access) notFound();

  const db = getDbClient();
  const [imagesRes, analysisRes] = await Promise.all([
    db
      .from("plant_images")
      .select("id, storage_path, created_at, taken_at")
      .eq("plant_id", access.plantId)
      .order("created_at", { ascending: false })
      .limit(12),
    db
      .from("plant_analyses")
      .select(
        "overall_health_score, summary, model_version, analyzed_at, image_id, comparison_summary",
      )
      .eq("plant_id", access.plantId)
      .order("analyzed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const images = (imagesRes.data ?? []) as ImageRow[];
  const analysis = (analysisRes.data ?? null) as AnalysisRow | null;

  let findings: FindingRow[] = [];
  if (analysis) {
    const { data } = await db
      .from("plant_findings")
      .select(
        "category, severity, title, description, recommendation, created_at",
      )
      .eq("image_id", analysis.image_id)
      .order("severity", { ascending: false });
    findings = (data ?? []) as FindingRow[];
  }

  const signedImages = await Promise.all(
    images.map(async (img) => ({
      id: img.id,
      createdAt: img.created_at,
      url: await getSignedImageUrl(img.storage_path),
    })),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/grows"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to grows
        </Link>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-gray-900">
        {access.name || "Plant"}
      </h1>
      <p className="mb-8 text-sm text-gray-400">
        {access.strain ? `Strain: ${access.strain}` : "No strain recorded"} ·
        ID: <span className="font-mono text-xs">{plantId}</span>
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Photo timeline
            </h2>
            {signedImages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
                No photos yet. Upload your first photo on the right.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {signedImages.map((img) => (
                  <figure
                    key={img.id}
                    className="overflow-hidden rounded-lg border bg-gray-50"
                  >
                    {img.url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={img.url}
                        alt="Plant photo"
                        className="h-32 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center text-xs text-gray-400">
                        Image unavailable
                      </div>
                    )}
                    <figcaption className="px-2 py-1 text-xs text-gray-500">
                      {new Date(img.createdAt).toLocaleString()}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              AI analysis
            </h2>
            {analysis ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-gray-900">
                    {Number(analysis.overall_health_score).toFixed(1)}
                    <span className="ml-1 text-sm text-gray-400">/ 100</span>
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(analysis.analyzed_at).toLocaleString()} ·{" "}
                    {analysis.model_version}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{analysis.summary}</p>
                {analysis.comparison_summary ? (
                  <p className="text-sm italic text-gray-500">
                    {analysis.comparison_summary}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
                Upload a photo to trigger analysis.
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Upload photo
            </h2>
            <PhotoUploader plantId={access.plantId} />
          </section>

          <section className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Findings
            </h2>
            {findings.length === 0 ? (
              <p className="text-sm text-gray-400">No findings yet.</p>
            ) : (
              <ul className="space-y-3">
                {findings.map((f, i) => (
                  <li
                    key={`${f.title}-${i}`}
                    className="rounded-lg border border-gray-100 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">
                        {f.title}
                      </span>
                      <span className={severityBadgeClass(f.severity)}>
                        {f.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">
                      {f.description}
                    </p>
                    {f.recommendation ? (
                      <p className="mt-1 text-xs text-brand-700">
                        Rec: {f.recommendation}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function severityBadgeClass(severity: string): string {
  const base = "rounded px-2 py-0.5 text-[10px] font-semibold uppercase";
  switch (severity) {
    case "critical":
      return `${base} bg-red-100 text-red-700`;
    case "high":
      return `${base} bg-orange-100 text-orange-700`;
    case "medium":
      return `${base} bg-yellow-100 text-yellow-700`;
    case "low":
      return `${base} bg-blue-100 text-blue-700`;
    default:
      return `${base} bg-gray-100 text-gray-600`;
  }
}
