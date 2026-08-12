import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createMenuPublicationChildEnvironment,
  parseMenuPublicationBuildTargetRows,
} from "../src/utils/menuPublicationBuild.mjs";
import {
  createSupabasePostgresClient,
  sanitizeSupabasePostgresError,
} from "../src/utils/supabasePostgresClient.mjs";
import { loadLocalEnv } from "./load-local-env.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const astroCliPath = path.join(repoRoot, "node_modules", "astro", "bin", "astro.mjs");
const privateDatabaseUrlEnvName = ["SUPABASE", "DB", "URL"].join("_");

export const resolveMenuPublicationBuildTarget = async ({
  databaseUrl,
  deploymentId,
  projectId,
}) => {
  const sql = createSupabasePostgresClient(databaseUrl);

  try {
    const rows = await sql`
      select request_id, revision_id, content_hash, snapshot_version
      from app_private.get_menu_publication_build_target(
        ${deploymentId}::text,
        ${projectId}::text
      )
    `;

    return parseMenuPublicationBuildTargetRows(rows);
  } finally {
    await sql.end();
  }
};

export const runMenuPublicationBuild = async (environment) => {
  if (environment === undefined) {
    loadLocalEnv(repoRoot);
  }

  const effectiveEnvironment = environment ?? process.env;

  const databaseUrl = effectiveEnvironment[privateDatabaseUrlEnvName]?.trim();

  if (!databaseUrl) {
    throw new Error("Private Supabase database URL is required for the menu publication build.");
  }

  const { deploymentId, projectId } = readVercelBuildBinding(effectiveEnvironment);
  const target = await resolveMenuPublicationBuildTarget({
    databaseUrl,
    deploymentId,
    projectId,
  });
  const childEnvironment = createMenuPublicationChildEnvironment(effectiveEnvironment, target);
  const result = spawnSync(process.execPath, [astroCliPath, "build"], {
    cwd: repoRoot,
    env: childEnvironment,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error("Astro build could not be started.", { cause: result.error });
  }

  if (result.signal) {
    throw new Error(`Astro build stopped after receiving signal ${result.signal}.`);
  }

  return result.status ?? 1;
};

export const readVercelBuildBinding = (environment) => {
  const deploymentId = readOptionalEnvironmentValue(environment, "VERCEL_DEPLOYMENT_ID");
  const projectId = readOptionalEnvironmentValue(environment, "VERCEL_PROJECT_ID");
  const isVercelBuild = readOptionalEnvironmentValue(environment, "VERCEL") === "1";

  if (isVercelBuild && (!deploymentId || !projectId)) {
    throw new Error(
      "Vercel system environment variables VERCEL_DEPLOYMENT_ID and VERCEL_PROJECT_ID are required.",
    );
  }

  if (!deploymentId && !isVercelBuild) {
    return {
      deploymentId: null,
      projectId: null,
    };
  }

  if (!projectId) {
    throw new Error("Vercel deployment and project IDs must be provided together.");
  }

  if (deploymentId && !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
    throw new Error("Vercel deployment ID is invalid.");
  }

  if (projectId && !/^prj_[A-Za-z0-9]+$/.test(projectId)) {
    throw new Error("Vercel project ID is invalid.");
  }

  return {
    deploymentId: deploymentId ?? null,
    projectId: projectId ?? null,
  };
};

const readOptionalEnvironmentValue = (environment, name) => {
  const value = environment[name];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const isDirectInvocation = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === scriptPath.toLowerCase();

if (isDirectInvocation) {
  try {
    process.exitCode = await runMenuPublicationBuild();
  } catch (error) {
    const databaseUrl = process.env[privateDatabaseUrlEnvName];

    console.error("Immutable menu publication build failed.");
    console.error(sanitizeSupabasePostgresError(error, databaseUrl));
    process.exitCode = 1;
  }
}
