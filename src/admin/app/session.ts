import type { AdminApiConfig } from "../api/client";
import {
  logoutRequest,
  refreshSessionRequest,
  requestPasswordResetEmail,
  signInWithPassword,
  updatePasswordRequest,
} from "../api/client";
import {
  clearStoredSession,
  getPasswordRedirectUrl,
  readPasswordSessionFromLocation,
  readStoredSession,
  saveStoredSession,
} from "../api/sessionStorage";
import type {
  AdminOperationalState,
  AdminStatusText,
  AuthSession,
  AuthView,
  RenderFocusMode,
  RenderOptions,
  StatusMessage,
  StatusTone,
} from "../core/types";
import { getFormString } from "../core/forms";

interface AdminSessionContext {
  config: AdminApiConfig;
  hasApiConfig: boolean;
  loadAdminState(
    statusText?: AdminStatusText,
    statusTone?: StatusTone,
    focus?: RenderFocusMode,
  ): Promise<AdminOperationalState>;
  renderCurrentView(options?: RenderOptions): void;
  resetPublicationState(): void;
  runBusy(action: () => Promise<void>, busyText?: string): Promise<void>;
  setAdminState(state: AdminOperationalState | null): void;
  setStatus(text: string, tone: StatusTone): void;
  setStatusMessage(message: StatusMessage | null): void;
}

export function createAdminSessionController(context: AdminSessionContext) {
  let currentSession: AuthSession | null = null;
  let authView: AuthView = "login";

  async function start(onConfigurationError: () => void): Promise<void> {
    if (!context.hasApiConfig) {
      onConfigurationError();
      return;
    }

    const passwordSession = readPasswordSessionFromLocation();

    if (passwordSession) {
      currentSession = passwordSession;
      authView = "set-password";
      context.setStatusMessage({ text: "Definí una nueva contraseña para activar tu acceso.", tone: "neutral" });
      context.renderCurrentView({ focus: "view" });
      return;
    }

    currentSession = await getValidSession();

    if (!currentSession) {
      authView = "login";
      context.renderCurrentView({ focus: "view" });
      return;
    }

    await context.loadAdminState(undefined, "neutral", "view");
  }

  function getCurrentSession(): AuthSession | null {
    return currentSession;
  }

  function getAuthView(): AuthView {
    return authView;
  }

  function setAuthView(view: AuthView): void {
    authView = view;
  }

  async function login(form: HTMLFormElement): Promise<void> {
    const email = getFormString(form, "email");
    const password = getFormString(form, "password");

    if (!email || !password) {
      context.setStatus("Completá email y contraseña.", "danger");
      return;
    }

    await context.runBusy(async () => {
      currentSession = await signInWithPassword(context.config, email, password);
      authView = "login";
      saveStoredSession(currentSession);
      await context.loadAdminState("Sesión iniciada.", "success", "view");
    }, "Iniciando sesión...");
  }

  async function requestPasswordReset(form: HTMLFormElement): Promise<void> {
    const email = getFormString(form, "email");

    if (!email) {
      context.setStatus("Ingresá tu email.", "danger");
      return;
    }

    await context.runBusy(async () => {
      await requestPasswordResetEmail(context.config, email, getPasswordRedirectUrl());
      context.setStatusMessage({
        text: "Te enviamos un link para definir una nueva contraseña. Revisá tu email.",
        tone: "success",
      });
      authView = "login";
      context.renderCurrentView({ focus: "view", revealStatus: true });
    }, "Enviando link...");
  }

  async function setPassword(form: HTMLFormElement): Promise<void> {
    const session = currentSession;

    if (!session) {
      authView = "login";
      context.renderCurrentView({ focus: "view" });
      return;
    }

    const password = getFormString(form, "password");
    const passwordConfirmation = getFormString(form, "password_confirmation");

    if (!isValidNewPassword(password, passwordConfirmation)) {
      return;
    }

    await context.runBusy(async () => {
      await updatePassword(session, password);
      saveStoredSession(session);
      authView = "login";
      await context.loadAdminState("Contraseña actualizada.", "success", "view");
    }, "Actualizando contraseña...");
  }

  async function changePassword(form: HTMLFormElement): Promise<void> {
    const session = await requireSession();
    const password = getFormString(form, "password");
    const passwordConfirmation = getFormString(form, "password_confirmation");

    if (!isValidNewPassword(password, passwordConfirmation)) {
      return;
    }

    await context.runBusy(async () => {
      await updatePassword(session, password);
      await context.loadAdminState("Contraseña actualizada.", "success");
    }, "Actualizando contraseña...");
  }

  async function updatePassword(session: AuthSession, password: string): Promise<void> {
    await updatePasswordRequest(context.config, session, password);
  }

  async function logout(): Promise<void> {
    const session = currentSession;
    clearStoredSession();
    context.resetPublicationState();
    currentSession = null;
    context.setAdminState(null);
    authView = "login";

    if (session) {
      await logoutRequest(context.config, session);
    }

    context.setStatusMessage({ text: "Sesión cerrada.", tone: "success" });
    context.renderCurrentView({ focus: "view", revealStatus: true });
  }

  async function requireSession(): Promise<AuthSession> {
    const session = await getValidSession();

    if (!session) {
      context.renderCurrentView({ focus: "view" });
      throw new Error("La sesión expiró. Volvé a iniciar sesión.");
    }

    currentSession = session;
    return session;
  }

  async function getValidSession(): Promise<AuthSession | null> {
    const storedSession = readStoredSession();

    if (!storedSession) {
      return null;
    }

    if (storedSession.expiresAt - Date.now() > 60_000) {
      return storedSession;
    }

    return refreshSession(storedSession);
  }

  async function refreshSession(session: AuthSession): Promise<AuthSession | null> {
    const refreshedSession = await refreshSessionRequest(context.config, session);

    if (!refreshedSession) {
      clearStoredSession();
      context.resetPublicationState();
      return null;
    }

    saveStoredSession(refreshedSession);
    return refreshedSession;
  }

  function isValidNewPassword(password: string, passwordConfirmation: string): boolean {
    if (!password || !passwordConfirmation) {
      context.setStatus("Completá la nueva contraseña y su confirmación.", "danger");
      return false;
    }

    if (password.length < 8) {
      context.setStatus("La contraseña debe tener al menos 8 caracteres.", "danger");
      return false;
    }

    if (password !== passwordConfirmation) {
      context.setStatus("Las contraseñas no coinciden.", "danger");
      return false;
    }

    return true;
  }

  return {
    changePassword,
    getAuthView,
    getCurrentSession,
    login,
    logout,
    requestPasswordReset,
    requireSession,
    setAuthView,
    setPassword,
    start,
  };
}
