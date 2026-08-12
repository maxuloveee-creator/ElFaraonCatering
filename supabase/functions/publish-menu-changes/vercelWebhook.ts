const webhookSignaturePattern = /^[a-f0-9]{40}$/i;
const eventIdPattern = /^[A-Za-z0-9_-]{1,256}$/;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]{1,200}$/;
const observationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const evidenceEventIdPattern = /^[A-Za-z0-9:_-]{1,256}$/;
const projectIdPattern = /^prj_[A-Za-z0-9]+$/;
const teamIdPattern = /^team_[A-Za-z0-9]+$/;
const requestIdPattern = /^[1-9][0-9]*$/;
const revisionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const contentHashPattern = /^[a-f0-9]{32}$/;
const oldestAcceptedEventMs = 25 * 60 * 60 * 1000;
const newestAcceptedEventMs = 5 * 60 * 1000;

export const maxVercelWebhookBodyBytes = 128 * 1024;

export type PublishFunctionRoute = "publish" | "status" | "vercel_webhook" | "not_found";

export interface CanonicalAdminUrl {
  url: string;
  hostname: string;
}

export const getPublishFunctionRoute = (pathname: string): PublishFunctionRoute => {
  const pathSegments = pathname.split("/").filter(Boolean);
  const functionIndex = pathSegments.indexOf("publish-menu-changes");

  if (functionIndex === -1) {
    return "not_found";
  }

  const routeSegments = pathSegments.slice(functionIndex + 1);

  if (routeSegments.length === 0) {
    return "publish";
  }

  if (routeSegments.length === 1 && routeSegments[0] === "status") {
    return "status";
  }

  if (routeSegments.length === 1 && routeSegments[0] === "vercel-webhook") {
    return "vercel_webhook";
  }

  return "not_found";
};

export const parseCanonicalAdminUrl = (value: string): CanonicalAdminUrl | null => {
  if (!value || value !== value.trim() || /\s/.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.port !== ""
      || url.search !== ""
      || url.hash !== ""
      || !url.pathname.endsWith("/admin/")
      || url.toString() !== value
      || !isDnsHostname(url.hostname)
    ) {
      return null;
    }

    return { url: value, hostname: url.hostname };
  } catch {
    return null;
  }
};

export const createCanonicalProbeEvidenceEventId = (
  deploymentId: string,
  observationId: string,
): string | null => {
  if (!deploymentIdPattern.test(deploymentId) || !observationIdPattern.test(observationId)) {
    return null;
  }

  const evidenceEventId = `canonical:${deploymentId}:${observationId.toLowerCase()}`;

  return evidenceEventIdPattern.test(evidenceEventId) ? evidenceEventId : null;
};

interface JsonRecord {
  [key: string]: unknown;
}

export interface VercelPromotionEvent {
  eventId: string;
  eventCreatedAt: string;
  deploymentId: string;
  deploymentHost: string;
  projectId: string;
  teamId: string | null;
}

export interface PublicationArtifact {
  requestId: string | null;
  revisionId: string;
  contentHash: string;
  deploymentId: string;
}

export type VercelPromotionParseResult =
  | { accepted: true; event: VercelPromotionEvent }
  | { accepted: false; reason: string };

export const verifyVercelWebhookSignature = async (
  rawBody: Uint8Array,
  providedSignature: string | null,
  secret: string,
): Promise<boolean> => {
  if (!providedSignature || !webhookSignaturePattern.test(providedSignature)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const bodyBuffer = new ArrayBuffer(rawBody.byteLength);
  new Uint8Array(bodyBuffer).set(rawBody);
  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bodyBuffer),
  );
  const providedBytes = decodeHex(providedSignature);

  if (!providedBytes || providedBytes.length !== expectedSignature.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < expectedSignature.length; index += 1) {
    difference |= expectedSignature[index] ^ providedBytes[index];
  }

  return difference === 0;
};

