import type { AdminActionHandlerContext } from "./actionHandlers";
import { confirmPublishChanges } from "./confirmations";

export async function handlePublishAction(context: AdminActionHandlerContext): Promise<void> {
  const publication = context.getCurrentState()?.publication;

  if (
    !publication
    || publication.phase === "up_to_date"
    || publication.phase === "publishing"
    || (publication.phase === "failed" && !publication.can_retry)
  ) {
    return;
  }

  if (!context.formState.confirmUnsavedChanges() || !confirmPublishChanges()) {
    return;
  }

  await context.adminOperations.publishChanges();
}
