import type { AdminOperationContext } from "./types";

export function createPublishOperations(context: AdminOperationContext) {
  return {
    publishChanges(): Promise<void> {
      return context.runBusy(async () => {
        const session = await context.requireSession();

        try {
          await context.publishMenuChanges(session);
        } catch {
          // The canonical server state below decides whether the request was
          // accepted despite a lost or failed HTTP response.
        }

        const state = await context.loadAdminState();

        if (state.publication.phase === "publishing") {
          context.setStatus("Publicación en curso. Podés seguir trabajando.", "neutral");
          return;
        }

        if (state.publication.phase === "failed") {
          context.setStatus("No se pudo publicar. Tus cambios siguen guardados.", "danger");
          return;
        }

        if (state.publication.phase === "up_to_date") {
          context.setStatus("Menú publicado correctamente.", "success");
          return;
        }

        context.setStatus("No se pudo publicar. Tus cambios siguen guardados.", "danger");
      }, "Preparando publicación...");
    },
  };
}
