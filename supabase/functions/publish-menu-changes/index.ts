import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  getCorsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../_shared/cors.ts";
import {
  createCanonicalProbeEvidenceEventId,
  getPublishFunctionRoute,
  isVercelProjectId,
  isVercelTeamId,
  maxVercelWebhookBodyBytes,
  parseCanonicalAdminUrl,
  parsePublicationArtifact,
  parseVercelPromotionEvent,
  verifyVercelWebhookSignature,
} from "./vercelWebhook.ts";

const operation = "publish_menu_changes";
const defaultStaleSeconds = 900;
const maxStaleSeconds = 3600;
const vercelHookTimeoutMs = 10000;
const deploymentArtifactTimeoutMs = 5000;
const maxDeploymentArtifactBytes = 1024 * 1024;

type PublishMessage =
  | "cors_origin_not_allowed"
  | "method_not_allowed"
  | "unauthorized"
  | "permission_denied"
  | "publish_not_configured"
  | "publish_already_active"
  | "publish_already_current"
  | "publish_queued"
  | "publish_failed";

interface PublishResponse {
  ok: boolean;
  changed: boolean;
  requires_redeploy: boolean;
  operation: typeof operation;
  message: PublishMessage;
}

interface ReservePublishRow {
  request_id: unknown;
  reserved: boolean;
  message: string;
}

interface ConfirmPublishRow {
  confirmed: boolean;
  message: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface OperatorAuthorization {
  authorized: true;
  supabaseUrl: string;
  userId: string;
}

interface OperatorRejection {
  authorized: false;
  response: Response;
}

interface ConfirmationEvidence {
  requestId: string | null;
  revisionId: string;
  deploymentId: string;
  deploymentHost: string;
  contentHash: string;
  evidenceEventId: string;
  evidenceSource: "vercel_webhook" | "canonical_probe";
  eventCreatedAt: string;
  projectId: string;
  teamId: string | null;
}

interface PublicationConfirmationConfiguration {
  serviceRoleKey: string;
  projectId: string;
  teamId: string | null;
  canonicalAdminUrl: { url: string; hostname: string };
}

class BodyLimitExceededError extends Error {
  constructor() {
    super("Body limit exceeded.");
    this.name = "BodyLimitExceededError";
  }
}

const createResponseBody = (
  ok: boolean,
  changed: boolean,
  requiresRedeploy: boolean,
  message: PublishMessage,
): PublishResponse => ({
  ok,
  changed,
  requires_redeploy: requiresRedeploy,
  operation,
  message,
});

const operatorJsonResponse = (
  request: Request,
  allowedOrigins: Set<string>,
  status: number,
  body: unknown,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, allowedOrigins),
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });

const webhookJsonResponse = (
  status: number,
  ok: boolean,
  webhookStatus: "confirmed" | "ignored" | "invalid" | "unavailable",
): Response =>
  new Response(JSON.stringify({ ok, status: webhookStatus }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });

const getBearerToken = (request: Request): string | null => {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.trim().split(/\s+/, 2);

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

const getRequiredEnv = (name: string): string | null => {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : null;
};

const getOptionalEnv = (name: string): string | null => {
  const value = Deno.env.get(name)?.trim();
  return value && value.length > 0 ? value : null;
};

const authorizeOperatorRequest = async (
  request: Request,
  allowedOrigins: Set<string>,
): Promise<OperatorAuthorization | OperatorRejection> => {
  if (request.method === "OPTIONS") {
    return {
      authorized: false,
      response: new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, allowedOrigins),
      }),
    };
  }

  if (!isOriginAllowed(request.headers.get("Origin"), allowedOrigins)) {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        403,
        createResponseBody(false, false, true, "cors_origin_not_allowed"),
      ),
    };
  }

  if (request.method !== "POST") {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        405,
        createResponseBody(false, false, true, "method_not_allowed"),
      ),
    };
  }

  const token = getBearerToken(request);

  if (!token) {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        401,
        createResponseBody(false, false, true, "unauthorized"),
      ),
    };
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        500,
        createResponseBody(false, false, true, "publish_not_configured"),
      ),
    };
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);

  if (userError || !user) {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        401,
        createResponseBody(false, false, true, "unauthorized"),
      ),
    };
  }

  const { data: canPublish, error: permissionError } = await userClient.rpc(
    "can_publish_menu",
  );

  if (permissionError || canPublish !== true) {
    return {
      authorized: false,
      response: operatorJsonResponse(
        request,
        allowedOrigins,
        403,
        createResponseBody(false, false, true, "permission_denied"),
      ),
    };
  }

  return {
    authorized: true,
    supabaseUrl,
    userId: user.id,
  };
};

