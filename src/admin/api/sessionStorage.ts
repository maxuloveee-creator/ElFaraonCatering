import type { AuthSession } from "../core/types";
import { isStoredSession } from "../core/responses";

const storageKey = "el-faraon-admin-session";

function clearLegacyStoredSession(): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Ignore legacy cleanup failures; sessionStorage is the active store.
  }
}

export function readStoredSession(): AuthSession | null {
  try {
    const rawValue = sessionStorage.getItem(storageKey);
    clearLegacyStoredSession();

    if (!rawValue) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isStoredSession(parsedValue)) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: AuthSession): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session));
  clearLegacyStoredSession();
}

export function clearStoredSession(): void {
  clearLegacyStoredSession();
  sessionStorage.removeItem(storageKey);
}

export function getPasswordRedirectUrl(): string {
  const url = new URL(window.location.href);
  url.pathname = "/admin/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function readPasswordSessionFromLocation(): AuthSession | null {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const hasSensitiveQueryParams = queryParams.has("access_token") || queryParams.has("refresh_token");
  const hasAuthHashParams =
    hashParams.has("access_token")
    || hashParams.has("refresh_token")
    || hashParams.get("type") === "recovery"
    || hashParams.get("type") === "invite";

  if (hasSensitiveQueryParams || hasAuthHashParams) {
    window.history.replaceState({}, document.title, getPasswordRedirectUrl());
  }

  const type = hashParams.get("type");

  if (type !== "recovery" && type !== "invite") {
    return null;
  }

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const expiresIn = Number(hashParams.get("expires_in") ?? "3600");

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
