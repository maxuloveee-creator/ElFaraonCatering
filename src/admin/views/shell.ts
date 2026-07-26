import { adminActions } from "../core/contracts";
import { disabledAttr, renderStatusMessage } from "./html";
import type { AdminOperationalState, AdminTabId, StatusMessage } from "../core/types";
import type { AdminViewState } from "../core/viewState";
import { escapeHtml, roleLabel } from "../core/format";

interface AdminShellInput {
  state: AdminOperationalState;
  viewState: AdminViewState;
  tabs: Array<{ id: AdminTabId; label: string }>;
  tabContent: string;
  currentStatus: StatusMessage | null;
  currentBusyText: string | null;
  isBusy: boolean;
}

export function renderAdminShell(input: AdminShellInput): string {
  return `
    <section class="admin-shell" aria-busy="${input.isBusy ? "true" : "false"}">
      <header class="admin-header">
        <div class="admin-header__main">
          <div>
            <p class="admin-kicker">Panel operativo</p>
            <h1 class="admin-title" tabindex="-1" data-admin-view-heading>Admin El Faraón</h1>
            <p class="admin-header__copy">Prepará el servicio, controlá disponibilidad y administrá los menús editables. La disponibilidad se aplica al instante; contenido y precios necesitan publicación.</p>
          </div>
          <div class="admin-header__identity">
            <span class="admin-user-name">${escapeHtml(input.state.staff?.display_name ?? "")}</span>
            <span class="admin-role-pill">${escapeHtml(roleLabel(input.state.staff?.role ?? "operator"))}</span>
            <button class="admin-button admin-button--secondary" type="button" data-admin-action="${adminActions.logout}" ${disabledAttr(input.isBusy)}>Salir</button>
          </div>
        </div>
        <nav class="admin-tabs" role="tablist" aria-label="Secciones del admin">
          ${input.tabs.map((tab) => `
            <button
              class="admin-tab"
              id="admin-tab-${tab.id}"
              role="tab"
              type="button"
              data-admin-action="${adminActions.tab}"
              data-admin-tab="${tab.id}"
              aria-selected="${input.viewState.activeTab === tab.id ? "true" : "false"}"
              aria-controls="admin-panel-${tab.id}"
              tabindex="${input.viewState.activeTab === tab.id ? "0" : "-1"}"
            >${escapeHtml(tab.label)}</button>
          `).join("")}
        </nav>
      </header>
      <div class="admin-main">
        ${renderPublishBanner(input.state, input.isBusy)}
        ${renderStatusMessage(input.currentStatus, input.currentBusyText)}
        <div id="admin-panel-${input.viewState.activeTab}" role="tabpanel" aria-labelledby="admin-tab-${input.viewState.activeTab}">
          ${input.tabContent}
        </div>
      </div>
    </section>
  `;
}

function renderPublishBanner(state: AdminOperationalState, isBusy: boolean): string {
  if (!state.publication.has_unpublished_changes || !state.permissions.can_publish_menu) {
    return "";
  }

  return `
    <div class="admin-banner">
      <span>${state.publication.publish_requested
        ? "Publicación en curso. Los cambios se están subiendo al menú. Si no termina, podés reintentar en un minuto."
        : "Falta publicar: hay cambios guardados pendientes"}</span>
      <button class="admin-button" type="button" data-admin-action="${adminActions.publish}" ${disabledAttr(isBusy)}>${state.publication.publish_requested
        ? "Reintentar publicación"
        : "Publicar ahora"}</button>
    </div>
  `;
}