const getStaleSeconds = (): number | null => {
  const rawValue = Deno.env.get("PUBLISH_STALE_SECONDS")?.trim();

  if (!rawValue) {
    return defaultStaleSeconds;
  }

  if (!/^\d+$/.test(rawValue)) {
    return null;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < 60 || value > maxStaleSeconds) {
    return null;
  }

  return value;
};

const getDeployHookUrl = (): string | null => {
  const rawValue = Deno.env.get("VERCEL_DEPLOY_HOOK_URL");

  if (!rawValue || rawValue !== rawValue.trim() || /\s/.test(rawValue)) {
    return null;
  }

  try {
    const url = new URL(rawValue);

    if (
      url.protocol !== "https:"
      || url.hostname !== "api.vercel.com"
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || url.hash !== ""
      || !url.pathname.startsWith("/v1/integrations/deploy/")
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const getPublicationConfirmationConfiguration = ():
  | PublicationConfirmationConfiguration
  | null => {
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const projectId = getRequiredEnv("VERCEL_PROJECT_ID");
  const teamId = getOptionalEnv("VERCEL_TEAM_ID");
  const canonicalAdminUrl = parseCanonicalAdminUrl(
    Deno.env.get("PUBLISH_CANONICAL_ADMIN_URL") ?? "",
  );

  if (
    !serviceRoleKey
    || !projectId
    || !isVercelProjectId(projectId)
    || (teamId !== null && !isVercelTeamId(teamId))
    || !canonicalAdminUrl
  ) {
    return null;
  }

  return {
    serviceRoleKey,
    projectId,
    teamId,
    canonicalAdminUrl,
  };
};

const getVercelHookJobId = async (response: Response): Promise<string | null> => {
  try {
    const body = await response.clone().json();
    const job = asRecord(asRecord(body)?.job);
    const jobId = job?.id;

    return typeof jobId === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(jobId)
      ? jobId
      : null;
  } catch {
    return null;
  }
};

const normalizeRequestId = (value: unknown): string | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  return /^[1-9][0-9]*$/.test(value) ? value : null;
};

const firstRpcRow = <Row>(value: unknown): Row | null => {
  if (Array.isArray(value)) {
    return (value[0] ?? null) as Row | null;
  }

  return value && typeof value === "object" ? value as Row : null;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const callStartPublishRequest = async (
  serviceClient: SupabaseClient,
  requestId: string,
  hookStatusCode: number,
  hookJobId: string | null,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await serviceClient.rpc("start_menu_publish_request", {
        request_id: requestId,
        hook_status_code: hookStatusCode,
        hook_job_id: hookJobId,
      });
      const row = firstRpcRow<JsonRecord>(data);

      if (!error && row?.started === true) {
        return true;
      }

      if (attempt === 1) {
        console.error("publish_menu_changes start transition failed", {
          request_id: requestId,
          error_code: error?.code ?? null,
          result_message: typeof row?.message === "string" ? row.message : null,
        });
      }
    } catch {
      if (attempt === 1) {
        console.error("publish_menu_changes start transition failed", {
          request_id: requestId,
          error_code: "rpc_exception",
          result_message: null,
        });
      }
    }
  }

  return false;
};

const callFailPublishRequest = async (
  serviceClient: SupabaseClient,
  requestId: string,
  hookStatusCode: number | null,
  hookJobId: string | null,
): Promise<void> => {
  try {
    const { error } = await serviceClient.rpc("fail_menu_publish_request", {
      request_id: requestId,
      publish_message: "publish_failed",
      hook_status_code: hookStatusCode,
      hook_job_id: hookJobId,
    });

    if (error) {
      console.error("publish_menu_changes failure transition failed", {
        request_id: requestId,
        error_code: error.code ?? null,
      });
    }
  } catch {
    console.error("publish_menu_changes failure transition failed", {
      request_id: requestId,
      error_code: "rpc_exception",
    });
  }
};

const readBodyWithLimit = async (
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);

    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new BodyLimitExceededError();
    }
  }

  if (!body) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      byteLength += value.byteLength;

      if (byteLength > maxBytes) {
        throw new BodyLimitExceededError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
};

