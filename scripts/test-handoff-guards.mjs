import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProtectedSchemasNotExposed } from "./supabase-platform-audit.mjs";

const repoRoot = process.cwd();
const buildEnvScript = path.join(repoRoot, "scripts", "validate-build-env.mjs");
const distSecretsScript = path.join(repoRoot, "scripts", "verify-dist-secrets.mjs");
const publishFunctionPath = path.join(
  repoRoot,
  "supabase",
  "functions",
  "publish-menu-changes",
  "index.ts",
);
const productionOrigin = "https://elfaraoncatering.com.ar";
const legacyProductionHost = "elfaraoncatering.vercel.app";

test("production domain stays aligned across application and Supabase configuration", async () => {
  const [astroConfig, baseLayout, supabaseConfig, envExample, robots, sitemap] =
    await Promise.all([
      readFile(path.join(repoRoot, "astro.config.mjs"), "utf8"),
      readFile(path.join(repoRoot, "src", "layouts", "BaseLayout.astro"), "utf8"),
      readFile(path.join(repoRoot, "supabase", "config.toml"), "utf8"),
      readFile(path.join(repoRoot, ".env.example"), "utf8"),
      readFile(path.join(repoRoot, "public", "robots.txt"), "utf8"),
      readFile(path.join(repoRoot, "public", "sitemap.xml"), "utf8"),
    ]);
  const vercelConfig = await readFile(path.join(repoRoot, "vercel.json"), "utf8");

  const legacyHostRedirect = JSON.parse(vercelConfig).redirects?.find(
    (redirect) =>
      redirect.has?.some(
        (condition) =>
          condition.type === "host" && condition.value === legacyProductionHost,
      ),
  );

  assert.equal(astroConfig.includes(`site: "${productionOrigin}"`), true);
  assert.match(baseLayout, /rel="canonical"/);
  assert.match(baseLayout, /property="og:url"/);
  assert.equal(supabaseConfig.includes(`site_url = "${productionOrigin}"`), true);
  assert.equal(supabaseConfig.includes(`"${productionOrigin}/admin/"`), true);
  assert.doesNotMatch(supabaseConfig, /elfaraoncatering\.vercel\.app/);
  assert.equal(envExample.includes(`PUBLISH_ALLOWED_ORIGINS=${productionOrigin}`), true);
  assert.equal(robots.includes(`Sitemap: ${productionOrigin}/sitemap.xml`), true);
  assert.equal(sitemap.includes(`<loc>${productionOrigin}/</loc>`), true);
  assert.deepEqual(legacyHostRedirect, {
    source: "/(.*)",
    has: [{ type: "host", value: legacyProductionHost }],
    destination: `${productionOrigin}/$1`,
    permanent: true,
  });
});

test("publish Edge Function pins the Supabase client to an exact version", async () => {
  const functionSource = await readFile(publishFunctionPath, "utf8");

  assert.match(
    functionSource,
    /from "npm:@supabase\/supabase-js@\d+\.\d+\.\d+";/,
  );
});

test("publish Edge Function validates confirmation configuration before reservation", async () => {
  const functionSource = await readFile(publishFunctionPath, "utf8");
  const publishHandler = functionSource.slice(
    functionSource.indexOf("const handleOperatorPublish"),
    functionSource.indexOf("Deno.serve"),
  );
  const configurationCheckIndex = publishHandler.indexOf(
    "const confirmationConfig = getPublicationConfirmationConfiguration()",
  );
  const reservationIndex = publishHandler.indexOf('"reserve_menu_publish_request"');

  assert.notEqual(configurationCheckIndex, -1);
  assert.notEqual(reservationIndex, -1);
  assert.ok(configurationCheckIndex < reservationIndex);
  assert.match(functionSource, /getRequiredEnv\("VERCEL_PROJECT_ID"\)/);
  assert.match(functionSource, /Deno\.env\.get\("PUBLISH_CANONICAL_ADMIN_URL"\)/);
});

