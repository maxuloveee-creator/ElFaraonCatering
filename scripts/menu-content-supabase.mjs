import {
  createSnapshot,
  loadRows,
} from "../src/utils/menuSupabaseSnapshot.mjs";
import { createSupabasePostgresClient } from "../src/utils/supabasePostgresClient.mjs";
import { loadLocalEnv } from "./load-local-env.mjs";

const privateDatabaseUrlEnvName = ["SUPABASE", "DB", "URL"].join("_");

loadLocalEnv();

export const loadSupabaseMenuSnapshot = async (
  databaseUrl = process.env[privateDatabaseUrlEnvName],
) => {
  if (!databaseUrl) {
    throw new Error("Private Supabase database URL is required to read menu content.");
  }

  const sql = createSupabasePostgresClient(databaseUrl);

  try {
    return createSnapshot(await loadRows(sql));
  } finally {
    await sql.end();
  }
};
