import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createSupabasePostgresClient,
  sanitizeSupabasePostgresError,
} from "../src/utils/supabasePostgresClient.mjs";

const repoRoot = process.cwd();
const trustedCaPath = path.join(
  repoRoot,
  "config",
  "certs",
  "supabase-prod-ca-2021.crt",
);
const minimumCertificateLifetimeMs = 365 * 24 * 60 * 60 * 1000;
const expectedFactoryConsumers = [
  "scripts/audit-supabase-readonly.mjs",
  "scripts/menu-content-supabase.mjs",
  "scripts/validate-menu-supabase.mjs",
  "src/utils/menuSupabaseContent.ts",
];

test("versioned Supabase certificate is a current CA with at least one year remaining", async () => {
  const pem = await readFile(trustedCaPath, "utf8");
  const certificateBlocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  ) ?? [];

  assert.equal(certificateBlocks.length, 1);
  assert.doesNotMatch(pem, /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/);

  const certificate = new X509Certificate(certificateBlocks[0]);
  const now = Date.now();

  assert.equal(certificate.ca, true);
  assert.ok(Date.parse(certificate.validFrom) <= now);
  assert.ok(Date.parse(certificate.validTo) - now >= minimumCertificateLifetimeMs);
});

test("weak and conflicting TLS DSN options fail before a client can connect", () => {
  const weakModes = ["disable", "allow", "prefer", "require", "verify-ca"];

  for (const sslMode of weakModes) {
    assert.throws(
      () => createSupabasePostgresClient(databaseUrl(`sslmode=${sslMode}`)),
      /must omit sslmode or use verify-full/,
    );
  }

  assert.throws(
    () =>
      createSupabasePostgresClient(
        databaseUrl("sslmode=verify-full&sslmode=verify-full"),
      ),
    /must omit sslmode or use verify-full/,
  );
  assert.throws(
    () => createSupabasePostgresClient(databaseUrl("sslrootcert=other.crt")),
    /must not override client-managed TLS options/,
  );
  assert.throws(
    () =>
      createSupabasePostgresClient(
        "postgresql://menu-build:private-password@127.0.0.1:5432/postgres",
      ),
    /must use a DNS hostname/,
  );
});

test("global Node TLS verification cannot be disabled", () => {
  const previousValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    assert.throws(
      () => createSupabasePostgresClient(databaseUrl()),
      /NODE_TLS_REJECT_UNAUTHORIZED=0/,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousValue;
    }
  }
});

test("database error sanitization removes raw and decoded secrets", () => {
  const url =
    "postgresql://menu-build:p%40ssword@example.pooler.supabase.com:5432/postgres";
  const additionalSecret = "public-test-secret";
  const sanitized = sanitizeSupabasePostgresError(
    new Error(`Failed for ${url} using p@ssword and ${additionalSecret}`),
    url,
    [additionalSecret],
  );

  assert.equal(sanitized.includes(url), false);
  assert.equal(sanitized.includes("p@ssword"), false);
  assert.equal(sanitized.includes(additionalSecret), false);
});

test("all direct Postgres.js clients use the authenticated TLS factory", async () => {
  const sourceFiles = await listSourceFiles(
    [path.join(repoRoot, "scripts"), path.join(repoRoot, "src")],
    new Set([".js", ".mjs", ".ts"]),
  );
  const directConstructions = [];

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    const matches = source.match(/\bpostgres\s*\(/g) ?? [];

    if (matches.length > 0) {
      directConstructions.push({
        file: normalizeRelativePath(file),
        count: matches.length,
      });
    }
  }

  assert.deepEqual(directConstructions, [
    { file: "src/utils/supabasePostgresClient.mjs", count: 1 },
  ]);

  for (const consumer of expectedFactoryConsumers) {
    const source = await readFile(path.join(repoRoot, consumer), "utf8");
    assert.match(source, /createSupabasePostgresClient/);
  }
});

function databaseUrl(query = "") {
  const suffix = query ? `?${query}` : "";
  return `postgresql://menu-build:private-password@example.pooler.supabase.com:5432/postgres${suffix}`;
}

async function listSourceFiles(directories, extensions) {
  const files = [];

  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await listSourceFiles([entryPath], extensions)));
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function normalizeRelativePath(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}
