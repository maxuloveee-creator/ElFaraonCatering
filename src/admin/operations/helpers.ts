import type { AdminOperationalState, RpcResult } from "../core/types";
import { resultMessage } from "../core/responses";
import type { AdminOperationContext } from "./types";

interface MutationInput {
  mutation: string;
  body: Record<string, unknown>;
  busyText: string;
}

export interface PublicationMutationInput extends MutationInput {
  successPrefix: string;
}

export interface InstantMutationInput extends MutationInput {
  changedMessage: string;
}

export function createMutationRunner(context: AdminOperationContext) {
  return {
    runPublicationMutation(input: PublicationMutationInput): Promise<void> {
      return context.runBusy(async () => {
        const result = requireOk(await context.callMutation(input.mutation, input.body));

        await context.loadAdminState(
          publicationSaveStatus(input.successPrefix, result.changed),
          "success",
        );
      }, input.busyText);
    },

    runInstantMutation(input: InstantMutationInput): Promise<void> {
      return context.runBusy(async () => {
        const result = requireOk(await context.callMutation(input.mutation, input.body));

        await context.loadAdminState(
          result.changed ? input.changedMessage : "Sin cambios.",
          "success",
        );
      }, input.busyText);
    },
  };
}

export function requireOk(result: RpcResult): RpcResult {
  if (!result.ok) {
    throw new Error(resultMessage(result));
  }

  return result;
}

export function publicationSaveStatus(
  successPrefix: string,
  changed: boolean,
): (state: AdminOperationalState) => string {
  return () => changed ? successPrefix : "Sin cambios.";
}

export function partialMutationError(error: unknown, results: RpcResult[]): Error {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";

  if (!results.some((result) => result.ok)) {
    return new Error(message);
  }

  return new Error(
    `Algunos cambios pueden haberse guardado, pero la operación no terminó completa. Revisá el item antes de volver a intentar. Detalle: ${message}`,
  );
}
