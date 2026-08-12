// Canonical, runtime-agnostic factory that turns raw menu_content rows into
// the menu snapshot consumed by both the Astro build-time loader and the
// Node-side validator. Lives under src/ so Astro's bundler can include it; the
// scripts/ wrapper imports it via a relative path.

/**
 * @typedef {import("../types/menu").MenuContentSnapshot} MenuContentSnapshot
 */

export const loadRows = async (sql) => {
  const [
    profiles,
    facts,
    prices,
    priceVariants,
    dailyItems,
    profileServiceSettings,
    catalogSections,
    catalogItems,
    catalogItemImages,
    catalogItemOptions,
    grillFamilies,
    grillItems,
  ] = await Promise.all([
    sql`select * from menu_content.menu_profiles order by id`,
    sql`select * from menu_content.menu_profile_facts order by profile_id, order_index`,
    sql`select pricing_key, kind, amount from menu_content.menu_prices order by pricing_key`,
    sql`select * from menu_content.menu_price_variants order by pricing_key, order_index`,
    sql`select * from menu_content.menu_daily_items order by order_index`,
    sql`select * from menu_content.menu_profile_service_settings order by profile_id`,
    sql`select * from menu_content.menu_catalog_sections order by order_index`,
    sql`select * from menu_content.menu_catalog_items order by section_id, order_index`,
    sql`select * from menu_content.menu_catalog_item_images order by catalog_item_id, order_index`,
    sql`select * from menu_content.menu_catalog_item_options order by catalog_item_id, order_index`,
    sql`select * from menu_content.menu_grill_families order by order_index`,
    sql`select * from menu_content.menu_grill_catalog_items order by order_index`,
  ]);

  return {
    profiles,
    facts,
    prices,
    priceVariants,
    dailyItems,
    profileServiceSettings,
    catalogSections,
    catalogItems,
    catalogItemImages,
    catalogItemOptions,
    grillFamilies,
    grillItems,
  };
};

const publicationSnapshotVersionOneFields = [
  ["profiles", "profiles"],
  ["profile_facts", "facts"],
  ["prices", "prices"],
  ["price_variants", "priceVariants"],
  ["daily_items", "dailyItems"],
  ["profile_service_settings", "profileServiceSettings"],
  ["catalog_sections", "catalogSections"],
  ["catalog_items", "catalogItems"],
  ["catalog_item_images", "catalogItemImages"],
  ["catalog_item_options", "catalogItemOptions"],
  ["grill_families", "grillFamilies"],
  ["grill_items", "grillItems"],
];

export const rowsFromPublicationSnapshot = (contentSnapshot, snapshotVersion) => {
  if (snapshotVersion !== 1) {
    throw new Error("Menu publication snapshot version is unsupported.");
  }

  if (!contentSnapshot || typeof contentSnapshot !== "object" || Array.isArray(contentSnapshot)) {
    throw new Error("Menu publication content snapshot must be an object.");
  }

  return Object.fromEntries(
    publicationSnapshotVersionOneFields.map(([snapshotKey, rowKey]) => {
      const value = contentSnapshot[snapshotKey];

      if (!Array.isArray(value)) {
        throw new Error(`Menu publication content snapshot field is invalid: ${snapshotKey}.`);
      }

      return [rowKey, value];
    }),
  );
};

/** @returns {MenuContentSnapshot} */
export const createSnapshot = (rows, options = {}) => {
  const transformImages =
    options.transformImages ??
    ((values) => values.filter((value) => typeof value === "string" && value.length > 0));
  const priceMap = createPriceMap(rows.prices, rows.priceVariants);
  const factsByProfile = groupByStringKey(rows.facts, "profile_id");
  const catalogItemsBySection = groupByStringKey(rows.catalogItems, "section_id");
  const imagesByCatalogItem = groupByNumberKey(rows.catalogItemImages ?? [], "catalog_item_id");
  const optionsByCatalogItem = groupByNumberKey(rows.catalogItemOptions, "catalog_item_id");
  const grillItemsByFamily = groupByStringKey(rows.grillItems, "family_id");

  const profiles = rows.profiles.map((profile) => ({
    id: profile.id,
    data: {
      id: profile.id,
      eyebrow: profile.eyebrow,
      title: profile.title,
      description: profile.description,
      infoTitle: profile.info_title,
      facts: (factsByProfile.get(profile.id) ?? []).map((fact) =>
        cleanOptional({
          id: fact.fact_id,
          label: fact.label,
          value: fact.value,
          link:
            fact.link_text && fact.link_href
              ? { text: fact.link_text, href: fact.link_href }
              : undefined,
        }),
      ),
    },
  }));

  return {
    profiles,
    catalogSections: rows.catalogSections.map((section) =>
      createCatalogSection({
        section,
        items: catalogItemsBySection.get(section.section_id) ?? [],
        imagesByCatalogItem,
        optionsByCatalogItem,
        priceMap,
        transformImages,
      }),
    ),
    dailyMenu: {
      items: rows.dailyItems.map((item) =>
        createFlatItem(item, [], priceMap),
      ),
    },
    profileServiceSettings: rows.profileServiceSettings.map((entry) => ({
      menuId: entry.profile_id,
      serviceKind: entry.service_kind,
    })),
    grillSection: {
      sectionId: "parrilla",
      title: "Parrilla",
      order: 10,
      presentation: "compact-list",
      items: rows.grillFamilies
        .map((family) =>
          createGrillFamilyItem(
            family,
            grillItemsByFamily.get(family.family_id) ?? [],
            priceMap,
          ),
        )
        .filter((item) => item.pricing.variants.length > 0),
    },
  };
};

