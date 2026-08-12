const publicationRevisionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const publicationContentHashPattern = /^[a-f0-9]{32}$/;
const publicationRequestIdPattern = /^[1-9][0-9]*$/;

export const supportedMenuPublicationSnapshotVersion = 1;

export const menuPublicationEnvironmentNames = Object.freeze({
  requestId: "MENU_PUBLICATION_REQUEST_ID",
  revisionId: "MENU_PUBLICATION_REVISION_ID",
  contentHash: "MENU_PUBLICATION_CONTENT_HASH",
  snapshotVersion: "MENU_PUBLICATION_SNAPSHOT_VERSION",
});

export const parseMenuPublicationBuildTargetRows = (rows) => {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Menu publication build target must resolve to exactly one row.");
  }

  return parseMenuPublicationBuildTarget(rows[0]);
};

export const parseMenuPublicationBuildTarget = (row) => {
  if (!isRecord(row)) {
    throw new Error("Menu publication build target is invalid.");
  }

  return {
    requestId: parseOptionalRequestId(row.request_id),
    revisionId: parseRevisionId(row.revision_id),
    contentHash: parseContentHash(row.content_hash),
    snapshotVersion: parseSnapshotVersion(row.snapshot_version),
  };
};

export const createMenuPublicationChildEnvironment = (environment, target) => ({
  ...environment,
  [menuPublicationEnvironmentNames.requestId]: target.requestId ?? "",
  [menuPublicationEnvironmentNames.revisionId]: target.revisionId,
  [menuPublicationEnvironmentNames.contentHash]: target.contentHash,
  [menuPublicationEnvironmentNames.snapshotVersion]: String(target.snapshotVersion),
});

export const readMenuPublicationBuildMetadata = (environment = process.env) => ({
  requestId: parseOptionalRequestId(
    readOptionalEnvironmentValue(environment, menuPublicationEnvironmentNames.requestId),
  ),
  revisionId: parseRevisionId(
    readEnvironmentValue(environment, menuPublicationEnvironmentNames.revisionId),
  ),
  contentHash: parseContentHash(
    readEnvironmentValue(environment, menuPublicationEnvironmentNames.contentHash),
  ),
  snapshotVersion: parseSnapshotVersion(
    readEnvironmentValue(environment, menuPublicationEnvironmentNames.snapshotVersion),
  ),
  deploymentId: readOptionalEnvironmentValue(environment, "VERCEL_DEPLOYMENT_ID"),
});

export const assertMatchingMenuPublicationRevision = (expected, actual) => {
  const normalizedActual = parseMenuPublicationBuildTarget({
    request_id: expected.requestId,
    revision_id: actual?.revision_id,
    content_hash: actual?.content_hash,
    snapshot_version: actual?.snapshot_version,
  });

  if (
    normalizedActual.revisionId !== expected.revisionId
    || normalizedActual.contentHash !== expected.contentHash
    || normalizedActual.snapshotVersion !== expected.snapshotVersion
  ) {
    throw new Error("Menu publication revision does not match the resolved build target.");
  }
};

export const parseMenuPublicationRevisionRows = (rows, expected) => {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Menu publication revision must resolve to exactly one row.");
  }

  const revision = rows[0];
  assertMatchingMenuPublicationRevision(expected, revision);

  if (!isRecord(revision.content_snapshot)) {
    throw new Error("Menu publication content snapshot must be an object.");
  }

  return revision;
};

const parseOptionalRequestId = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Menu publication request ID is invalid.");
  }

  if (typeof value === "bigint" && value <= 0n) {
    throw new Error("Menu publication request ID is invalid.");
  }

  const normalizedValue = typeof value === "bigint" ? value.toString() : String(value);

  if (!publicationRequestIdPattern.test(normalizedValue)) {
    throw new Error("Menu publication request ID is invalid.");
  }

  return normalizedValue;
};

const parseRevisionId = (value) => {
  if (typeof value !== "string") {
    throw new Error("Menu publication revision ID is invalid.");
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!publicationRevisionIdPattern.test(normalizedValue)) {
    throw new Error("Menu publication revision ID is invalid.");
  }

  return normalizedValue;
};

const parseContentHash = (value) => {
  if (typeof value !== "string") {
    throw new Error("Menu publication content hash is invalid.");
  }

  const normalizedValue = value.trim();

  if (!publicationContentHashPattern.test(normalizedValue)) {
    throw new Error("Menu publication content hash is invalid.");
  }

  return normalizedValue;
};

const parseSnapshotVersion = (value) => {
  const normalizedValue = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;

  if (
    !Number.isSafeInteger(normalizedValue)
    || normalizedValue !== supportedMenuPublicationSnapshotVersion
  ) {
    throw new Error("Menu publication snapshot version is unsupported.");
  }

  return normalizedValue;
};

const readEnvironmentValue = (environment, name) => {
  const value = readOptionalEnvironmentValue(environment, name);

  if (!value) {
    throw new Error(`Build environment is missing required variable: ${name}.`);
  }

  return value;
};

const readOptionalEnvironmentValue = (environment, name) => {
  const value = environment?.[name];

  return typeof value === "string" ? value.trim() : undefined;
};

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
