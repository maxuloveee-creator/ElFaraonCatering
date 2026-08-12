import type {
  AuthApiResponse,
  AuthSession,
  RpcResult,
} from "./types";

const mutationResultMessages: Record<string, string> = {
  permission_denied: "No tenés permisos para esta acción.",
  publish_queued: "Publicación en curso. Podés seguir trabajando.",
  publish_already_active: "Ya hay una publicación en curso. Podés seguir trabajando.",
  publish_failed: "No se pudo publicar. Tus cambios siguen guardados.",
  available_override_required: "La disponibilidad seleccionada no es válida.",
  availability_targets_required: "Seleccioná al menos un item.",
  invalid_availability_target: "Alguno de los items seleccionados ya no existe.",
  invalid_amount: "El importe no es válido.",
  daily_menu_name_required: "El nombre del menú es obligatorio.",
  daily_menu_available_required: "La disponibilidad del menú es obligatoria.",
  invalid_service_kind: "El servicio seleccionado no es válido.",
  catalog_item_id_required: "No se pudo generar el identificador del item.",
  invalid_catalog_item_id: "El identificador generado para el item no es válido.",
  catalog_item_name_required: "El nombre del item es obligatorio.",
  catalog_section_not_found: "La sección seleccionada no existe.",
  invalid_catalog_group: "La sección seleccionada no acepta grupo.",
  catalog_group_required: "Seleccioná un grupo existente.",
  catalog_group_not_found: "El grupo seleccionado no existe.",
  catalog_item_exists: "Ya existe un item equivalente en esta ubicación.",
  catalog_item_unchanged: "Sin cambios.",
  catalog_item_updated: "Item actualizado.",
  invalid_catalog_option_id: "El identificador generado para el sabor no es válido.",
  catalog_option_exists: "Ya existe un sabor equivalente en esta subcategoría.",
  catalog_options_not_enabled: "Solo se pueden administrar sabores en subcategorías que ya usan opciones.",
  catalog_option_id_required: "No se pudo generar el identificador de la opción.",
  catalog_option_name_required: "El nombre de la opción es obligatorio.",
  catalog_option_added: "Opción agregada.",
  catalog_option_not_found: "La opción seleccionada ya no existe.",
  catalog_option_unchanged: "Sin cambios.",
  catalog_option_updated: "Opción actualizada.",
  catalog_option_deleted: "Opción eliminada.",
  catalog_option_must_keep_one: "La subcategoría debe conservar al menos un sabor.",
  catalog_price_key_conflict: "Ya existe un precio incompatible para ese item.",
  catalog_item_not_found: "El item seleccionado ya no existe.",
  catalog_item_locked: "Esta sección solo permite administrar sabores desde Menú fijo.",
  catalog_location_must_keep_item: "No se puede eliminar el último item de una sección o grupo.",
  grill_product_id_required: "No se pudo generar el identificador del producto de parrilla.",
  invalid_grill_product_id: "El identificador generado para el producto no es válido.",
  grill_product_name_required: "El nombre del producto de parrilla es obligatorio.",
  grill_product_exists: "Ya existe un producto de parrilla equivalente.",
  grill_product_unchanged: "Sin cambios.",
  grill_product_updated: "Producto de parrilla actualizado.",
  grill_product_added: "Producto de parrilla agregado.",
  grill_product_deleted: "Producto de parrilla eliminado.",
  grill_option_name_required: "El nombre de la opción de parrilla es obligatorio.",
  grill_item_id_required: "No se pudo generar el identificador del item de parrilla.",
  invalid_grill_item_id: "El identificador generado para el item no es válido.",
  grill_item_name_required: "El nombre del item de parrilla es obligatorio.",
  grill_family_not_found: "La familia de parrilla seleccionada no existe.",
  grill_item_exists: "Ya existe un item de parrilla equivalente.",
  grill_item_not_found: "El item de parrilla seleccionado ya no existe.",
  grill_family_must_keep_item: "No se puede eliminar el último item de una familia.",
  grill_price_key_conflict: "Ya existe un precio incompatible para ese item.",
  grill_item_unchanged: "Sin cambios.",
  grill_item_updated: "Item de parrilla actualizado.",
  grill_item_added: "Item de parrilla agregado.",
  grill_item_deleted: "Item de parrilla eliminado.",
};

export function resultMessage(result: RpcResult): string {
  return mutationResultMessages[result.message] ?? result.message.replaceAll("_", " ");
}

export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const message = (body as {
      error?: unknown;
      error_description?: unknown;
      message?: unknown;
      msg?: unknown;
    }).message
      ?? (body as { msg?: unknown }).msg
      ?? (body as { error_description?: unknown }).error_description
      ?? (body as { error?: unknown }).error;

    if (typeof message === "string" && message.trim()) {
      return toOperationalErrorMessage(message);
    }
  }

  return "No se pudo completar la operación.";
}

export function toOperationalErrorMessage(message: string): string {
  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();

  if (!trimmedMessage) {
    return "No se pudo completar la operación.";
  }

  if (
    lowerMessage.includes("jwt")
    || lowerMessage.includes("token")
    || lowerMessage.includes("session")
    || lowerMessage.includes("expired")
  ) {
    return "La sesión expiró. Volvé a iniciar sesión.";
  }

  if (
    lowerMessage.includes("permission denied")
    || lowerMessage.includes("42501")
    || lowerMessage.includes("row-level")
    || lowerMessage.includes("not authorized")
    || lowerMessage.includes("unauthorized")
  ) {
    return "No tenés permisos para esta acción.";
  }

  if (
    lowerMessage.includes("invalid input")
    || lowerMessage.includes("violates")
    || lowerMessage.includes("constraint")
  ) {
    return "Hay un dato inválido. Revisalo e intentá guardar de nuevo.";
  }

  if (
    lowerMessage.includes("supabase")
    || lowerMessage.includes("pgrst")
    || lowerMessage.includes("rpc")
    || lowerMessage.includes("schema")
    || lowerMessage.includes("function")
  ) {
    return "No se pudo completar la operación. Actualizá el panel e intentá de nuevo.";
  }

  return trimmedMessage;
}

export function isRpcResult(value: unknown): value is RpcResult {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as RpcResult).ok === "boolean"
      && typeof (value as RpcResult).changed === "boolean"
      && typeof (value as RpcResult).requires_redeploy === "boolean"
      && typeof (value as RpcResult).operation === "string"
      && typeof (value as RpcResult).message === "string",
  );
}

export function isAuthResponse(value: unknown): value is AuthApiResponse {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as AuthApiResponse).access_token === "string"
      && typeof (value as AuthApiResponse).refresh_token === "string"
      && typeof (value as AuthApiResponse).expires_in === "number"
      && typeof (value as AuthApiResponse).user === "object",
  );
}

export function isStoredSession(value: unknown): value is AuthSession {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as AuthSession).accessToken === "string"
      && typeof (value as AuthSession).refreshToken === "string"
      && typeof (value as AuthSession).expiresAt === "number",
  );
}
