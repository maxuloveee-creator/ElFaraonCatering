import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { checkServerIdentity } from "node:tls";
import postgres from "postgres";

const trustedCaPath = path.resolve(
  process.cwd(),
  "config",
  "certs",
  "supabase-prod-ca-2021.crt",
);
const clientOwnedTlsParameters = [
  "ssl",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslrootcert",
];

let trustedCa;

export function createSupabasePostgresClient(databaseUrl) {
  const parsedUrl = parseDatabaseUrl(databaseUrl);

  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === "0") {
    throw new Error(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 is incompatible with authenticated database TLS.",
    );
  }

  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: {
      ca: loadTrustedCa(),
      checkServerIdentity,
      rejectUnauthorized: true,
      servername: parsedUrl.hostname,
    },
  });
}

export function sanitizeSupabasePostgresError(error, databaseUrl, additionalSecrets = []) {
  const message = error instanceof Error ? error.message : String(error);
  const secrets = new Set([databaseUrl, ...additionalSecrets]);

  try {
    const parsedUrl = new URL(databaseUrl);

    secrets.add(parsedUrl.href);
    secrets.add(parsedUrl.username);
    secrets.add(parsedUrl.password);
    addDecodedSecret(secrets, databaseUrl);
    addDecodedSecret(secrets, parsedUrl.username);
    addDecodedSecret(secrets, parsedUrl.password);
  } catch {
    // Configuration errors already use messages that do not include the DSN.
  }

  return [...secrets]
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((sanitized, secret) => sanitized.replaceAll(secret, "[redacted]"), message);
}

function parseDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
    throw new Error("A private Supabase database URL is required.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("The private Supabase database URL is invalid.");
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("The private Supabase database URL must use PostgreSQL.");
  }

  if (!parsedUrl.hostname || isIP(parsedUrl.hostname) !== 0) {
    throw new Error(
      "The private Supabase database URL must use a DNS hostname for TLS verification.",
    );
  }

  const sslModes = parsedUrl.searchParams.getAll("sslmode");

  if (
    sslModes.length > 1
    || (sslModes.length === 1 && sslModes[0].toLowerCase() !== "verify-full")
  ) {
    throw new Error(
      "The private Supabase database URL must omit sslmode or use verify-full.",
    );
  }

  if (clientOwnedTlsParameters.some((parameter) => parsedUrl.searchParams.has(parameter))) {
    throw new Error(
      "The private Supabase database URL must not override client-managed TLS options.",
    );
  }

  return parsedUrl;
}

function loadTrustedCa() {
  if (trustedCa) {
    return trustedCa;
  }

  const pem = readFileSync(trustedCaPath, "utf8");
  const certificateBlocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  ) ?? [];

  if (
    certificateBlocks.length !== 1
    || /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(pem)
  ) {
    throw new Error("The trusted Supabase CA file has an invalid PEM structure.");
  }

  const certificate = new X509Certificate(certificateBlocks[0]);
  const now = Date.now();

  if (
    !certificate.ca
    || now < Date.parse(certificate.validFrom)
    || now > Date.parse(certificate.validTo)
  ) {
    throw new Error("The trusted Supabase CA certificate is not currently valid.");
  }

  trustedCa = pem;
  return trustedCa;
}

function addDecodedSecret(secrets, value) {
  if (!value) {
    return;
  }

  try {
    secrets.add(decodeURIComponent(value));
  } catch {
    // Invalid percent encoding is already covered by redacting the raw value.
  }
}
