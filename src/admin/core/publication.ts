import type { PublicationState, StatusMessage } from "./types";

export function getPublicationTransitionStatus(
  previous: PublicationState | null,
  next: PublicationState,
): StatusMessage | null {
  if (previous?.phase !== "publishing" || next.phase === "publishing") {
    return null;
  }

  if (next.phase === "failed") {
    return {
      text: "No se pudo publicar. Tus cambios siguen guardados.",
      tone: "danger",
    };
  }

  if (next.phase === "changes_pending") {
    return {
      text: "Menú publicado correctamente. Hay cambios nuevos pendientes.",
      tone: "success",
    };
  }

  return {
    text: "Menú publicado correctamente.",
    tone: "success",
  };
}

export function arePublicationStatesEqual(left: PublicationState, right: PublicationState): boolean {
  return left.phase === right.phase
    && left.has_newer_changes === right.has_newer_changes
    && left.can_retry === right.can_retry
    && left.requested_at === right.requested_at
    && left.expires_at === right.expires_at;
}
