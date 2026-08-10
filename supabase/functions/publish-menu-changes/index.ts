import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  getCorsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../_shared/cors.ts";

const operation = "publish_menu_changes";
const defaultCooldownSeconds = 60;
const maxCooldownSeconds = 3600;
const vercelFetchTimeoutMs = 10000;

type PublishMessage =
  | "cors_origin_not_allowed"
  | "method_not_allowed"
  | "unauthorized"
  | "permission_denied"
  | "publish_not_configured"
  | "publish_recently_queued"
  | "publish_queued"
  | "publish_failed";

interface PublishResponse {
  ok: boolean;
  changed: boolean;
  requires_redeploy: boolean;
  operation: typeof operation;
  message: PublishMessage;
  cooldown_seconds_remaining?: number;
}

interface ReservePublishRow {
  request_id: number | null;
  reserved: boolean;
  message: string;
  cooldown_remaining_seconds: number | null;
}

interface CompletePublishRow {
  completed: boolean;
  message: string;
}

const createResponseBody = (
  ok: boolean,
  changed: boolean,
  requiresRedeploy: boolean,
  message: PublishMessage,
  cooldownSecondsRemaining?: number,
): PublishResponse => {
  const response: PublishResponse = {
    ok,
    changed,
    requires_redeploy: requiresRedeploy,
    operation,
    message,
  };

  if (typeof cooldownSecondsRemaining === "number") {
    response.cooldown_seconds_remaining = cooldownSecondsRemaining;
  }

  return response;
};

const jsonResponse = (
  request: Request,
  allowedOrigins: Set<string>,
  status: number,
  body: PublishResponse,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, allowedOrigins),
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

