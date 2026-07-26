import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditProtectedSchemasNotExposed } from "./supabase-platform-audit.mjs";

const repoRoot = process.cwd();
const buildEnvScript = path.join(repoRoot, "scripts", "validate-build-env.mjs");
const distSecretsScript = path.join(repoRoot, "scripts", "verify-dist-secrets.mjs");

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
