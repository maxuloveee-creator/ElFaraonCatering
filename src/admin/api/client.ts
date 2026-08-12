import type { AdminOperationalState, AuthSession, RpcResult } from "../core/types";
import {
  isAuthResponse,
  isRpcResult,
  readErrorMessage,
  readJsonBody,
  resultMessage,
} from "../core/responses";

export interface AdminApiConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

const publicationStateRequestTimeoutMs = 8_000;

export async function signInWithPassword(
  config: AdminApiConfig,
  email: string,
  password: string,
): Promise<AuthSession> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify({ email, password }),
  });

  const body = await readJsonBody(response);

  if (!response.ok || !isAuthResponse(body)) {
    throw new Error("No se pudo iniciar sesión.");
  }

  return createSession(body);
}

export async function requestPasswordResetEmail(
  config: AdminApiConfig,
  email: string,
  redirectUrl: string,
): Promise<void> {
  const resetUrl = new URL(`${config.supabaseUrl}/auth/v1/recover`);
  resetUrl.searchParams.set("redirect_to", redirectUrl);

  const response = await fetch(resetUrl.toString(), {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify({ email }),
  });

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(body));
  }
}

export async function updatePasswordRequest(
  config: AdminApiConfig,
  session: AuthSession,
  password: string,
): Promise<void> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify({ password }),
  });

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(body));
  }
}

export async function logoutRequest(config: AdminApiConfig, session: AuthSession): Promise<void> {
  await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    credentials: "omit",
  }).catch(() => undefined);
}

export async function refreshSessionRequest(
  config: AdminApiConfig,
  session: AuthSession,
): Promise<AuthSession | null> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  const body = await readJsonBody(response);

  if (!response.ok || !isAuthResponse(body)) {
    return null;
  }

  return createSession(body);
}

export async function loadAdminOperationalState(
  config: AdminApiConfig,
  session: AuthSession,
  reconcileCanonicalArtifact = false,
): Promise<AdminOperationalState> {
  const state = await loadCanonicalAdminOperationalState(config, session);

  if (state.publication?.phase !== "publishing" && !reconcileCanonicalArtifact) {
    return state;
  }

  await probeMenuPublicationStatus(config, session).catch(() => undefined);

  return loadCanonicalAdminOperationalState(config, session);
}

const loadCanonicalAdminOperationalState = (
  config: AdminApiConfig,
  session: AuthSession,
): Promise<AdminOperationalState> =>
  callRpc<AdminOperationalState>(
    config,
    session,
    "get_admin_operational_state",
    {},
    AbortSignal.timeout(publicationStateRequestTimeoutMs),
  );

export async function probeMenuPublicationStatus(
  config: AdminApiConfig,
  session: AuthSession,
): Promise<void> {
  await fetch(`${config.supabaseUrl}/functions/v1/publish-menu-changes/status`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    signal: AbortSignal.timeout(publicationStateRequestTimeoutMs),
  });
}

export async function callMutation(
  config: AdminApiConfig,
  session: AuthSession,
  name: string,
  body: Record<string, unknown>,
): Promise<RpcResult> {
  const response = await callRpc<unknown>(config, session, name, body);
  const result = Array.isArray(response) ? response[0] : response;

  if (!isRpcResult(result)) {
    throw new Error("El panel recibió una respuesta inesperada. Actualizá e intentá de nuevo.");
  }

  return result;
}

export async function publishMenuChanges(
  config: AdminApiConfig,
  session: AuthSession,
): Promise<RpcResult> {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/publish-menu-changes`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
  });
  const body = await readJsonBody(response);
  const result = isRpcResult(body) ? body : null;

  if (!response.ok || !result?.ok) {
    throw new Error(result ? resultMessage(result) : "No se pudo publicar.");
  }

  return result;
}

async function callRpc<T>(
  config: AdminApiConfig,
  session: AuthSession,
  name: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    body: JSON.stringify(body),
    signal,
  });
  const responseBody = await readJsonBody(response);

  if (response.status === 401) {
    throw new Error("La sesión expiró. Volvé a iniciar sesión.");
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(responseBody));
  }

  return responseBody as T;
}

function createSession(body: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): AuthSession {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}