const fetchPublicationArtifact = async (
  artifactUrl: string,
  bypassSecret: string | null,
): Promise<string | null> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), deploymentArtifactTimeoutMs);
  const headers = new Headers({
    Accept: "text/html",
    "Cache-Control": "no-store",
  });

  if (bypassSecret) {
    headers.set("x-vercel-protection-bypass", bypassSecret);
  }

  try {
    const response = await fetch(artifactUrl, {
      method: "GET",
      cache: "no-store",
      headers,
      redirect: "error",
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error("Deployment artifact was unavailable.");
    }

    const rawArtifact = await readBodyWithLimit(
      response.body,
      response.headers.get("Content-Length"),
      maxDeploymentArtifactBytes,
    );

    return new TextDecoder("utf-8", { fatal: true }).decode(rawArtifact);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const confirmPublicationDeployment = async (
  serviceClient: SupabaseClient,
  evidence: ConfirmationEvidence,
): Promise<"confirmed" | "ignored" | "unavailable"> => {
  try {
    const { data, error } = await serviceClient.rpc("confirm_menu_publish_deployment", {
      request_id: evidence.requestId,
      revision_id: evidence.revisionId,
      deployment_id: evidence.deploymentId,
      deployment_host: evidence.deploymentHost,
      content_hash: evidence.contentHash,
      evidence_event_id: evidence.evidenceEventId,
      evidence_source: evidence.evidenceSource,
      event_created_at: evidence.eventCreatedAt,
      project_id: evidence.projectId,
      team_id: evidence.teamId,
    });
    const confirmRow = firstRpcRow<ConfirmPublishRow>(data);

    if (error || !confirmRow || typeof confirmRow.confirmed !== "boolean") {
      console.error("publish_menu_changes confirmation failed", {
        deployment_id: evidence.deploymentId,
        evidence_source: evidence.evidenceSource,
        error_code: error?.code ?? null,
      });
      return "unavailable";
    }

    return confirmRow.confirmed ? "confirmed" : "ignored";
  } catch {
    console.error("publish_menu_changes confirmation failed", {
      deployment_id: evidence.deploymentId,
      evidence_source: evidence.evidenceSource,
      error_code: "rpc_exception",
    });
    return "unavailable";
  }
};

const handleVercelWebhook = async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, status: "invalid" }), {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  }

  const webhookSecret = getRequiredEnv("VERCEL_WEBHOOK_SECRET");
  const expectedProjectId = getRequiredEnv("VERCEL_PROJECT_ID");
  const expectedTeamId = getOptionalEnv("VERCEL_TEAM_ID");
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (
    !webhookSecret
    || !expectedProjectId
    || !isVercelProjectId(expectedProjectId)
    || (expectedTeamId !== null && !isVercelTeamId(expectedTeamId))
    || !supabaseUrl
    || !serviceRoleKey
  ) {
    return webhookJsonResponse(500, false, "unavailable");
  }

  let rawBody: Uint8Array;

  try {
    rawBody = await readBodyWithLimit(
      request.body,
      request.headers.get("Content-Length"),
      maxVercelWebhookBodyBytes,
    );
  } catch (error) {
    return error instanceof BodyLimitExceededError
      ? webhookJsonResponse(413, false, "invalid")
      : webhookJsonResponse(400, false, "invalid");
  }

  const signatureIsValid = await verifyVercelWebhookSignature(
    rawBody,
    request.headers.get("x-vercel-signature"),
    webhookSecret,
  );

  if (!signatureIsValid) {
    return webhookJsonResponse(403, false, "invalid");
  }

  let eventBody: unknown;

  try {
    const rawJson = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    eventBody = JSON.parse(rawJson);
  } catch {
    return webhookJsonResponse(400, false, "invalid");
  }

  const parsedEvent = parseVercelPromotionEvent(
    eventBody,
    expectedProjectId,
    expectedTeamId,
  );

  if (!parsedEvent.accepted) {
    return webhookJsonResponse(200, true, "ignored");
  }

  const artifactHtml = await fetchPublicationArtifact(
    `https://${parsedEvent.event.deploymentHost}/admin/`,
    getOptionalEnv("VERCEL_DEPLOYMENT_BYPASS_SECRET"),
  );

  if (artifactHtml === null) {
    return webhookJsonResponse(503, false, "unavailable");
  }

  const artifact = parsePublicationArtifact(artifactHtml);

  if (!artifact || artifact.deploymentId !== parsedEvent.event.deploymentId) {
    return webhookJsonResponse(200, true, "ignored");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const confirmationStatus = await confirmPublicationDeployment(serviceClient, {
    requestId: artifact.requestId,
    revisionId: artifact.revisionId,
    deploymentId: parsedEvent.event.deploymentId,
    deploymentHost: parsedEvent.event.deploymentHost,
    contentHash: artifact.contentHash,
    evidenceEventId: parsedEvent.event.eventId,
    evidenceSource: "vercel_webhook",
    eventCreatedAt: parsedEvent.event.eventCreatedAt,
    projectId: parsedEvent.event.projectId,
    teamId: parsedEvent.event.teamId,
  });

  return confirmationStatus === "unavailable"
    ? webhookJsonResponse(503, false, "unavailable")
    : webhookJsonResponse(
      200,
      true,
      confirmationStatus === "confirmed" ? "confirmed" : "ignored",
    );
};

