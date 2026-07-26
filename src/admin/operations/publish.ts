import { formatCooldownSuffix, resultMessage } from "../core/responses";
import type { AdminOperationContext } from "./types";

export function createPublishOperations(context: AdminOperationContext) {
  return {
    publishChanges(): Promise<void> {
      return context.runBusy(async () => {
        const session = await context.requireSession();
        const result = await context.publishMenuChanges(session);

        if (result.message === "publish_queued") {
          context.rememberPublishCooldown(result);
          context.markCurrentPublicationRequested();
          await context.loadAdminState(
            "Publicación en curso. Si hacés nuevos cambios, vas a poder publicarlos después.",
            "success",
          );
          return;
        }

        if (result.message === "publish_recently_queued") {
          context.rememberPublishCooldown(result);
          const state = await context.loadAdminState(
            `Ya hay una publicación reciente en curso. Los cambios quedan guardados. Esperá${formatCooldownSuffix(result)} para volver a publicar.`,
            "neutral",
          );

          if (
            state.publication.current_content_hash
            && state.publication.current_content_hash === state.publication.published_content_hash
            && state.publication.current_content_hash !== state.publication.deployed_content_hash
          ) {
            context.markCurrentPublicationRequested();
            await context.loadAdminState();
          }

          return;
        }

        await context.loadAdminState(resultMessage(result), "success");
      }, "Publicando cambios...");
    },
  };
}
