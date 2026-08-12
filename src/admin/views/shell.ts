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
  if (state.publication.phase === "up_to_date" || !state.permissions.can_publish_menu) {
    return "";
  }

  const { title, description, actionLabel } = getPublicationBannerContent(state);

  return `
    <div class="admin-banner" data-publication-phase="${state.publication.phase}" role="region" aria-label="Estado de publicación">
      <div class="admin-banner__copy">
        <strong>${title}</strong>
        <span>${description}</span>
      </div>
      ${actionLabel
        ? `<button class="admin-button" type="button" data-admin-action="${adminActions.publish}" ${disabledAttr(isBusy)}>${actionLabel}</button>`
        : ""}
    </div>
  `;
}

function getPublicationBannerContent(state: AdminOperationalState): {
  title: string;
  description: string;
  actionLabel: string | null;
} {
  if (state.publication.phase === "publishing") {
    return state.publication.has_newer_changes
      ? {
          title: "Publicando los cambios anteriores…",
          description: "Tus cambios nuevos quedaron guardados para la próxima publicación.",
          actionLabel: null,
        }
      : {
          title: "Publicando cambios…",
          description: "Podés seguir trabajando.",
          actionLabel: null,
        };
  }

  if (state.publication.phase === "failed") {
    return {
      title: "No se pudo publicar.",
      description: "Tus cambios siguen guardados.",
      actionLabel: state.publication.can_retry ? "Reintentar" : null,
    };
  }

  return {
    title: "Hay cambios guardados sin publicar.",
    description: "Todavía no se ven en el menú.",
    actionLabel: "Publicar cambios",
  };
}
