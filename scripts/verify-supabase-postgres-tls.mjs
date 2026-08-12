import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSupabasePostgresClient,
  sanitizeSupabasePostgresError,
} from "../src/utils/supabasePostgresClient.mjs";
import { loadLocalEnv } from "./load-local-env.mjs";

const repoRoot = process.cwd();
const trustedCaPath = path.join(
  repoRoot,
  "config",
  "certs",
  "supabase-prod-ca-2021.crt",
);
const databaseUrlEnvironmentNames = ["SUPABASE_DB_URL", "SUPABASE_AUDIT_DB_URL"];

loadLocalEnv(repoRoot);

const missingVariables = databaseUrlEnvironmentNames.filter(
  (name) => !process.env[name]?.trim(),
);

if (missingVariables.length > 0) {
  console.error(
    `Missing required private database variables: ${missingVariables.join(", ")}.`,
  );
  process.exit(1);
}

const openSsl = findOpenSsl();
const endpoints = new Map();

for (const environmentName of databaseUrlEnvironmentNames) {
  const databaseUrl = process.env[environmentName];
  const endpoint = parseEndpoint(databaseUrl);
  endpoints.set(`${endpoint.hostname}:${endpoint.port}`, endpoint);

  const sql = createSupabasePostgresClient(databaseUrl);

  try {
    await sql`select 1 as tls_probe`;
    console.log(`${environmentName}: authenticated TLS connection passed.`);
  } catch (error) {
    console.error(
      `${environmentName}: ${sanitizeSupabasePostgresError(error, databaseUrl)}`,
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "el-faraon-tls-"));

try {
  const wrongCaPath = createWrongCertificateAuthority(openSsl, temporaryDirectory);

  for (const endpoint of endpoints.values()) {
    assertOpenSslVerificationSucceeds(openSsl, endpoint, trustedCaPath);
    assertOpenSslVerificationFails(openSsl, endpoint, trustedCaPath, "invalid.example");
    assertOpenSslVerificationFails(openSsl, endpoint, wrongCaPath, endpoint.hostname);
    console.log(`${endpoint.hostname}:${endpoint.port}: CA and hostname probes passed.`);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Supabase authenticated TLS verification passed.");

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_PATH,
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
      : undefined,
    "openssl",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "OpenSSL is required for the live negative CA and hostname verification probes.",
  );
}

function parseEndpoint(databaseUrl) {
  const parsedUrl = new URL(databaseUrl);

  return {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || "5432",
  };
}

function createWrongCertificateAuthority(openSsl, directory) {
  const keyPath = path.join(directory, "wrong-ca.key");
  const certificatePath = path.join(directory, "wrong-ca.crt");
  const result = runOpenSsl(openSsl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-batch",
    "-subj",
    "/CN=El Faraon TLS Negative Test",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
  ]);

  if (result.status !== 0) {
    throw new Error("OpenSSL could not create the temporary negative-test CA.");
  }

  return certificatePath;
}

function assertOpenSslVerificationSucceeds(openSsl, endpoint, caPath) {
  const result = verifyEndpoint(openSsl, endpoint, caPath, endpoint.hostname);

  if (result.status !== 0) {
    throw new Error(
      `Authenticated TLS verification failed for ${endpoint.hostname}:${endpoint.port}.`,
    );
  }
}

function assertOpenSslVerificationFails(openSsl, endpoint, caPath, hostname) {
  const result = verifyEndpoint(openSsl, endpoint, caPath, hostname);

  if (result.status === 0) {
    throw new Error(
      `Negative TLS verification unexpectedly succeeded for ${endpoint.hostname}:${endpoint.port}.`,
    );
  }
}

function verifyEndpoint(openSsl, endpoint, caPath, hostname) {
  return runOpenSsl(openSsl, [
    "s_client",
    "-starttls",
    "postgres",
    "-connect",
    `${endpoint.hostname}:${endpoint.port}`,
    "-servername",
    endpoint.hostname,
    "-CAfile",
    caPath,
    "-verify_hostname",
    hostname,
    "-verify_return_error",
    "-brief",
  ]);
}

function runOpenSsl(openSsl, args) {
  return spawnSync(openSsl, args, {
    encoding: "utf8",
    input: "",
    timeout: 30_000,
    windowsHide: true,
  });
}
