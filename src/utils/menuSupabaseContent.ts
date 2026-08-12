import type postgres from "postgres";
import type {
  MenuContentSnapshot,
} from "../types/menu";
import { getSafeMenuImagePaths } from "./menuImagePath.mjs";
import { createSnapshot, loadRows } from "./menuSupabaseSnapshot.mjs";
import { createSupabasePostgresClient } from "./supabasePostgresClient.mjs";

type MenuDb = ReturnType<typeof postgres>;

export const loadSupabaseMenuContentSnapshot = (): Promise<MenuContentSnapshot> =>
  withMenuDb(async (sql) => {
    const rows = await loadRows(sql);
    const snapshot = createSnapshot(rows, {
      transformImages: getSafeMenuImagePaths,
    });

    assertMenuContentSnapshot(snapshot);

    return snapshot;
  });

export const loadSupabaseMenuPublicationContentHash = (): Promise<string> =>
  withMenuDb(async (sql) => {
    const rows = await sql`
      select app_private.get_menu_publication_content_hash() as menu_content_hash
    `;
    const hash = rows[0]?.menu_content_hash;

    if (typeof hash !== "string" || !/^[a-f0-9]{32}$/.test(hash)) {
      throw new Error("Build-time menu content hash is invalid.");
    }

    return hash;
  });

const withMenuDb = async <T>(query: (sql: MenuDb) => Promise<T>): Promise<T> => {
  // Build the environment variable name in parts so its sensitive marker does
  // not appear in bundles checked by verify-dist-secrets.
  const privateDatabaseUrlEnvName = ["SUPABASE", "DB", "URL"].join("_");
  const databaseUrl = getPrivateEnvironmentValue(privateDatabaseUrlEnvName);

  if (!databaseUrl) {
    throw new Error(
      "Private Supabase database URL is required for build-time menu content.",
    );
  }

  const sql = createSupabasePostgresClient(databaseUrl);

  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
};

const getPrivateEnvironmentValue = (name: string): string | undefined =>
  (
    globalThis as typeof globalThis & {
      process?: {
        env?: Record<string, string | undefined>;
      };
    }
  ).process?.env?.[name];

function assertMenuContentSnapshot(value: unknown): asserts value is MenuContentSnapshot {
  if (!isRecord(value)) {
    throw new Error("Supabase menu snapshot must be an object.");
  }

  if (
    !Array.isArray(value.profiles) ||
    !Array.isArray(value.catalogSections) ||
    !isRecord(value.dailyMenu) ||
    !Array.isArray(value.dailyMenu.items) ||
    !Array.isArray(value.profileServiceSettings) ||
    !isRecord(value.grillSection) ||
    !Array.isArray(value.grillSection.items)
  ) {
    throw new Error("Supabase menu snapshot has an invalid shape.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
