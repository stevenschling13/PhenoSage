import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AuthenticatedWorkspaceUser = {
  admin: SupabaseClient;
  email: string;
  password: string;
  userId: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAdminClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function createAuthenticatedWorkspaceUser(): Promise<AuthenticatedWorkspaceUser> {
  const admin = getAdminClient();
  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const email = `playwright-smoke-${runId}@example.com`;
  const password = `PhenoSage!${runId}Aa`;

  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (userError || !userData.user) {
    throw new Error(
      `Failed to create smoke-test user: ${userError?.message ?? "unknown error"}`,
    );
  }

  return {
    admin,
    email,
    password,
    userId: userData.user.id,
  };
}

export async function cleanupAuthenticatedWorkspaceUser(
  workspace: AuthenticatedWorkspaceUser,
) {
  const { admin, userId } = workspace;

  const { data: imageRows } = await admin
    .from("plant_images")
    .select("storage_path")
    .eq("user_id", userId);

  const storagePaths = (imageRows ?? [])
    .map((row) => row.storage_path)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

  if (storagePaths.length > 0) {
    await admin.storage.from("plant-images").remove(storagePaths);
  }

  await admin.auth.admin.deleteUser(userId);
}
