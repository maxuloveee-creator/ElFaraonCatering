import type { createAdminFormState } from "./formState";
import type { createAdminSessionController } from "./session";
import {
  handleClearOverlayAction,
  handleSetOverlayAction,
} from "./availabilityActionHandlers";
import {
  handleDeleteCatalogItemAction,
  handleDeleteCatalogOptionAction,
  handleDeleteGrillItemAction,
  handleDeleteGrillProductAction,
} from "./deleteActionHandlers";
import { handlePublishAction } from "./publishActionHandlers";
import type { createAdminOperations } from "../operations";
import { adminActions, adminFilters } from "../core/contracts";
import { isServiceSectionAvailable } from "../core/rules";
import type {
  AdminOperationalState,
  AdminTabId,
  RenderFocusMode,
  RenderOptions,
  StatusTone,
} from "../core/types";
import {
  setAdminActiveTab,
  setAdminFilter,
  setAdminServiceSection,
} from "../core/viewState";

export interface AdminActionHandlerContext {
  root: HTMLElement;
  formState: ReturnType<typeof createAdminFormState>;
  sessionController: ReturnType<typeof createAdminSessionController>;
  adminOperations: ReturnType<typeof createAdminOperations>;
  getCurrentState(): AdminOperationalState | null;
  loadAdminState(): Promise<AdminOperationalState>;
  renderCurrentView(options?: RenderOptions): void;
  setStatus(text: string, tone: StatusTone): void;
  setStatusMessage(message: null): void;
  runBusy(action: () => Promise<void>, busyText?: string): Promise<void>;
}

export function createAdminActionHandlers(context: AdminActionHandlerContext) {
  async function handleAction(target: HTMLElement): Promise<void> {
    const action = target.dataset.adminAction;

    if (action === adminActions.showResetRequest) {
      if (!context.formState.confirmUnsavedChanges()) {
        return;
      }

      context.sessionController.setAuthView("reset-request");
      context.setStatusMessage(null);
      context.renderCurrentView({ focus: "view" });
      return;
    }

    if (action === adminActions.showLogin) {
      if (!context.formState.confirmUnsavedChanges()) {
        return;
      }

      context.sessionController.setAuthView("login");
      context.setStatusMessage(null);
      context.renderCurrentView({ focus: "view" });
      return;
    }

    if (action === adminActions.logout) {
      if (!context.formState.confirmUnsavedChanges()) {
        return;
      }

      await context.sessionController.logout();
      return;
    }

    if (action === adminActions.retryAdminState) {
      await context.runBusy(async () => {
        await context.loadAdminState();
      }, "Reintentando...");
      return;
    }

    if (action === adminActions.tab) {
      const tab = target.dataset.adminTab as AdminTabId | undefined;

      if (tab) {
        selectAdminTab(tab, "tab");
      }

      return;
    }

    if (action === adminActions.serviceSection) {
      const section = target.dataset.adminServiceSection;
      const currentState = context.getCurrentState();

      if (
        currentState
        && (section === "active-service" || section === "daily-menu" || section === "grill")
        && isServiceSectionAvailable(currentState, section)
      ) {
        if (!context.formState.confirmUnsavedChanges()) {
          return;
        }

        setAdminServiceSection(section);
        context.renderCurrentView();
      }

      return;
    }

    if (action === adminActions.hiddenAvailabilityProfile) {
      const profileId = target.dataset.adminHiddenAvailabilityProfile;
      const currentState = context.getCurrentState();

      if (
        profileId
        && currentState?.profiles.some((profile) => profile.id === profileId && profile.can_edit_availability)
      ) {
        if (!context.formState.confirmUnsavedChanges()) {
          return;
        }

        setAdminFilter(adminFilters.hiddenAvailabilityProfile, profileId);
        context.renderCurrentView();
      }

      return;
    }

    if (action === adminActions.setOverlay) {
      await handleSetOverlayAction(context, target);
      return;
    }

    if (action === adminActions.clearOverlay) {
      await handleClearOverlayAction(context, target);
      return;
    }

    if (action === adminActions.deleteCatalogItem) {
      await handleDeleteCatalogItemAction(context, target);
      return;
    }

    if (action === adminActions.deleteGrillItem) {
      await handleDeleteGrillItemAction(context, target);
      return;
    }

    if (action === adminActions.deleteGrillProduct) {
      await handleDeleteGrillProductAction(context, target);
      return;
    }

    if (action === adminActions.deleteCatalogOption) {
      await handleDeleteCatalogOptionAction(context, target);
      return;
    }

    if (action === adminActions.publish) {
      await handlePublishAction(context);
    }
  }

  function handleTabKeydown(event: KeyboardEvent, currentTab: HTMLButtonElement): void {
    const tabs = Array.from(context.root.querySelectorAll<HTMLButtonElement>('.admin-tab[role="tab"]'));
    const currentIndex = tabs.indexOf(currentTab);

    if (currentIndex < 0) {
      return;
    }

    let nextIndex: number;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const tab = tabs[nextIndex]?.dataset.adminTab as AdminTabId | undefined;

    if (tab) {
      selectAdminTab(tab, "tab");
    }
  }

  function handleFilterChange(field: HTMLSelectElement): void {
    if (!context.formState.confirmUnsavedChanges()) {
      field.value = field.dataset.previousValue ?? "";
      return;
    }

    const filter = field.dataset.adminFilter;

    if (!filter) {
      return;
    }

    setAdminFilter(filter, field.value);
    field.dataset.previousValue = field.value;
    context.renderCurrentView();
  }

  function handleInput(target: EventTarget | null): void {
    if (target instanceof HTMLInputElement) {
      context.formState.markContainingFormDirty(target);
      return;
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      context.formState.markContainingFormDirty(target);
    }
  }

  function toggleCatalogDescriptionField(field: HTMLInputElement): void {
    const descriptionField = field.closest<HTMLElement>(".admin-description-field");

    if (!descriptionField) {
      return;
    }

    descriptionField.classList.toggle("admin-description-field--hidden", !field.checked);
  }

  function togglePasswordVisibility(button: HTMLButtonElement): void {
    const field = button.closest<HTMLElement>(".admin-password-field");
    const input = field?.querySelector<HTMLInputElement>("input");

    if (!input) {
      return;
    }

    const shouldShow = input.type === "password";

    input.type = shouldShow ? "text" : "password";
    button.setAttribute("aria-label", shouldShow ? "Ocultar contraseña" : "Mostrar contraseña");
    button.setAttribute("aria-pressed", shouldShow ? "true" : "false");
  }

  function selectAdminTab(tab: AdminTabId, focus: RenderFocusMode = "preserve"): void {
    if (!context.formState.confirmUnsavedChanges()) {
      return;
    }

    setAdminActiveTab(tab);
    context.renderCurrentView({ focus, tabId: tab });
  }

  return {
    handleAction,
    handleFilterChange,
    handleInput,
    handleTabKeydown,
    toggleCatalogDescriptionField,
    togglePasswordVisibility,
  };
}
