import postgres from "postgres";
import { loadSupabaseMenuSnapshot } from "./menu-content-supabase.mjs";
import {
  isMenuPlaceholderImagePath,
  isSafeMenuImagePath,
} from "../src/utils/menuImagePath.mjs";

const expectedMenuIds = ["corpo", "teleinde"];
const privateDatabaseUrlEnvName = ["SUPABASE", "DB", "URL"].join("_");
const databaseUrl = process.env[privateDatabaseUrlEnvName];
const technicalIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const expectedDailyItemIds = [
  "menu-del-dia",
  "menu-vegetariano-del-dia",
];

const expectedConstraints = [
  "menu_prices_kind_amount_valid",
  "menu_profile_facts_link_pair_valid",
  "menu_catalog_item_images_path_valid",
];

const expectedIndexes = [
  "menu_daily_items_item_id_key",
  "menu_daily_items_order_index_key",
  "menu_profile_service_settings_pkey",
  "menu_price_variants_pricing_key_order_index_key",
  "menu_catalog_sections_section_id_key",
  "menu_catalog_sections_order_index_key",
  "menu_catalog_items_section_id_item_id_key",
  "menu_catalog_items_section_id_order_index_key",
  "menu_catalog_item_images_catalog_item_id_order_index_key",
  "menu_catalog_item_options_catalog_item_id_order_index_key",
  "menu_grill_families_order_index_key",
  "menu_grill_catalog_items_item_id_key",
  "menu_grill_catalog_items_order_index_key",
];

const expectedTables = [
  "menu_profiles",
  "menu_profile_facts",
  "menu_prices",
  "menu_price_variants",
  "menu_daily_items",
  "menu_profile_service_settings",
  "menu_catalog_sections",
  "menu_catalog_items",
  "menu_catalog_item_images",
  "menu_catalog_item_options",
  "menu_grill_families",
  "menu_grill_catalog_items",
];

const retiredTables = [
  "menu_profile_payments",
  "menu_profile_payment_methods",
  "menu_catalog_groups",
];

if (!databaseUrl) {
  console.error("Private Supabase database URL is required for menu validation.");
  process.exit(1);
}

const errors = [];
let snapshot;

try {
  snapshot = await loadSupabaseMenuSnapshot(databaseUrl);
} catch (error) {
  console.error("Menu validation failed while reading Supabase menu content.");
  console.error(sanitizeError(error));
  process.exit(1);
}

validateSnapshot(snapshot, errors);

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
});

try {
  await validateSchema(sql, errors);
} catch (error) {
  errors.push(`Schema audit query failed: ${sanitizeError(error)}`);
} finally {
  await sql.end();
}

