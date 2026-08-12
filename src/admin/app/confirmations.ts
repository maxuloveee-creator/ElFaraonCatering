export function confirmPublishChanges(): boolean {
  return window.confirm(
    "Vas a publicar todos los cambios guardados. El menú se actualizará automáticamente cuando termine. ¿Continuar?",
  );
}

export function confirmDeleteGrillProduct(title: string): boolean {
  return window.confirm(
    `Vas a eliminar ${title} y todas sus opciones de parrilla. El cambio se verá después de publicar. ¿Continuar?`,
  );
}

export function confirmDeleteCatalogItem(name: string, hasImage: boolean): boolean {
  const imageWarning = hasImage ? " Este item tiene una foto asociada." : "";

  return window.confirm(
    `Vas a eliminar ${name} del menú fijo.${imageWarning} El cambio se verá después de publicar. ¿Continuar?`,
  );
}

export function confirmDeleteGrillItem(name: string): boolean {
  return window.confirm(
    `Vas a eliminar la opción ${name} de parrilla. El cambio se verá después de publicar. ¿Continuar?`,
  );
}

export function confirmDeleteCatalogOption(name: string): boolean {
  return window.confirm(
    `Vas a eliminar el sabor ${name}. El cambio se verá después de publicar. ¿Continuar?`,
  );
}