const createGrillFamilyItem = (family, items, priceMap) => {
  const variants = items.map((item) => createGrillPricingVariant(item, priceMap));

  return {
    itemId: family.family_id,
    name: family.title,
    available: true,
    pricing: {
      kind: "variants",
      variants,
    },
  };
};

const createGrillPricingVariant = (item, priceMap) => {
  const pricing = requireMapValue(priceMap, item.pricing_key);

  if (pricing.kind !== "fixed") {
    throw new Error(`Grill item ${item.item_id} must use fixed pricing.`);
  }

  return cleanOptional({
    id: item.item_id,
    name: item.variant_name ?? item.name,
    price: pricing.price,
    available: true,
    availabilityItemId: item.item_id,
  });
};

const createCatalogSection = ({
  section,
  items,
  imagesByCatalogItem,
  optionsByCatalogItem,
  priceMap,
  transformImages,
}) => {
  const baseSection = cleanOptional({
    sectionId: section.section_id,
    title: section.title,
    order: section.order_index,
    presentation:
      section.presentation === "compact-list" ? section.presentation : undefined,
  });

  return {
    ...baseSection,
    items: items.map((item) =>
      createFlatItem(
        item,
        optionsByCatalogItem.get(Number(item.id)) ?? [],
        priceMap,
        transformImages,
        imagesByCatalogItem.get(Number(item.id)) ?? [],
      ),
    ),
  };
};

const createFlatItem = (
  item,
  options,
  priceMap,
  transformImages = (values) =>
    values.filter((value) => typeof value === "string" && value.length > 0),
  imageRows = [],
) => {
  const imagePaths = transformImages(imageRows.map((image) => image.image_path));

  return cleanOptional({
    itemId: item.item_id,
    name: item.name,
    description: item.description ?? undefined,
    available: true,
    pricing: readPricing(priceMap, item.pricing_key),
    options:
      options.length > 0
        ? options.map((option) =>
            cleanOptional({
              id: option.option_id,
              name: option.name,
              available: true,
            }),
          )
        : undefined,
    images: imagePaths.length > 0 ? imagePaths : undefined,
  });
};

const createPriceMap = (prices, variants) => {
  const variantsByPrice = groupByStringKey(variants, "pricing_key");

  return new Map(
    prices.map((price) => {
      if (price.kind === "fixed") {
        return [
          price.pricing_key,
          { kind: "fixed", price: { amount: Number(price.amount) } },
        ];
      }

      if (price.kind === "included") {
        return [price.pricing_key, { kind: "included" }];
      }

      return [
        price.pricing_key,
        {
          kind: "variants",
          variants: (variantsByPrice.get(price.pricing_key) ?? []).map((variant) => ({
            id: variant.variant_id,
            name: variant.name,
            price: { amount: Number(variant.amount) },
            available: true,
          })),
        },
      ];
    }),
  );
};

const readPricing = (priceMap, pricingKey) => {
  if (!pricingKey) {
    return undefined;
  }

  return requireMapValue(priceMap, pricingKey);
};

const groupByStringKey = (rows, key) => groupBy(rows, (row) => row[key]);

const groupByNumberKey = (rows, key) => groupBy(rows, (row) => Number(row[key]));

const groupBy = (rows, getKey) => {
  const grouped = new Map();

  for (const row of rows) {
    const key = getKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return grouped;
};

const requireMapValue = (map, key) => {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Missing Supabase menu row for key: ${String(key)}`);
  }

  return value;
};

const cleanOptional = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