if (errors.length > 0) {
  console.error("Menu validation failed:");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log(`Menu validation passed for ${expectedMenuIds.join(", ")}.`);

function validateSnapshot(snapshot, errors) {
  const profileIds = snapshot.profiles.map((entry) => entry.data.id);
  const profileIdSet = new Set(profileIds);
  const profileServiceMenuIds = snapshot.profileServiceSettings.map((entry) => entry.menuId);

  assertUnique(profileIds, "menu profile id", errors);
  assertUnique(
    snapshot.catalogSections.map((section) => section.sectionId),
    "catalog section id",
    errors,
  );
  assertUnique(
    snapshot.catalogSections.map((section) => section.order),
    "catalog section order",
    errors,
  );
  assertUnique(profileServiceMenuIds, "profile service settings entry", errors);

  for (const menuId of expectedMenuIds) {
    if (!profileIdSet.has(menuId)) {
      errors.push(`Missing required menu profile: ${menuId}`);
    }
  }

  for (const profile of snapshot.profiles) {
    validateProfile(profile.data, errors);
  }

  validateDailyMenu(snapshot.dailyMenu, errors);
  validateSection("grill service", snapshot.grillSection, errors);
  validateGrillService(snapshot.grillSection, errors);

  for (const settings of snapshot.profileServiceSettings) {
    if (!profileIdSet.has(settings.menuId)) {
      errors.push(`Profile service settings references unknown profile: ${settings.menuId}`);
    }

    if (settings.serviceKind !== "daily-menu" && settings.serviceKind !== "grill") {
      errors.push(`Profile service settings ${settings.menuId} serviceKind must be daily-menu or grill.`);
    }
  }

  for (const menuId of profileIds) {
    if (!profileServiceMenuIds.includes(menuId)) {
      errors.push(`Missing profile service settings for ${menuId}.`);
    }
  }

  for (const section of snapshot.catalogSections) {
    validateSection(`catalog section ${section.sectionId}`, section, errors);
  }
}

function validateDailyMenu(dailyMenu, errors) {
  if (!dailyMenu) {
    errors.push("Current daily menu must be defined.");
    return;
  }

  if (!Array.isArray(dailyMenu.items) || dailyMenu.items.length !== expectedDailyItemIds.length) {
    errors.push("Current daily menu must define the two daily menu options.");
    return;
  }

  const dailyItemIds = dailyMenu.items.map((item) => item.itemId);

  for (const expectedDailyItemId of expectedDailyItemIds) {
    if (!dailyItemIds.includes(expectedDailyItemId)) {
      errors.push(`Current daily menu is missing option: ${expectedDailyItemId}`);
    }
  }

  validateSection(
    "daily menu service",
    {
      sectionId: "menu-del-dia",
      title: "Menu del dia",
      order: 10,
      items: dailyMenu.items,
    },
    errors,
  );
}

function validateProfile(profile, errors) {
  validateTechnicalId(profile.id, `profile ${profile.id}`, errors);
  validateNonEmptyString(profile.eyebrow, `profile ${profile.id} eyebrow`, errors);
  validateNonEmptyString(profile.title, `profile ${profile.id} title`, errors);
  validateNonEmptyString(profile.description, `profile ${profile.id} description`, errors);
  validateNonEmptyString(profile.infoTitle, `profile ${profile.id} infoTitle`, errors);

  if (!Array.isArray(profile.facts) || profile.facts.length === 0) {
    errors.push(`Profile ${profile.id} must have at least one fact.`);
  } else {
    const paymentFact = profile.facts.find((fact) => fact.id === "pagos");

    if (!paymentFact) {
      errors.push(`Profile ${profile.id} must define pagos fact.`);
    }

    assertUnique(
      profile.facts.map((fact) => fact.id),
      `profile ${profile.id} fact id`,
      errors,
    );

    for (const fact of profile.facts) {
      validateTechnicalId(fact.id, `profile ${profile.id} fact ${fact.id}`, errors);
      validateNonEmptyString(fact.label, `profile ${profile.id} fact ${fact.id} label`, errors);
      validateNonEmptyString(fact.value, `profile ${profile.id} fact ${fact.id} value`, errors);

      if (fact.link) {
        validateNonEmptyString(fact.link.text, `profile ${profile.id} fact ${fact.id} link text`, errors);
        validateNonEmptyString(fact.link.href, `profile ${profile.id} fact ${fact.id} link href`, errors);
      }
    }
  }
}

function validateSection(scope, section, errors) {
  validateTechnicalId(section.sectionId, `${scope} sectionId`, errors);
  validateNonEmptyString(section.title, `${scope} title`, errors);
  validateOrder(section.order, `${scope} order`, errors);

  if (!Array.isArray(section.items) || section.items.length === 0) {
    errors.push(`${scope} must define direct items.`);
    return;
  }

  assertUnique(
    section.items.map((item) => item.itemId),
    `${scope} item id`,
    errors,
  );

  section.items.forEach((item, index) => {
    validateItem(`${scope} item ${item.itemId}`, item, errors);

    if (!item.pricing) {
      errors.push(`${scope} item ${item.itemId} must define pricing.`);
    }

    validateOrder(index, `${scope} item ${item.itemId} projected order`, errors);
  });
}

function validateItem(scope, item, errors) {
  validateTechnicalId(item.itemId, scope, errors);
  validateNonEmptyString(item.name, `${scope} name`, errors);

  if (typeof item.available !== "boolean") {
    errors.push(`${scope} available must be boolean.`);
  }

  validatePricing(item.pricing, scope, errors);

  if (item.images !== undefined) {
    if (!Array.isArray(item.images)) {
      errors.push(`${scope} images must be an array.`);
    } else {
      item.images.forEach((image, index) => {
        if (!isSafeMenuImagePath(image)) {
          errors.push(`${scope} images[${index}] must be a local file under /uploads/.`);
        }

        if (isMenuPlaceholderImagePath(image)) {
          errors.push(`${scope} images[${index}] must be a real menu image, not a placeholder.`);
        }
      });

      assertUnique(item.images, `${scope} image path`, errors);
    }
  }

  if (item.options !== undefined) {
    if (!Array.isArray(item.options)) {
      errors.push(`${scope} options must be an array.`);
      return;
    }

    assertUnique(
      item.options.map((option) => option.id),
      `${scope} option id`,
      errors,
    );

    for (const option of item.options) {
      validateTechnicalId(option.id, `${scope} option ${option.id}`, errors);
      validateNonEmptyString(option.name, `${scope} option ${option.id} name`, errors);

      if (typeof option.available !== "boolean") {
        errors.push(`${scope} option ${option.id} available must be boolean.`);
      }
    }
  }
}

function validateGrillService(section, errors) {
  if (!Array.isArray(section.items) || section.items.length === 0) {
    errors.push("Grill service must render families as direct items.");
    return;
  }

  if (section.groups !== undefined) {
    errors.push("Grill service must not render families as groups.");
    return;
  }

  for (const item of section.items) {
    if (item.pricing?.kind !== "variants") {
      errors.push(`Grill family ${item.itemId} must define variants pricing.`);
      continue;
    }

    for (const variant of item.pricing.variants) {
      if (!variant.availabilityItemId) {
        errors.push(`Grill family ${item.itemId} variant ${variant.id} must define availabilityItemId.`);
        continue;
      }

      validateTechnicalId(
        variant.availabilityItemId,
        `grill family ${item.itemId} variant ${variant.id} availabilityItemId`,
        errors,
      );
    }
  }
}

function validatePricing(pricing, scope, errors) {
  if (!pricing) {
    return;
  }

  if (pricing.kind === "fixed") {
    validateAmount(pricing.price?.amount, `${scope} fixed price`, errors);
    return;
  }

  if (pricing.kind === "included") {
    return;
  }

  if (pricing.kind !== "variants") {
    errors.push(`${scope} has unsupported pricing kind: ${pricing.kind}`);
    return;
  }

  if (!Array.isArray(pricing.variants) || pricing.variants.length === 0) {
    errors.push(`${scope} variants pricing must define variants.`);
    return;
  }

  assertUnique(
    pricing.variants.map((variant) => variant.id),
    `${scope} pricing variant id`,
    errors,
  );

  for (const variant of pricing.variants) {
    validateTechnicalId(variant.id, `${scope} variant ${variant.id}`, errors);
    validateNonEmptyString(variant.name, `${scope} variant ${variant.id} name`, errors);
    validateAmount(variant.price?.amount, `${scope} variant ${variant.id} price`, errors);

    if (typeof variant.available !== "boolean") {
      errors.push(`${scope} variant ${variant.id} available must be boolean.`);
    }

    if (variant.availabilityItemId !== undefined) {
      validateTechnicalId(
        variant.availabilityItemId,
        `${scope} variant ${variant.id} availabilityItemId`,
        errors,
      );
    }
  }
}

async function validateSchema(sql, errors) {
  const tableRows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'menu_content'
      and table_type = 'BASE TABLE'
      and table_name in ${sql(expectedTables)}
  `;
  const presentTables = new Set(tableRows.map((row) => row.table_name));

  for (const tableName of expectedTables) {
    if (!presentTables.has(tableName)) {
      errors.push(`Missing active menu_content table: ${tableName}`);
    }
  }

  const catalogVisibilityRows = await sql`
    select relation.relname as table_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'staff_users'
      and relation.relkind in ('r', 'p')
  `;

  if (catalogVisibilityRows.length !== 1) {
    errors.push("Postgres catalog visibility canary failed for public.staff_users.");
  }

  const retiredTableRows = await sql`
    select
      namespace.nspname as table_schema,
      relation.relname as table_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'menu_content'
      and relation.relkind in ('r', 'p')
      and relation.relname in ${sql(retiredTables)}
  `;

  for (const row of retiredTableRows) {
    errors.push(`Retired menu_content table is still present: ${row.table_name}`);
  }

  const retiredColumnRows = await sql`
    select
      namespace.nspname as table_schema,
      relation.relname as table_name,
      attribute.attname as column_name
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where (
      (
        namespace.nspname = 'menu_content'
        and (
          (relation.relname = 'menu_catalog_sections' and attribute.attname = 'content_kind')
          or (relation.relname = 'menu_catalog_items' and attribute.attname = 'group_id')
          or (
            relation.relname in ('menu_catalog_items', 'menu_daily_items', 'menu_grill_catalog_items')
            and attribute.attname = 'image_path'
          )
        )
      )
      or (
        namespace.nspname = 'public'
        and relation.relname = 'menu_availability_overlays'
        and attribute.attname = 'group_id'
      )
    )
    and attribute.attnum > 0
    and not attribute.attisdropped
    and relation.relkind in ('r', 'p')
  `;

  for (const row of retiredColumnRows) {
    errors.push(`Retired column is still present: ${row.table_schema}.${row.table_name}.${row.column_name}`);
  }

  const unpricedItemRows = await sql`
    select section_id, item_id
    from menu_content.menu_catalog_items
    where pricing_key is null
  `;

  for (const row of unpricedItemRows) {
    errors.push(`Catalog item must define pricing_key: ${row.section_id}/${row.item_id}`);
  }

  const invalidImageOrderRows = await sql`
    select item.section_id, item.item_id
    from menu_content.menu_catalog_items item
    join menu_content.menu_catalog_item_images image
      on image.catalog_item_id = item.id
    group by item.id, item.section_id, item.item_id
    having min(image.order_index) <> 0
      or max(image.order_index) + 1 <> count(*)
  `;

  for (const row of invalidImageOrderRows) {
    errors.push(`Catalog image order must be contiguous from zero: ${row.section_id}/${row.item_id}`);
  }

  const orphanAvailabilityOverlayRows = await sql`
    with possible_targets as (
      select profile.id as menu_id, 'menu-del-dia'::text as section_id, item.item_id
      from menu_content.menu_profiles profile
      cross join menu_content.menu_daily_items item

      union all

      select profile.id, 'parrilla', item.item_id
      from menu_content.menu_profiles profile
      cross join menu_content.menu_grill_catalog_items item

      union all

      select profile.id, item.section_id, item.item_id
      from menu_content.menu_profiles profile
      cross join menu_content.menu_catalog_items item

      union all

      select profile.id, item.section_id, item.item_id || '-' || option.option_id
      from menu_content.menu_profiles profile
      cross join menu_content.menu_catalog_items item
      join menu_content.menu_catalog_item_options option
        on option.catalog_item_id = item.id
    )
    select overlay.menu_id, overlay.section_id, overlay.item_id
    from public.menu_availability_overlays overlay
    where not exists (
      select 1
      from possible_targets target
      where target.menu_id = overlay.menu_id
        and target.section_id = overlay.section_id
        and target.item_id = overlay.item_id
    )
    order by overlay.menu_id, overlay.section_id, overlay.item_id
  `;

  for (const row of orphanAvailabilityOverlayRows) {
    errors.push(
      `Availability overlay references an unknown menu target: ${row.menu_id}/${row.section_id}/${row.item_id}`,
    );
  }

  const constraintRows = await sql`
    select conname
    from pg_constraint
    where connamespace = 'menu_content'::regnamespace
      and conname in ${sql(expectedConstraints)}
  `;
  const presentConstraints = new Set(constraintRows.map((row) => row.conname));

  for (const constraintName of expectedConstraints) {
    if (!presentConstraints.has(constraintName)) {
      errors.push(`Missing menu_content constraint: ${constraintName}`);
    }
  }

  const indexRows = await sql`
    select indexname
    from pg_indexes
    where schemaname = 'menu_content'
      and indexname in ${sql(expectedIndexes)}
  `;
  const presentIndexes = new Set(indexRows.map((row) => row.indexname));

  for (const indexName of expectedIndexes) {
    if (!presentIndexes.has(indexName)) {
      errors.push(`Missing menu_content index: ${indexName}`);
    }
  }
}

function validateNonEmptyString(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string.`);
  }
}

function validateTechnicalId(value, label, errors) {
  if (typeof value !== "string" || !technicalIdPattern.test(value)) {
    errors.push(`${label} must be an ASCII kebab-case technical id.`);
  }
}

function validateOrder(value, label, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a nonnegative integer.`);
  }
}

function validateAmount(value, label, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a nonnegative integer amount.`);
  }
}

function assertUnique(values, label, errors) {
  const seenValues = new Set();

  for (const value of values) {
    if (seenValues.has(value)) {
      errors.push(`Duplicate ${label}: ${String(value)}`);
    }

    seenValues.add(value);
  }
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);

  return databaseUrl ? message.replaceAll(databaseUrl, "[redacted]") : message;
}