const handleOperatorStatus = async (request: Request): Promise<Response> => {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("PUBLISH_ALLOWED_ORIGINS"));

  try {
    const authorization = await authorizeOperatorRequest(request, allowedOrigins);

    if (!authorization.authorized) {
      return authorization.response;
    }

    const confirmationConfig = getPublicationConfirmationConfiguration();

    if (!confirmationConfig) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        500,
        { ok: false, status: "unavailable" },
      );
    }

    const artifactHtml = await fetchPublicationArtifact(
      confirmationConfig.canonicalAdminUrl.url,
      getOptionalEnv("VERCEL_DEPLOYMENT_BYPASS_SECRET"),
    );

    if (artifactHtml === null) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        503,
        { ok: false, status: "unavailable" },
      );
    }

    const artifact = parsePublicationArtifact(artifactHtml);

    if (!artifact) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        200,
        { ok: true, status: "unchanged" },
      );
    }

    const serviceClient = createClient(authorization.supabaseUrl, confirmationConfig.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const evidenceEventId = createCanonicalProbeEvidenceEventId(
      artifact.deploymentId,
      crypto.randomUUID(),
    );

    if (!evidenceEventId) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        200,
        { ok: true, status: "unchanged" },
      );
    }

    const confirmationStatus = await confirmPublicationDeployment(serviceClient, {
      requestId: artifact.requestId,
      revisionId: artifact.revisionId,
      deploymentId: artifact.deploymentId,
      deploymentHost: confirmationConfig.canonicalAdminUrl.hostname,
      contentHash: artifact.contentHash,
      evidenceEventId,
      evidenceSource: "canonical_probe",
      eventCreatedAt: new Date().toISOString(),
      projectId: confirmationConfig.projectId,
      teamId: confirmationConfig.teamId,
    });

    return confirmationStatus === "unavailable"
      ? operatorJsonResponse(
        request,
        allowedOrigins,
        503,
        { ok: false, status: "unavailable" },
      )
      : operatorJsonResponse(
        request,
        allowedOrigins,
        200,
        {
          ok: true,
          status: confirmationStatus === "confirmed" ? "confirmed" : "unchanged",
        },
      );
  } catch (error) {
    console.error("publish_menu_changes status probe failed", {
      error_name: error instanceof Error ? error.name : "unknown",
    });

    return operatorJsonResponse(
      request,
      allowedOrigins,
      503,
      { ok: false, status: "unavailable" },
    );
  }
};

