import type {
  AdminOperationalState,
  AdminStatusText,
  PublicationState,
  RenderFocusMode,
  RenderOptions,
  RpcResult,
  StatusMessage,
  StatusTone,
} from "./core/types";
import {
  callMutation as callAdminMutation,
  loadAdminOperationalState,
  publishMenuChanges as publishMenuChangesRequest,
} from "./api/client";
import { createAdminActionHandlers } from "./app/actionHandlers";
import { bindAdminEventHandlers } from "./app/eventHandlers";
import { createAdminFormHandlers } from "./app/formHandlers";
import { createAdminFormState } from "./app/formState";
import { createAdminPublicationPoller } from "./app/publicationPolling";
import { createAdminSessionController } from "./app/session";
import { createAdminOperations } from "./operations";
import {
  ensureActiveTab,
  renderAuthenticated,
  renderConfigurationError,
  renderLogin,
  renderPasswordResetRequest,
  renderSetPassword,
  setAdminViewContext,
} from "./views/renderer";
import { normalizeAdminState } from "./core/adminState";
import {
  arePublicationStatesEqual,
  getPublicationTransitionStatus,
} from "./core/publication";
import { toOperationalErrorMessage } from "./core/responses";
import { getTrimmedValue, normalizeSupabaseProjectUrl } from "./core/url";

const rootElement = document.querySelector<HTMLElement>("[data-admin-root]");

const supabaseUrl = normalizeSupabaseProjectUrl(import.meta.env.PUBLIC_SUPABASE_URL);
const supabaseAnonKey = getTrimmedValue(import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
const configuredSupabaseUrl = supabaseUrl ?? "";
const configuredSupabaseAnonKey = supabaseAnonKey ?? "";
const adminApiConfig = {
  supabaseUrl: configuredSupabaseUrl,
  supabaseAnonKey: configuredSupabaseAnonKey,
};

let currentState: AdminOperationalState | null = null;
let currentStatus: StatusMessage | null = null;
let currentBusyText: string | null = null;
let isBusy = false;
let lastCanonicalReconciliationAt = 0;
let canonicalReconciliationInFlight = false;

const publicationPollingErrorMessage = "No pudimos actualizar el estado. Tus cambios siguen guardados.";
const publicationPollingDelayedMessage = "La publicación está tardando más de lo esperado. Tus cambios siguen guardados.";
const canonicalReconciliationIntervalMs = 60_000;

if (!rootElement) {
  throw new Error("Admin root element was not found.");
}

const root: HTMLElement = rootElement;
const formState = createAdminFormState(root);
const publicationPoller = createAdminPublicationPoller({
  loadPublicationState: refreshPublicationState,
  isVisible: () => document.visibilityState !== "hidden",
  onError: handlePublicationPollingError,
  onDelayed: handlePublicationPollingDelayed,
});
const sessionController = createAdminSessionController({
  config: adminApiConfig,
  hasApiConfig: Boolean(supabaseUrl && supabaseAnonKey),
  loadAdminState,
  renderCurrentView,
  stopPublicationPolling: stopPublicationActivity,
  runBusy,
  setAdminState,
  setStatus,
  setStatusMessage,
});
const adminOperations = createAdminOperations({
  runBusy,
  callMutation,
  loadAdminState,
  setStatus,
  requireSession: sessionController.requireSession,
  publishMenuChanges: (session) => publishMenuChangesRequest(adminApiConfig, session),
});
const actionHandlers = createAdminActionHandlers({
  root,
  formState,
  sessionController,
  adminOperations,
  getCurrentState: () => currentState,
  loadAdminState,
  renderCurrentView,
  setStatus,
  setStatusMessage,
  runBusy,
});
const formHandlers = createAdminFormHandlers({
  sessionController,
  adminOperations,
  renderCurrentView,
});

bindAdminEventHandlers({
  root,
  formState,
  actionHandlers,
  formHandlers,
  handleUnexpectedError,
});

document.addEventListener("visibilitychange", handlePublicationVisibilityChange);
window.addEventListener("focus", handlePublicationFocus);

void sessionController.start(renderConfigurationProblem).catch(handleUnexpectedError);

function renderConfigurationProblem(): void {
  syncAdminViewContext();
  renderConfigurationError();
  formState.focusViewStart();
}

async function loadAdminState(
  statusText?: AdminStatusText,
  statusTone: StatusTone = "neutral",
  focus: RenderFocusMode = "preserve",
  reconcileCanonicalArtifact = false,
): Promise<AdminOperationalState> {
  const session = await sessionController.requireSession();
  const state = await loadAdminOperationalState(
    adminApiConfig,
    session,
    reconcileCanonicalArtifact,
  );

  if (reconcileCanonicalArtifact) {
    lastCanonicalReconciliationAt = Date.now();
  }
  const previousPublication = currentState?.publication ?? null;
  currentState = normalizeAdminState(state);
  const transitionStatus = getPublicationTransitionStatus(previousPublication, currentState.publication);

  if (statusText) {
    const requestedStatusText = getAdminStatusText(statusText, currentState);
    currentStatus = transitionStatus
      ? {
          text: `${requestedStatusText} ${transitionStatus.text}`,
          tone: transitionStatus.tone === "danger" ? "danger" : statusTone,
        }
      : { text: requestedStatusText, tone: statusTone };
  } else if (transitionStatus) {
    currentStatus = transitionStatus;
  }

  syncAdminViewContext();
  ensureActiveTab();
  renderCurrentView({ focus, revealStatus: Boolean(statusText || transitionStatus) });
  syncPublicationPolling(currentState.publication);
  return currentState;
}

async function refreshPublicationState(
  reconcileCanonicalArtifact = false,
): Promise<PublicationState> {
  const activePublication = currentState?.publication;

  if (isBusy && activePublication) {
    return activePublication;
  }

  const session = await sessionController.requireSession();
  const state = normalizeAdminState(
    await loadAdminOperationalState(adminApiConfig, session, reconcileCanonicalArtifact),
  );
  const nextPublication = state.publication;

  if (!currentState) {
    return nextPublication;
  }

  const previousPublication = currentState.publication;
  const transitionStatus = getPublicationTransitionStatus(previousPublication, nextPublication);
  const publicationChanged = !arePublicationStatesEqual(previousPublication, nextPublication);
  const shouldClearPollingError = currentStatus?.text === publicationPollingErrorMessage;

  if (publicationChanged) {
    currentState = { ...currentState, publication: nextPublication };
  }

  if (transitionStatus) {
    currentStatus = transitionStatus;
  } else if (shouldClearPollingError) {
    currentStatus = null;
  }

  if (publicationChanged || transitionStatus || shouldClearPollingError) {
    renderCurrentView({ revealStatus: Boolean(transitionStatus) });
  }

  return nextPublication;
}

function getAdminStatusText(statusText: AdminStatusText, state: AdminOperationalState): string {
  return typeof statusText === "function" ? statusText(state) : statusText;
}

async function callMutation(name: string, body: Record<string, unknown>): Promise<RpcResult> {
  const session = await sessionController.requireSession();
  return callAdminMutation(adminApiConfig, session, name, body);
}

function setAdminState(state: AdminOperationalState | null): void {
  currentState = state;

  if (!state) {
    stopPublicationActivity();
  }
}

function setStatusMessage(message: StatusMessage | null): void {
  currentStatus = message;
}

function setStatus(text: string, tone: StatusTone): void {
  currentStatus = { text, tone };
  renderCurrentView({ revealStatus: true });
}

async function runBusy(action: () => Promise<void>, busyText = "Procesando..."): Promise<void> {
  isBusy = true;
  currentBusyText = busyText;
  renderCurrentView();

  try {
    await action();
  } catch (error) {
    currentBusyText = null;
    handleUnexpectedError(error);
  } finally {
    isBusy = false;
    currentBusyText = null;
    renderCurrentView();
  }
}

function handleUnexpectedError(error: unknown): void {
  const message = isNetworkFetchError(error)
    ? "No se pudo conectar. Revisá la conexión e intentá de nuevo."
    : error instanceof Error
      ? toOperationalErrorMessage(error.message)
      : "Ocurrió un error inesperado.";
  currentStatus = { text: message, tone: "danger" };
  renderCurrentView({ revealStatus: true });
}

function handlePublicationPollingError(): void {
  if (currentState?.publication.phase !== "publishing") {
    return;
  }

  currentStatus = { text: publicationPollingErrorMessage, tone: "neutral" };
  renderCurrentView({ revealStatus: true });
}

function handlePublicationPollingDelayed(): void {
  if (currentState?.publication.phase !== "publishing") {
    return;
  }

  currentStatus = { text: publicationPollingDelayedMessage, tone: "neutral" };
  renderCurrentView({ revealStatus: true });
}

function handlePublicationVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    publicationPoller.pause();
    return;
  }

  handlePublicationFocus();
}

