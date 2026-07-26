import type {
  AdminOperationalState,
  AdminStatusText,
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
import { createAdminPublicationState } from "./app/publicationState";
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

if (!rootElement) {
  throw new Error("Admin root element was not found.");
}

const root: HTMLElement = rootElement;
const deployedContentHash = getTrimmedValue(root.dataset.deployedContentHash) ?? "";
const formState = createAdminFormState(root);
const publicationState = createAdminPublicationState(deployedContentHash);
const sessionController = createAdminSessionController({
  config: adminApiConfig,
  hasApiConfig: Boolean(supabaseUrl && supabaseAnonKey),
  loadAdminState,
  renderCurrentView,
  resetPublicationState: publicationState.reset,
  runBusy,
  setAdminState,
  setStatus,
  setStatusMessage,
});
const adminOperations = createAdminOperations({
  runBusy,
  callMutation,
  loadAdminState,
  requireSession: sessionController.requireSession,
  publishMenuChanges: (session) => publishMenuChangesRequest(adminApiConfig, session),
  markCurrentPublicationRequested: () => publicationState.markCurrentPublicationRequested(currentState),
  rememberPublishCooldown: publicationState.rememberPublishCooldown,
});
const actionHandlers = createAdminActionHandlers({
  root,
  formState,
  sessionController,
  adminOperations,
  publicationState,
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
): Promise<AdminOperationalState> {
  const session = await sessionController.requireSession();
  const state = await loadAdminOperationalState(adminApiConfig, session);
  currentState = normalizeAdminState(state, deployedContentHash, publicationState.getRequestedPublishHash());
  currentState = publicationState.reconcileState(currentState);
  currentStatus = statusText ? { text: getAdminStatusText(statusText, currentState), tone: statusTone } : currentStatus;
  syncAdminViewContext();
  ensureActiveTab();
  renderCurrentView({ focus, revealStatus: Boolean(statusText) });
  return currentState;
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
