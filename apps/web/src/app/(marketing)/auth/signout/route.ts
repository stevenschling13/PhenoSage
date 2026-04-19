import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/auth";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createSupabaseServerClient();

  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
