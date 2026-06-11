import "server-only";

import { createSupabaseServerClient, getServerUser } from "./auth";
import { getDbClient } from "./db";
import { logServerEvent } from "./request-id";
import { getStorageClient } from "./storage";

/**
 * Rows per table included in an export. Bounds response size; a grower
 * with more rows than this in one table is far outside current product
 * scale and can request a manual export.
 */
const EXPORT_ROW_CAP = 5000;
/** Supabase Storage remove() batch size. */
const STORAGE_REMOVE_BATCH = 100;
const PLANT_IMAGES_BUCKET = "plant-images";

/** Tables included in a user data export, read with the SESSION client
 * so RLS scopes every query to what the user can already see. */
const EXPORT_TABLES = [
  "profiles",
  "grows",
  "plants",
  "plant_images",
  "plant_observations",
  "plant_findings",
  "plant_analyses",
  "grow_events",
  "grow_tasks",
  "notifications",
  "user_preferences",
  "chat_threads",
  "chat_messages",
] as const;

export type AccountExport = {
  exportedAt: string;
  userId: string;
  email: string | null;
  tables: Record<string, unknown[]>;
};

/**
 * Collect everything the authenticated user can see into one JSON
 * payload (data-portability / GDPR-style export). Uses the session
 * client throughout: RLS is the authorization boundary, so this can
 * never over-export even if the table list grows.
 */
export async function exportAccountData(): Promise<AccountExport | null> {
  const user = await getServerUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const tables: Record<string, unknown[]> = {};

  const results = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .limit(EXPORT_ROW_CAP);
      if (error) {
        throw new Error(`Failed to export ${table}: ${error.message}`);
      }
      return [table, data ?? []] as const;
    }),
  );
  for (const [table, rows] of results) {
    tables[table] = rows;
  }

  return {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    email: user.email ?? null,
    tables,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export type DeleteAccountResult = {
  deletedStorageObjects: number;
  storageErrors: number;
};

/**
 * Permanently delete a user account and all associated data.
 *
 * Order matters:
 *  1. Collect plant-image storage paths BEFORE the rows disappear —
 *     both images in grows the user owns and images the user uploaded
 *     into other grows.
 *  2. Remove the storage objects (best-effort: the bucket is private
 *     and signed-URL-only, so an orphaned object is unreachable; a
 *     partial storage failure must not strand the account half-deleted).
 *  3. `auth.admin.deleteUser` — migration 20260611160000 makes every
 *     auth.users reference cascade or set-null, so this removes all
 *     database rows atomically.
 *
 * Caller is responsible for verifying the requesting session owns
 * `userId` — this function trusts its argument and uses the service
 * role.
 */
export async function deleteAccount(
  userId: string,
  requestId: string,
): Promise<DeleteAccountResult> {
  const db = getDbClient();

  const { data: ownedGrows, error: growsError } = await db
    .from("grows")
    .select("id")
    .eq("owner_id", userId);
  if (growsError) {
    throw new Error(`Failed to list grows for deletion: ${growsError.message}`);
  }
  const growIds = ((ownedGrows ?? []) as { id: string }[]).map((g) => g.id);

  const paths = new Set<string>();
  const { data: uploaded, error: uploadedError } = await db
    .from("plant_images")
    .select("storage_path")
    .eq("user_id", userId);
  if (uploadedError) {
    throw new Error(
      `Failed to list uploaded images for deletion: ${uploadedError.message}`,
    );
  }
  for (const row of (uploaded ?? []) as { storage_path: string }[]) {
    paths.add(row.storage_path);
  }
  if (growIds.length > 0) {
    const { data: inGrows, error: inGrowsError } = await db
      .from("plant_images")
      .select("storage_path")
      .in("grow_id", growIds);
    if (inGrowsError) {
      throw new Error(
        `Failed to list grow images for deletion: ${inGrowsError.message}`,
      );
    }
    for (const row of (inGrows ?? []) as { storage_path: string }[]) {
      paths.add(row.storage_path);
    }
  }

  let deletedStorageObjects = 0;
  let storageErrors = 0;
  if (paths.size > 0) {
    const storage = getStorageClient();
    for (const batch of chunk([...paths], STORAGE_REMOVE_BATCH)) {
      const { data: removed, error: removeError } = await storage
        .from(PLANT_IMAGES_BUCKET)
        .remove(batch);
      if (removeError) {
        storageErrors += batch.length;
        logServerEvent("warn", "account delete: storage batch failed", {
          requestId,
          userId,
          batchSize: batch.length,
          error: removeError.message,
        });
      } else {
        // remove() reports the objects it actually deleted; count those
        // rather than the requested batch so the API never overstates.
        deletedStorageObjects += (removed ?? []).length;
      }
    }
  }

  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new Error(`Failed to delete auth user: ${deleteError.message}`);
  }

  logServerEvent("info", "account delete: completed", {
    requestId,
    userId,
    grows: growIds.length,
    deletedStorageObjects,
    storageErrors,
  });
  return { deletedStorageObjects, storageErrors };
}