function handlePublicationFocus(): void {
  if (document.visibilityState === "hidden" || !currentState) {
    return;
  }

  if (currentState.publication.phase === "publishing") {
    publicationPoller.resume();
    return;
  }

  const now = Date.now();

  if (
    isBusy
    || canonicalReconciliationInFlight
    || now - lastCanonicalReconciliationAt < canonicalReconciliationIntervalMs
  ) {
    return;
  }

  lastCanonicalReconciliationAt = now;
  canonicalReconciliationInFlight = true;
  void refreshPublicationState(true)
    .then((publication) => syncPublicationPolling(publication))
    .catch(() => undefined)
    .finally(() => {
      canonicalReconciliationInFlight = false;
    });
}

function syncPublicationPolling(publication: PublicationState): void {
  if (publication.phase === "publishing") {
    // The state was just reconciled by loadAdminOperationalState, so the first
    // background refresh can wait for the normal fast interval.
    publicationPoller.start(publication, false);
    return;
  }

  publicationPoller.stop();
}

function stopPublicationActivity(): void {
  publicationPoller.stop();
  lastCanonicalReconciliationAt = 0;
  canonicalReconciliationInFlight = false;
}

// Fetch network TypeError messages differ across Chrome, Firefox, and Safari.
function isNetworkFetchError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

function renderCurrentView(options: RenderOptions = {}): void {
  const focus = options.focus ?? "preserve";
  const snapshot = focus === "preserve" ? formState.captureInteraction() : null;

  syncAdminViewContext();

  if (sessionController.getCurrentSession() && currentState) {
    renderAuthenticated();
  } else if (sessionController.getAuthView() === "reset-request") {
    renderPasswordResetRequest();
  } else if (sessionController.getAuthView() === "set-password") {
    renderSetPassword();
  } else {
    renderLogin();
  }

  formState.syncFormBaselines();
  formState.syncFilterValues();

  if (focus === "view") {
    formState.focusViewStart();
  } else if (focus === "tab" && options.tabId) {
    formState.focusTab(options.tabId);
  } else if (snapshot) {
    formState.restoreInteraction(snapshot);
  }

  if (options.revealStatus) {
    formState.revealStatus();
  }
}

function syncAdminViewContext(): void {
  setAdminViewContext({
    root,
    currentState,
    currentStatus,
    currentBusyText,
    isBusy,
  });
}