export const parseVercelPromotionEvent = (
  value: unknown,
  expectedProjectId: string,
  expectedTeamId: string | null,
  nowMs = Date.now(),
): VercelPromotionParseResult => {
  const event = asRecord(value);

  if (!event || event.type !== "deployment.promoted") {
    return { accepted: false, reason: "event_type_ignored" };
  }

  const eventId = getBoundedIdentifier(event.id, eventIdPattern);
  const createdAtMs = parseEventTimestamp(event.createdAt);
  const payload = asRecord(event.payload);
  const deployment = asRecord(payload?.deployment);
  const project = asRecord(payload?.project);
  const teamValue = payload?.team;
  const team = teamValue === null ? null : asRecord(teamValue);

  if (
    !eventId
    || createdAtMs === null
    || !payload
    || !deployment
    || !project
    || (teamValue !== null && !team)
  ) {
    return { accepted: false, reason: "event_shape_invalid" };
  }

  if (
    createdAtMs < nowMs - oldestAcceptedEventMs
    || createdAtMs > nowMs + newestAcceptedEventMs
  ) {
    return { accepted: false, reason: "event_timestamp_rejected" };
  }

  const projectId = getBoundedIdentifier(project.id, projectIdPattern);
  const teamId = team === null ? null : getBoundedIdentifier(team?.id, teamIdPattern);

  if (!projectId || projectId !== expectedProjectId) {
    return { accepted: false, reason: "project_mismatch" };
  }

  if (expectedTeamId !== null && teamId !== expectedTeamId) {
    return { accepted: false, reason: "team_mismatch" };
  }

  if (expectedTeamId === null && team !== null && teamId === null) {
    return { accepted: false, reason: "team_invalid" };
  }

  // deployment.promoted is itself production-only. Some Vercel payload versions
  // also expose target; when present, it must agree with that event contract.
  const target = payload.target ?? deployment.target;

  if (target !== undefined && target !== "production") {
    return { accepted: false, reason: "target_mismatch" };
  }

  const deploymentId = getBoundedIdentifier(deployment.id, deploymentIdPattern);
  const deploymentHost = parseVercelDeploymentHost(deployment.url);

  if (!deploymentId || !deploymentHost) {
    return { accepted: false, reason: "deployment_invalid" };
  }

  return {
    accepted: true,
    event: {
      eventId,
      eventCreatedAt: new Date(createdAtMs).toISOString(),
      deploymentId,
      deploymentHost,
      projectId,
      teamId,
    },
  };
};

export const parsePublicationArtifact = (html: string): PublicationArtifact | null => {
  const rawRequestId = getHtmlAttribute(html, "data-publication-request-id");
  const requestId = rawRequestId === null || rawRequestId === "" ? null : rawRequestId;
  const revisionId = getHtmlAttribute(html, "data-publication-revision-id")?.toLowerCase();
  const contentHash = getCompatibleHtmlAttribute(
    html,
    "data-publication-content-hash",
    "data-deployed-content-hash",
  );
  const deploymentId = getCompatibleHtmlAttribute(
    html,
    "data-vercel-deployment-id",
    "data-publication-deployment-id",
  );

  if (
    (requestId !== null && !requestIdPattern.test(requestId))
    || !revisionId
    || !revisionIdPattern.test(revisionId)
    || !contentHash
    || !contentHashPattern.test(contentHash)
    || !deploymentId
    || !deploymentIdPattern.test(deploymentId)
  ) {
    return null;
  }

  return {
    requestId,
    revisionId,
    contentHash,
    deploymentId,
  };
};

export const isVercelProjectId = (value: string): boolean => projectIdPattern.test(value);

export const isVercelTeamId = (value: string): boolean => teamIdPattern.test(value);

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const getBoundedIdentifier = (value: unknown, pattern: RegExp): string | null =>
  typeof value === "string" && pattern.test(value) ? value : null;

const parseEventTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0 && value.length <= 64) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseVercelDeploymentHost = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > 253) {
    return null;
  }

  const host = value.toLowerCase();

  if (host !== value || !host.endsWith(".vercel.app")) {
    return null;
  }

  return isDnsHostname(host) && host.split(".").length >= 3 ? host : null;
};

const isDnsHostname = (hostname: string): boolean => {
  if (hostname.length === 0 || hostname.length > 253 || hostname !== hostname.toLowerCase()) {
    return false;
  }

  const labels = hostname.split(".");

  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) =>
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
};

const getHtmlAttribute = (html: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(html);
  const value = match?.[1] ?? match?.[2];

  return typeof value === "string" ? value.trim() : null;
};

const getCompatibleHtmlAttribute = (
  html: string,
  canonicalName: string,
  legacyName: string,
): string | null => {
  const canonicalValue = getHtmlAttribute(html, canonicalName);
  const legacyValue = getHtmlAttribute(html, legacyName);

  if (canonicalValue && legacyValue && canonicalValue !== legacyValue) {
    return null;
  }

  return canonicalValue ?? legacyValue;
};

const decodeHex = (value: string): Uint8Array | null => {
  if (value.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16);

    if (!Number.isFinite(byte)) {
      return null;
    }

    bytes[index / 2] = byte;
  }

  return bytes;
};
