import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/server/auth";
import { getStorageClient } from "@/lib/server/storage";

// POST /api/uploads/sign
// Returns a short-lived Supabase Storage signed upload URL.
// The browser uploads directly to Supabase; the signed URL is generated here
// on the server so the service role key is never exposed.
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    plantId: string;
    fileName: string;
    contentType: string;
  };

  if (!body.plantId || !body.fileName || !body.contentType) {
    return NextResponse.json(
      { error: "plantId, fileName, and contentType are required" },
      { status: 400 },
    );
  }

  // Validate content type — images only
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowedTypes.includes(body.contentType)) {
    return NextResponse.json(
      { error: "Unsupported content type" },
      { status: 415 },
    );
  }

  const storage = getStorageClient();
  const storagePath = `plants/${body.plantId}/${Date.now()}-${body.fileName}`;

  //   // Generate signed upload URL using Supabase Storage
  const { data, error } = await storage
    .from("plant-images")
    .createSignedUploadUrl(storagePath);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to generate signed URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
    token: data.token,
  });
}
