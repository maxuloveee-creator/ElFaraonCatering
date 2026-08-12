import type {
  AdminOperationalState,
  AvailabilityTargetState,
  CatalogItemOptionState,
  CatalogItemState,
  CatalogSectionState,
  GrillFamilyState,
  GrillItemState,
} from "./types";

export function getTargetKey(target: {
  menu_id: string;
  section_id: string;
  item_id: string;
}): string {
  return `${target.menu_id}/${target.section_id}/${target.item_id}`;
}

export function getOverlayKey(overlay: {
  menu_id: string;
  section_id: string;
  item_id: string;
}): string {
  return `${overlay.menu_id}/${overlay.section_id}/${overlay.item_id}`;
}

export function normalizeAdminState(
  state: AdminOperationalState,
): AdminOperationalState {
  return {
    ...state,
    profiles: Array.isArray(state.profiles) ? state.profiles : [],
    service_settings: Array.isArray(state.service_settings) ? state.service_settings : [],
    daily_menu: Array.isArray(state.daily_menu) ? state.daily_menu : [],
    availability_targets: Array.isArray(state.availability_targets)
      ? state.availability_targets.map(normalizeAvailabilityTarget)
      : [],
    availability_overlays: Array.isArray(state.availability_overlays) ? state.availability_overlays : [],
    prices: {
      fixed: Array.isArray(state.prices?.fixed) ? state.prices.fixed : [],
      variants: Array.isArray(state.prices?.variants) ? state.prices.variants : [],
    },
    grill_editor: {
      families: Array.isArray(state.grill_editor?.families)
        ? state.grill_editor.families.map(normalizeGrillFamily)
        : [],
      items: Array.isArray(state.grill_editor?.items)
        ? state.grill_editor.items.map(normalizeGrillItem)
        : [],
    },
    catalog_editor: {
      sections: Array.isArray(state.catalog_editor?.sections)
        ? state.catalog_editor.sections.map(normalizeCatalogSection)
        : [],
      items: Array.isArray(state.catalog_editor?.items)
        ? state.catalog_editor.items.map(normalizeCatalogItem)
        : [],
    },
    publication: normalizePublicationState(
      (state as Partial<AdminOperationalState>).publication,
    ),
  };
}

function normalizePublicationState(
  publication: Partial<AdminOperationalState["publication"]> | undefined,
): AdminOperationalState["publication"] {
  const phase = publication?.phase;

  return {
    phase:
      phase === "up_to_date"
      || phase === "changes_pending"
      || phase === "publishing"
      || phase === "failed"
        ? phase
        : "failed",
    has_newer_changes: publication?.has_newer_changes === true,
    can_retry: publication?.can_retry === true,
    requested_at:
      typeof publication?.requested_at === "string" && publication.requested_at.trim()
        ? publication.requested_at
        : null,
    expires_at:
      typeof publication?.expires_at === "string" && publication.expires_at.trim()
        ? publication.expires_at
        : null,
  };
}

function normalizeGrillFamily(family: GrillFamilyState): GrillFamilyState {
  return {
    ...family,
    item_count: normalizeNonnegativeInteger(family.item_count),
  };
}

function normalizeGrillItem(item: GrillItemState): GrillItemState {
  const priceAmount = (item as { price_amount?: unknown }).price_amount;

  return {
    ...item,
    price_amount:
      typeof priceAmount === "number" && Number.isSafeInteger(priceAmount) && priceAmount >= 0
        ? priceAmount
        : null,
  };
}

function normalizeCatalogSection(section: CatalogSectionState): CatalogSectionState {
  return {
    ...section,
    item_count: normalizeNonnegativeInteger(section.item_count),
  };
}

function normalizeCatalogItem(item: CatalogItemState): CatalogItemState {
  const priceAmount = (item as { price_amount?: unknown }).price_amount;

  return {
    ...item,
    price_amount:
      typeof priceAmount === "number" && Number.isSafeInteger(priceAmount) && priceAmount >= 0
        ? priceAmount
        : null,
    has_image: item.has_image === true,
    option_count: normalizeNonnegativeInteger(item.option_count),
    options: Array.isArray(item.options) ? item.options.map(normalizeCatalogItemOption) : [],
  };
}

function normalizeCatalogItemOption(option: CatalogItemOptionState): CatalogItemOptionState {
  return {
    ...option,
    order_index: normalizeNonnegativeInteger(option.order_index),
  };
}

function normalizeAvailabilityTarget(target: AvailabilityTargetState): AvailabilityTargetState {
  const priceAmount = (target as { price_amount?: unknown }).price_amount;

  return {
    ...target,
    price_amount:
      typeof priceAmount === "number" && Number.isSafeInteger(priceAmount) && priceAmount >= 0
        ? priceAmount
        : null,
  };
}

function normalizeNonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