const getCooldownSeconds = (): number | null => {
  const rawValue = Deno.env.get("PUBLISH_COOLDOWN_SECONDS")?.trim();

  if (!rawValue) {
    return defaultCooldownSeconds;
  }

  if (!/^\d+$/.test(rawValue)) {
    return null;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < 0 || value > maxCooldownSeconds) {
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
      url.protocol !== "https:" ||
      url.hostname !== "api.vercel.com" ||
      !url.pathname.startsWith("/v1/integrations/deploy/")
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const getVercelJobId = async (response: Response): Promise<string | null> => {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    const body = await response.clone().json();
    const candidates = [
      body?.job?.id,
      body?.jobId,
      body?.deployment?.id,
      body?.id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
};

const completePublishRequest = async (
  serviceClient: SupabaseClient,
  params: {
    requestId: number;
    publishStatus: "succeeded" | "failed";
    publishMessage: "publish_queued" | "publish_failed";
    vercelStatusCode: number | null;
    vercelJobId: string | null;
    phase: string;
  },
): Promise<void> => {
  try {
    const { data, error } = await serviceClient.rpc("complete_menu_publish_request", {
      request_id: params.requestId,
      publish_status: params.publishStatus,
      publish_message: params.publishMessage,
      vercel_status_code: params.vercelStatusCode,
      vercel_job_id: params.vercelJobId,
    });

    const completeRow = Array.isArray(data)
      ? data[0] as CompletePublishRow | undefined
      : data as CompletePublishRow | null;

    if (!error && completeRow?.completed) {
      return;
    }

    console.error("publish_menu_changes completion logging failed", {
      request_id: params.requestId,
      phase: params.phase,
      error_code: error?.code ?? null,
      result_message: completeRow?.message ?? null,
    });
  } catch {
    console.error("publish_menu_changes completion logging failed", {
      request_id: params.requestId,
      phase: params.phase,
      error_code: "rpc_exception",
      result_message: null,
    });
  }
};

Deno.serve(async (request: Request): Promise<Response> => {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get("PUBLISH_ALLOWED_ORIGINS"));
  const origin = request.headers.get("Origin");

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, allowedOrigins),
      });
    }

    if (!isOriginAllowed(origin, allowedOrigins)) {
      return jsonResponse(
        request,
        allowedOrigins,
        403,
        createResponseBody(false, false, true, "cors_origin_not_allowed"),
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        request,
        allowedOrigins,
        405,
        createResponseBody(false, false, true, "method_not_allowed"),
      );
    }

    const token = getBearerToken(request);

    if (!token) {
      return jsonResponse(
        request,
        allowedOrigins,
        401,
        createResponseBody(false, false, true, "unauthorized"),
      );
    }

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(
        request,
        allowedOrigins,
        500,
        createResponseBody(false, false, true, "publish_not_configured"),
      );
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
      return jsonResponse(
        request,
        allowedOrigins,
        401,
        createResponseBody(false, false, true, "unauthorized"),
      );
    }

    const { data: canPublish, error: permissionError } = await userClient.rpc(
      "can_publish_menu",
    );

    if (permissionError || canPublish !== true) {
      return jsonResponse(
        request,
        allowedOrigins,
        403,
        createResponseBody(false, false, true, "permission_denied"),
      );
    }

    const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const deployHookUrl = getDeployHookUrl();
    const cooldownSeconds = getCooldownSeconds();

    if (!supabaseServiceRoleKey || !deployHookUrl || cooldownSeconds === null) {
      return jsonResponse(
        request,
        allowedOrigins,
        500,
        createResponseBody(false, false, true, "publish_not_configured"),
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: reserveData, error: reserveError } = await serviceClient.rpc(
      "reserve_menu_publish_request",
      {
        user_id: user.id,
        cooldown_seconds: cooldownSeconds,
      },
    );

    const reserveRow = Array.isArray(reserveData)
      ? reserveData[0] as ReservePublishRow | undefined
      : reserveData as ReservePublishRow | null;

    if (reserveError || !reserveRow || reserveRow.request_id === null) {
      return jsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    if (!reserveRow.reserved) {
      const cooldownSecondsRemaining = Number.isSafeInteger(reserveRow.cooldown_remaining_seconds)
        ? Math.max(0, reserveRow.cooldown_remaining_seconds ?? 0)
        : undefined;

      return jsonResponse(
        request,
        allowedOrigins,
        200,
        createResponseBody(
          true,
          false,
          false,
          "publish_recently_queued",
          cooldownSecondsRemaining,
        ),
      );
    }

    let vercelResponse: Response;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), vercelFetchTimeoutMs);

    try {
      vercelResponse = await fetch(deployHookUrl, {
        method: "POST",
        signal: abortController.signal,
      });
    } catch {
      await completePublishRequest(serviceClient, {
        requestId: reserveRow.request_id,
        publishStatus: "failed",
        publishMessage: "publish_failed",
        vercelStatusCode: null,
        vercelJobId: null,
        phase: "vercel_fetch_failed",
      });

      return jsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const vercelJobId = await getVercelJobId(vercelResponse);

    if (!vercelResponse.ok) {
      await completePublishRequest(serviceClient, {
        requestId: reserveRow.request_id,
        publishStatus: "failed",
        publishMessage: "publish_failed",
        vercelStatusCode: vercelResponse.status,
        vercelJobId: vercelJobId,
        phase: "vercel_response_failed",
      });

      return jsonResponse(
        request,
        allowedOrigins,
        502,
        createResponseBody(false, false, true, "publish_failed"),
      );
    }

    await completePublishRequest(serviceClient, {
      requestId: reserveRow.request_id,
      publishStatus: "succeeded",
      publishMessage: "publish_queued",
      vercelStatusCode: vercelResponse.status,
      vercelJobId: vercelJobId,
      phase: "vercel_response_succeeded",
    });

    return jsonResponse(
      request,
      allowedOrigins,
      200,
      createResponseBody(true, true, false, "publish_queued", cooldownSeconds),
    );
  } catch (error) {
    console.error("publish_menu_changes unexpected error", {
      error_name: error instanceof Error ? error.name : "unknown",
    });

    return jsonResponse(
      request,
      allowedOrigins,
      502,
      createResponseBody(false, false, true, "publish_failed"),
    );
  }
});