const handleOperatorPublish = async (request: Request): Promise<Response> => {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("PUBLISH_ALLOWED_ORIGINS"));

  try {
    const authorization = await authorizeOperatorRequest(request, allowedOrigins);

    if (!authorization.authorized) {
      return authorization.response;
    }

    const confirmationConfig = getPublicationConfirmationConfiguration();
    const deployHookUrl = getDeployHookUrl();
    const staleSeconds = getStaleSeconds();

    if (!confirmationConfig || !deployHookUrl || staleSeconds === null) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        500,
        createResponseBody(false, false, true, "publish_not_configured"),
      );
    }

    const serviceClient = createClient(
      authorization.supabaseUrl,
      confirmationConfig.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
    const { data: reserveData, error: reserveError } = await serviceClient.rpc(
      "reserve_menu_publish_request",
      {
        user_id: authorization.userId,
        stale_after_seconds: staleSeconds,
      },
    );
    const reserveRow = firstRpcRow<ReservePublishRow>(reserveData);

    if (reserveError || !reserveRow || typeof reserveRow.reserved !== "boolean") {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    if (!reserveRow.reserved) {
      const message = reserveRow.message === "publish_already_active"
        ? "publish_already_active"
        : reserveRow.message === "publish_already_current"
        ? "publish_already_current"
        : null;

      if (!message) {
        return operatorJsonResponse(
          request,
          allowedOrigins,
          502,
          createResponseBody(false, false, true, "publish_failed"),
        );
      }

      return operatorJsonResponse(
        request,
        allowedOrigins,
        200,
        createResponseBody(true, false, false, message),
      );
    }

    const requestId = normalizeRequestId(reserveRow.request_id);

    if (!requestId || reserveRow.message !== "publish_reserved") {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    let vercelResponse: Response;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), vercelHookTimeoutMs);

    try {
      vercelResponse = await fetch(deployHookUrl, {
        method: "POST",
        redirect: "error",
        signal: abortController.signal,
      });
    } catch {
      await callFailPublishRequest(serviceClient, requestId, null, null);

      return operatorJsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const vercelJobId = await getVercelHookJobId(vercelResponse);

    if (!vercelResponse.ok) {
      await callFailPublishRequest(
        serviceClient,
        requestId,
        vercelResponse.status,
        vercelJobId,
      );

      return operatorJsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    const startRecorded = await callStartPublishRequest(
      serviceClient,
      requestId,
      vercelResponse.status,
      vercelJobId,
    );

    if (!startRecorded) {
      return operatorJsonResponse(
        request,
        allowedOrigins,
        503,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    return operatorJsonResponse(
      request,
      allowedOrigins,
      200,
      createResponseBody(true, true, false, "publish_queued"),
    );
  } catch (error) {
    console.error("publish_menu_changes unexpected error", {
      error_name: error instanceof Error ? error.name : "unknown",
    });

    return operatorJsonResponse(
      request,
      allowedOrigins,
      502,
      createResponseBody(false, false, true, "publish_failed"),
    );
  }
};

Deno.serve((request: Request): Promise<Response> => {
  const route = getPublishFunctionRoute(new URL(request.url).pathname);

  if (route === "vercel_webhook") {
    return handleVercelWebhook(request);
  }

  if (route === "status") {
    return handleOperatorStatus(request);
  }

  if (route === "publish") {
    return handleOperatorPublish(request);
  }

  return Promise.resolve(webhookJsonResponse(404, false, "invalid"));
});
