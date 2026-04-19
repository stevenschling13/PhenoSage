import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/server/auth";
import { getDbClient } from "@/lib/server/db";
import { AssistantChat } from "./assistant-chat";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

interface GrowOption {
  id: string;
  name: string;
}

export default async function AssistantPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/assistant");

  const db = getDbClient();
  const [ownedRes, memberRes] = await Promise.all([
    db
      .from("grows")
      .select("id, name")
      .eq("owner_id", user.id)
      .eq("is_archived", false)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("grow_members")
      .select("grow_id, grows(id, name, is_archived)")
      .eq("user_id", user.id),
  ]);

  const owned = ((ownedRes.data ?? []) as GrowOption[]).map((g) => ({
    id: g.id,
    name: g.name,
  }));

  const memberRows = (memberRes.data ?? []) as unknown as Array<{
    grows:
      | { id: string; name: string; is_archived: boolean }
      | { id: string; name: string; is_archived: boolean }[]
      | null;
  }>;
  const memberOf: GrowOption[] = memberRows.flatMap((r) => {
    const rows = Array.isArray(r.grows) ? r.grows : r.grows ? [r.grows] : [];
    return rows
      .filter((g) => !g.is_archived)
      .map((g) => ({ id: g.id, name: g.name }));
  });

  const seen = new Set<string>();
  const grows: GrowOption[] = [];
  for (const g of [...owned, ...memberOf]) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      grows.push(g);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Grow Copilot</h1>
          <p className="text-xs text-gray-400">
            AI assistant grounded in your grow data
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
      </header>

      <AssistantChat grows={grows} />
    </main>
  );
}