test("menu image optimizer declares and loads sharp directly", async () => {
  const packageManifest = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  );

  assert.equal(packageManifest.devDependencies?.sharp, "^0.35.3");

  const sharpModule = await import("sharp");
  assert.equal(typeof sharpModule.default, "function");
});

test("build environment guard requires both public Supabase variables", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "el-faraon-build-env-"));

  try {
    const missingBoth = runNode(buildEnvScript, tempRoot, {});
    const missingKey = runNode(buildEnvScript, tempRoot, {
      PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    const complete = runNode(buildEnvScript, tempRoot, {
      PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    });

    assert.notEqual(missingBoth.status, 0);
    assert.match(missingBoth.stderr, /PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY/);
    assert.notEqual(missingKey.status, 0);
    assert.match(missingKey.stderr, /PUBLIC_SUPABASE_ANON_KEY/);
    assert.equal(complete.status, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("dist secret guard detects raw and encoded private database URLs", async () => {
  const fakeDatabaseUrl = "postgresql://build-user:private-pass@example.invalid:5432/postgres";

  for (const value of [fakeDatabaseUrl, encodeURIComponent(fakeDatabaseUrl)]) {
    const result = await runDistGuard(value, { SUPABASE_DB_URL: fakeDatabaseUrl });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SUPABASE_DB_URL (raw|encoded) value/);
    assert.equal(result.stderr.includes(fakeDatabaseUrl), false);
  }
});

test("dist secret guard detects Vercel Deploy Hook URLs without their environment value", async () => {
  const result = await runDistGuard(
    "https://api.vercel.com/v1/integrations/deploy/example-hook-id",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api\.vercel\.com\/v1\/integrations\/deploy\//);
});

test("dist secret guard detects publication webhook and bypass secrets", async () => {
  for (const [name, value] of [
    ["VERCEL_WEBHOOK_SECRET", "webhook-secret-value"],
    ["VERCEL_DEPLOYMENT_BYPASS_SECRET", "bypass-secret-value"],
  ]) {
    const result = await runDistGuard(value, { [name]: value });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${name} (raw|encoded) value`));
    assert.equal(result.stderr.includes(value), false);
  }
});

test("dist secret guard accepts safe static output", async () => {
  const result = await runDistGuard("safe static content");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Secret verification passed/);
});

test("Data API audit accepts only PGRST106 for protected schemas", async () => {
  const requests = [];
  const safeFailures = await auditProtectedSchemasNotExposed({
    supabaseUrl: "https://example.supabase.co/",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return jsonResponse(406, { code: "PGRST106" });
    },
  });

  assert.deepEqual(safeFailures, []);
  assert.deepEqual(
    requests.map((request) => request.options.headers["Accept-Profile"]),
    ["app_private", "menu_content"],
  );

  const exposedFailures = await auditProtectedSchemasNotExposed({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon-key",
    async fetchImpl() {
      return jsonResponse(401, { code: "42501" });
    },
  });

  assert.equal(exposedFailures.length, 2);
  assert.match(exposedFailures[0], /did not return PGRST106/);
});

async function runDistGuard(content, extraEnv = {}) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "el-faraon-dist-guard-"));

  try {
    const distDir = path.join(tempRoot, "dist");
    await mkdir(distDir);
    await writeFile(path.join(distDir, "index.html"), content, "utf8");
    return runNode(distSecretsScript, tempRoot, extraEnv);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function runNode(scriptPath, cwd, extraEnv) {
  const env = { ...process.env };
  delete env.PUBLIC_SUPABASE_URL;
  delete env.PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_DB_URL;
  delete env.SUPABASE_AUDIT_DB_URL;
  delete env.VERCEL_DEPLOY_HOOK_URL;
  delete env.VERCEL_WEBHOOK_SECRET;
  delete env.VERCEL_DEPLOYMENT_BYPASS_SECRET;

  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
}

function jsonResponse(status, body) {
  return {
    status,
    async json() {
      return body;
    },
  };
}
