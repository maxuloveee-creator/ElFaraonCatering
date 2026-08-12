-- Audit expected structural constraints and indexes for the active flat menu_content model.
-- This file is read-only: it does not mutate data or schema.

with expected_tables (table_name, expectation) as (
  values
    ('menu_profiles', 'profile metadata read at build time'),
    ('menu_profile_facts', 'profile fact rows read at build time'),
    ('menu_prices', 'global build-time prices'),
    ('menu_price_variants', 'global build-time variant prices'),
    ('menu_daily_items', 'two build-time daily menu options'),
    ('menu_profile_service_settings', 'active build-time service per profile'),
    ('menu_catalog_sections', 'flat build-time catalog sections'),
    ('menu_catalog_items', 'flat build-time catalog items'),
    ('menu_catalog_item_images', 'optional ordered build-time catalog item images'),
    ('menu_catalog_item_options', 'flat build-time catalog item options'),
    ('menu_grill_families', 'fixed build-time grill families'),
    ('menu_grill_catalog_items', 'fixed build-time grill item list')
),
actual_tables as (
  select table_name
  from information_schema.tables
  where table_schema = 'menu_content'
    and table_type = 'BASE TABLE'
)
select
  'table' as object_type,
  expected.table_name as object_name,
  expected.table_name,
  case
    when actual.table_name is null then 'missing'
    else 'present'
  end as status,
  expected.expectation
from expected_tables expected
left join actual_tables actual
  on actual.table_name = expected.table_name
order by expected.table_name;

with expected_constraints (constraint_name, table_name, expectation) as (
  values
    ('menu_prices_kind_amount_valid', 'menu_prices', 'fixed requires amount; included/variants require null amount'),
    ('menu_profile_facts_link_pair_valid', 'menu_profile_facts', 'link_text and link_href must both be null or both be present'),
    ('menu_catalog_item_images_path_valid', 'menu_catalog_item_images', 'image paths must be local uploads')
),
actual_constraints as (
  select
    constraint_name,
    table_name
  from information_schema.table_constraints
  where table_schema = 'menu_content'
)
select
  'constraint' as object_type,
  expected.constraint_name as object_name,
  expected.table_name,
  case
    when actual.constraint_name is null then 'missing'
    else 'present'
  end as status,
  expected.expectation
from expected_constraints expected
left join actual_constraints actual
  on actual.constraint_name = expected.constraint_name
 and actual.table_name = expected.table_name
order by expected.table_name, expected.constraint_name;

with expected_indexes (index_name, table_name, expectation) as (
  values
    ('menu_daily_items_item_id_key', 'menu_daily_items', 'unique daily menu item id'),
    ('menu_daily_items_order_index_key', 'menu_daily_items', 'unique daily menu order'),
    ('menu_profile_service_settings_pkey', 'menu_profile_service_settings', 'unique service settings row per profile'),
    ('menu_price_variants_pricing_key_order_index_key', 'menu_price_variants', 'unique variant order per price'),
    ('menu_catalog_sections_section_id_key', 'menu_catalog_sections', 'unique catalog section id'),
    ('menu_catalog_sections_order_index_key', 'menu_catalog_sections', 'unique catalog section order'),
    ('menu_catalog_items_section_id_item_id_key', 'menu_catalog_items', 'unique item id per section'),
    ('menu_catalog_items_section_id_order_index_key', 'menu_catalog_items', 'unique item order per section'),
    ('menu_catalog_items_section_visible_name_key', 'menu_catalog_items', 'unique normalized visible item name per section'),
    ('menu_catalog_item_images_catalog_item_id_order_index_key', 'menu_catalog_item_images', 'unique image order per catalog item'),
    ('menu_catalog_item_options_item_visible_name_key', 'menu_catalog_item_options', 'unique normalized visible option name per item'),
    ('menu_catalog_item_options_catalog_item_id_order_index_key', 'menu_catalog_item_options', 'unique option order per catalog item'),
    ('menu_grill_families_visible_title_key', 'menu_grill_families', 'unique normalized visible grill product title'),
    ('menu_grill_families_order_index_key', 'menu_grill_families', 'unique grill family order'),
    ('menu_grill_catalog_items_family_visible_name_key', 'menu_grill_catalog_items', 'unique normalized visible grill option name per family'),
    ('menu_grill_catalog_items_item_id_key', 'menu_grill_catalog_items', 'unique grill item id'),
    ('menu_grill_catalog_items_order_index_key', 'menu_grill_catalog_items', 'unique grill item order')
),
actual_indexes as (
  select
    indexname as index_name,
    tablename as table_name
  from pg_indexes
  where schemaname = 'menu_content'
)
select
  'index' as object_type,
  expected.index_name as object_name,
  expected.table_name,
  case
    when actual.index_name is null then 'missing'
    else 'present'
  end as status,
  expected.expectation
from expected_indexes expected
left join actual_indexes actual
  on actual.index_name = expected.index_name
 and actual.table_name = expected.table_name
order by expected.table_name, expected.index_name;

with expected_constraints (constraint_name, table_name, expectation) as (
  values
    ('menu_publication_revisions_content_hash_valid', 'menu_publication_revisions', 'revision hash format'),
    ('menu_publication_revisions_snapshot_version_valid', 'menu_publication_revisions', 'supported snapshot version'),
    ('menu_publication_revisions_snapshot_object', 'menu_publication_revisions', 'snapshot is a JSON object'),
    ('menu_publication_revisions_snapshot_hash_matches', 'menu_publication_revisions', 'snapshot matches stored hash'),
    ('menu_publish_requests_status_check', 'menu_publish_requests', 'queued, triggered, succeeded, or failed status'),
    ('menu_publish_requests_revision_required', 'menu_publish_requests', 'queued or triggered requests reference a revision'),
    ('menu_publish_requests_expiry_required', 'menu_publish_requests', 'revision-backed requests have a server expiry'),
    ('menu_publish_requests_deployment_id_valid', 'menu_publish_requests', 'Vercel deployment id format'),
    ('menu_publish_requests_deployment_host_valid', 'menu_publish_requests', 'verified deployment host format'),
    ('menu_publish_requests_confirmation_event_id_valid', 'menu_publish_requests', 'bounded confirmation evidence id'),
    ('menu_publish_requests_confirmation_source_valid', 'menu_publish_requests', 'trusted confirmation source'),
    ('menu_publish_requests_confirmation_pair', 'menu_publish_requests', 'confirmation id and source are paired'),
    ('menu_publish_requests_vercel_project_id_valid', 'menu_publish_requests', 'Vercel project id format'),
    ('menu_publish_requests_vercel_team_id_valid', 'menu_publish_requests', 'optional Vercel team id format'),
    ('menu_publication_state_singleton', 'menu_publication_state', 'one singleton publication state key'),
    ('menu_publication_builds_deployment_id_valid', 'menu_publication_builds', 'Vercel deployment id format'),
    ('menu_publication_builds_content_hash_valid', 'menu_publication_builds', 'build hash format'),
    ('menu_publication_builds_project_id_valid', 'menu_publication_builds', 'Vercel project id format'),
    ('menu_publication_promotions_event_id_valid', 'menu_publication_promotions', 'bounded evidence id'),
    ('menu_publication_promotions_source_valid', 'menu_publication_promotions', 'trusted evidence source'),
    ('menu_publication_promotions_deployment_id_valid', 'menu_publication_promotions', 'Vercel deployment id format'),
    ('menu_publication_promotions_content_hash_valid', 'menu_publication_promotions', 'promotion hash format'),
    ('menu_publication_promotions_deployment_host_valid', 'menu_publication_promotions', 'verified deployment host format'),
    ('menu_publication_promotions_project_id_valid', 'menu_publication_promotions', 'Vercel project id format'),
    ('menu_publication_promotions_team_id_valid', 'menu_publication_promotions', 'optional Vercel team id format')
),
actual_constraints as (
  select constraint_name, table_name
  from information_schema.table_constraints
  where table_schema = 'app_private'
)
select
  'constraint' as object_type,
  expected.constraint_name as object_name,
  expected.table_name,
  case when actual.constraint_name is null then 'missing' else 'present' end as status,
  expected.expectation
from expected_constraints expected
left join actual_constraints actual
  on actual.constraint_name = expected.constraint_name
 and actual.table_name = expected.table_name
order by expected.table_name, expected.constraint_name;

with expected_indexes (index_name, table_name, expectation) as (
  values
    ('menu_publish_requests_one_active_idx', 'menu_publish_requests', 'at most one queued or triggered request'),
    ('menu_publish_requests_revision_idx', 'menu_publish_requests', 'revision request lookup'),
    ('menu_publication_revisions_pkey', 'menu_publication_revisions', 'immutable revision id'),
    ('menu_publication_revisions_created_by_idx', 'menu_publication_revisions', 'revision creator history'),
    ('menu_publication_revision_events_pkey', 'menu_publication_revision_events', 'exact event membership per revision'),
    ('menu_publication_revision_events_change_event_idx', 'menu_publication_revision_events', 'revision lookup by captured event'),
    ('menu_publication_state_pkey', 'menu_publication_state', 'singleton state key'),
    ('menu_publication_builds_pkey', 'menu_publication_builds', 'one binding per deployment'),
    ('menu_publication_builds_request_idx', 'menu_publication_builds', 'build lookup by optional request'),
    ('menu_publication_builds_revision_idx', 'menu_publication_builds', 'build lookup by revision'),
    ('menu_publication_promotions_pkey', 'menu_publication_promotions', 'idempotent evidence event id'),
    ('menu_publication_promotions_deployment_idx', 'menu_publication_promotions', 'promotion history by deployment')
),
actual_indexes as (
  select indexname as index_name, tablename as table_name
  from pg_indexes
  where schemaname = 'app_private'
)
select
  'index' as object_type,
  expected.index_name as object_name,
  expected.table_name,
  case when actual.index_name is null then 'missing' else 'present' end as status,
  expected.expectation
from expected_indexes expected
left join actual_indexes actual
  on actual.index_name = expected.index_name
 and actual.table_name = expected.table_name
order by expected.table_name, expected.index_name;

select
  'menu_prices_kind_amount_invalid' as diagnostic,
  pricing_key,
  kind,
  amount
from menu_content.menu_prices
where not (
  (kind = 'fixed' and amount is not null)
  or (kind in ('included', 'variants') and amount is null)
);

select
  'menu_profile_facts_link_pair_invalid' as diagnostic,
  profile_id,
  fact_id,
  link_text,
  link_href
from menu_content.menu_profile_facts
where not (
  (link_text is null and link_href is null)
  or (link_text is not null and link_href is not null)
);

select
  'menu_daily_items_count_invalid' as diagnostic,
  count(*) as daily_item_count
from menu_content.menu_daily_items
having count(*) <> 2;

with expected_daily_items (item_id, order_index) as (
  values
    ('menu-del-dia', 0),
    ('menu-vegetariano-del-dia', 1)
)
select
  'menu_daily_item_missing' as diagnostic,
  expected.item_id,
  expected.order_index
from expected_daily_items expected
where not exists (
  select 1
  from menu_content.menu_daily_items item
  where item.item_id = expected.item_id
    and item.order_index = expected.order_index
);

select
  'menu_profile_service_settings_missing' as diagnostic,
  profile.id as profile_id
from menu_content.menu_profiles profile
left join menu_content.menu_profile_service_settings settings
  on settings.profile_id = profile.id
where settings.profile_id is null;

select
  'menu_catalog_item_pricing_missing' as diagnostic,
  item.section_id,
  item.item_id
from menu_content.menu_catalog_items item
where item.pricing_key is null;

select
  'build_time_available_not_true' as diagnostic,
  'menu_daily_items' as table_name,
  item.item_id as object_id
from menu_content.menu_daily_items item
where item.available is distinct from true
union all
select
  'build_time_available_not_true',
  'menu_price_variants',
  variant.pricing_key || ':' || variant.variant_id
from menu_content.menu_price_variants variant
where variant.available is distinct from true
union all
select
  'build_time_available_not_true',
  'menu_catalog_items',
  item.section_id || ':' || item.item_id
from menu_content.menu_catalog_items item
where item.available is distinct from true
union all
select
  'build_time_available_not_true',
  'menu_catalog_item_options',
  item.section_id || ':' || item.item_id || ':' || option.option_id
from menu_content.menu_catalog_item_options option
join menu_content.menu_catalog_items item
  on item.id = option.catalog_item_id
where option.available is distinct from true
union all
select
  'build_time_available_not_true',
  'menu_grill_catalog_items',
  item.item_id
from menu_content.menu_grill_catalog_items item
where item.available is distinct from true
order by table_name, object_id;

select
  'legacy_table_still_present' as diagnostic,
  table_name
from information_schema.tables
where table_schema = 'menu_content'
  and table_name in (
    'menu_daily_menu',
    'menu_daily_service_settings',
    'menu_sections',
    'menu_groups',
    'menu_items',
    'menu_item_options',
    'menu_section_items',
    'menu_group_items',
    'menu_grill_items',
    'menu_overrides',
    'menu_override_sections',
    'menu_override_groups',
    'menu_override_section_items',
    'menu_override_group_items'
  )
order by table_name;

select
  'retired_schema_object_present' as diagnostic,
  object_name
from (
  select table_name as object_name
  from information_schema.tables
  where table_schema = 'menu_content'
    and table_name = 'menu_catalog_groups'
  union all
  select table_name || '.' || column_name
  from information_schema.columns
  where table_schema = 'menu_content'
    and (
      (table_name = 'menu_catalog_sections' and column_name = 'content_kind')
      or (table_name = 'menu_catalog_items' and column_name = 'group_id')
      or (
        table_name in ('menu_catalog_items', 'menu_daily_items', 'menu_grill_catalog_items')
        and column_name = 'image_path'
      )
    )
) retired;

select
  'invalid_catalog_image_order' as diagnostic,
  item.section_id,
  item.item_id
from menu_content.menu_catalog_items item
join menu_content.menu_catalog_item_images image
  on image.catalog_item_id = item.id
group by item.id, item.section_id, item.item_id
having min(image.order_index) <> 0
  or max(image.order_index) + 1 <> count(*);

-- Exact active table column shape.
with expected_columns (table_schema, table_name, column_name, data_type, is_nullable, column_default) as (
  values
    ('app_private', 'menu_publish_requests', 'id', 'bigint', 'NO', null),
    ('app_private', 'menu_publish_requests', 'requested_by', 'uuid', 'YES', null),
    ('app_private', 'menu_publish_requests', 'status', 'text', 'NO', null),
    ('app_private', 'menu_publish_requests', 'message', 'text', 'NO', null),
    ('app_private', 'menu_publish_requests', 'vercel_status_code', 'integer', 'YES', null),
    ('app_private', 'menu_publish_requests', 'vercel_job_id', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_publish_requests', 'completed_at', 'timestamp with time zone', 'YES', null),
    ('app_private', 'menu_publish_requests', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_publish_requests', 'menu_content_hash', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'change_event_count', 'integer', 'NO', '0'),
    ('app_private', 'menu_publish_requests', 'revision_id', 'uuid', 'YES', null),
    ('app_private', 'menu_publish_requests', 'expires_at', 'timestamp with time zone', 'YES', null),
    ('app_private', 'menu_publish_requests', 'triggered_at', 'timestamp with time zone', 'YES', null),
    ('app_private', 'menu_publish_requests', 'deployment_id', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'deployment_host', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'confirmation_event_id', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'confirmation_source', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'promoted_at', 'timestamp with time zone', 'YES', null),
    ('app_private', 'menu_publish_requests', 'vercel_project_id', 'text', 'YES', null),
    ('app_private', 'menu_publish_requests', 'vercel_team_id', 'text', 'YES', null),
    ('app_private', 'menu_publication_revisions', 'id', 'uuid', 'NO', null),
    ('app_private', 'menu_publication_revisions', 'content_hash', 'text', 'NO', null),
    ('app_private', 'menu_publication_revisions', 'snapshot_version', 'integer', 'NO', '1'),
    ('app_private', 'menu_publication_revisions', 'content_snapshot', 'jsonb', 'NO', null),
    ('app_private', 'menu_publication_revisions', 'created_by', 'uuid', 'YES', null),
    ('app_private', 'menu_publication_revisions', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_publication_revision_events', 'revision_id', 'uuid', 'NO', null),
    ('app_private', 'menu_publication_revision_events', 'change_event_id', 'bigint', 'NO', null),
    ('app_private', 'menu_publication_state', 'singleton', 'boolean', 'NO', 'true'),
    ('app_private', 'menu_publication_state', 'active_request_id', 'bigint', 'YES', null),
    ('app_private', 'menu_publication_state', 'deployed_request_id', 'bigint', 'YES', null),
    ('app_private', 'menu_publication_state', 'deployed_revision_id', 'uuid', 'YES', null),
    ('app_private', 'menu_publication_state', 'deployed_at', 'timestamp with time zone', 'YES', null),
    ('app_private', 'menu_publication_state', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_publication_state', 'deployed_evidence_event_id', 'text', 'YES', null),
    ('app_private', 'menu_publication_builds', 'deployment_id', 'text', 'NO', null),
    ('app_private', 'menu_publication_builds', 'project_id', 'text', 'NO', null),
    ('app_private', 'menu_publication_builds', 'request_id', 'bigint', 'YES', null),
    ('app_private', 'menu_publication_builds', 'revision_id', 'uuid', 'NO', null),
    ('app_private', 'menu_publication_builds', 'content_hash', 'text', 'NO', null),
    ('app_private', 'menu_publication_builds', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_publication_promotions', 'evidence_event_id', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'evidence_source', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'deployment_id', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'request_id', 'bigint', 'YES', null),
    ('app_private', 'menu_publication_promotions', 'revision_id', 'uuid', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'content_hash', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'deployment_host', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'project_id', 'text', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'team_id', 'text', 'YES', null),
    ('app_private', 'menu_publication_promotions', 'promoted_at', 'timestamp with time zone', 'NO', null),
    ('app_private', 'menu_publication_promotions', 'received_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_change_events', 'id', 'bigint', 'NO', null),
    ('app_private', 'menu_change_events', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    ('app_private', 'menu_change_events', 'changed_by', 'uuid', 'YES', null),
    ('app_private', 'menu_change_events', 'operation', 'text', 'NO', null),
    ('app_private', 'menu_change_events', 'operation_input', 'jsonb', 'NO', null),
    ('app_private', 'menu_change_events', 'result_message', 'text', 'NO', null),
    ('app_private', 'menu_change_events', 'menu_content_hash', 'text', 'YES', null),
    ('app_private', 'menu_change_events', 'publish_request_id', 'bigint', 'YES', null),
    ('menu_content', 'menu_profiles', 'id', 'text', 'NO', null),
    ('menu_content', 'menu_profiles', 'eyebrow', 'text', 'NO', null),
    ('menu_content', 'menu_profiles', 'title', 'text', 'NO', null),
    ('menu_content', 'menu_profiles', 'description', 'text', 'NO', null),
    ('menu_content', 'menu_profiles', 'info_title', 'text', 'NO', null),
    ('menu_content', 'menu_profile_facts', 'profile_id', 'text', 'NO', null),
    ('menu_content', 'menu_profile_facts', 'fact_id', 'text', 'NO', null),
    ('menu_content', 'menu_profile_facts', 'label', 'text', 'NO', null),
    ('menu_content', 'menu_profile_facts', 'value', 'text', 'NO', null),
    ('menu_content', 'menu_profile_facts', 'link_text', 'text', 'YES', null),
    ('menu_content', 'menu_profile_facts', 'link_href', 'text', 'YES', null),
    ('menu_content', 'menu_profile_facts', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_prices', 'pricing_key', 'text', 'NO', null),
    ('menu_content', 'menu_prices', 'kind', 'text', 'NO', null),
    ('menu_content', 'menu_prices', 'amount', 'integer', 'YES', null),
    ('menu_content', 'menu_price_variants', 'pricing_key', 'text', 'NO', null),
    ('menu_content', 'menu_price_variants', 'price_kind', 'text', 'NO', '''variants''::text'),
    ('menu_content', 'menu_price_variants', 'variant_id', 'text', 'NO', null),
    ('menu_content', 'menu_price_variants', 'name', 'text', 'NO', null),
    ('menu_content', 'menu_price_variants', 'amount', 'integer', 'NO', null),
    ('menu_content', 'menu_price_variants', 'available', 'boolean', 'NO', 'true'),
    ('menu_content', 'menu_price_variants', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_daily_items', 'id', 'bigint', 'NO', null),
    ('menu_content', 'menu_daily_items', 'item_id', 'text', 'NO', null),
    ('menu_content', 'menu_daily_items', 'name', 'text', 'NO', null),
    ('menu_content', 'menu_daily_items', 'description', 'text', 'YES', null),
    ('menu_content', 'menu_daily_items', 'available', 'boolean', 'NO', 'true'),
    ('menu_content', 'menu_daily_items', 'pricing_key', 'text', 'NO', null),
    ('menu_content', 'menu_daily_items', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_profile_service_settings', 'profile_id', 'text', 'NO', null),
    ('menu_content', 'menu_profile_service_settings', 'service_kind', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_sections', 'id', 'bigint', 'NO', null),
    ('menu_content', 'menu_catalog_sections', 'section_id', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_sections', 'title', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_sections', 'description', 'text', 'YES', null),
    ('menu_content', 'menu_catalog_sections', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_catalog_sections', 'presentation', 'text', 'NO', '''cards''::text'),
    ('menu_content', 'menu_catalog_items', 'id', 'bigint', 'NO', null),
    ('menu_content', 'menu_catalog_items', 'section_id', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_items', 'item_id', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_items', 'name', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_items', 'description', 'text', 'YES', null),
    ('menu_content', 'menu_catalog_items', 'available', 'boolean', 'NO', 'true'),
    ('menu_content', 'menu_catalog_items', 'pricing_key', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_items', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_catalog_item_images', 'id', 'bigint', 'NO', null),
    ('menu_content', 'menu_catalog_item_images', 'catalog_item_id', 'bigint', 'NO', null),
    ('menu_content', 'menu_catalog_item_images', 'image_path', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_item_images', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_catalog_item_options', 'catalog_item_id', 'bigint', 'NO', null),
    ('menu_content', 'menu_catalog_item_options', 'option_id', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_item_options', 'name', 'text', 'NO', null),
    ('menu_content', 'menu_catalog_item_options', 'available', 'boolean', 'NO', 'true'),
    ('menu_content', 'menu_catalog_item_options', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_grill_families', 'family_id', 'text', 'NO', null),
    ('menu_content', 'menu_grill_families', 'title', 'text', 'NO', null),
    ('menu_content', 'menu_grill_families', 'order_index', 'integer', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'id', 'bigint', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'family_id', 'text', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'item_id', 'text', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'name', 'text', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'variant_name', 'text', 'YES', null),
    ('menu_content', 'menu_grill_catalog_items', 'available', 'boolean', 'NO', 'true'),
    ('menu_content', 'menu_grill_catalog_items', 'pricing_key', 'text', 'NO', null),
    ('menu_content', 'menu_grill_catalog_items', 'order_index', 'integer', 'NO', null),
    ('public', 'staff_users', 'user_id', 'uuid', 'NO', null),
    ('public', 'staff_users', 'display_name', 'text', 'NO', null),
    ('public', 'staff_users', 'role', 'text', 'NO', null),
    ('public', 'staff_users', 'active', 'boolean', 'NO', 'true'),
    ('public', 'staff_users', 'default_availability_profile_id', 'text', 'YES', null),
    ('public', 'staff_users', 'created_at', 'timestamp with time zone', 'NO', 'now()'),
    ('public', 'staff_users', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    ('public', 'menu_availability_overlays', 'id', 'uuid', 'NO', 'gen_random_uuid()'),
    ('public', 'menu_availability_overlays', 'menu_id', 'text', 'NO', null),
    ('public', 'menu_availability_overlays', 'section_id', 'text', 'NO', null),
    ('public', 'menu_availability_overlays', 'item_id', 'text', 'NO', null),
    ('public', 'menu_availability_overlays', 'available_override', 'boolean', 'NO', null),
    ('public', 'menu_availability_overlays', 'updated_at', 'timestamp with time zone', 'NO', 'now()'),
    ('public', 'menu_availability_overlays', 'updated_by', 'uuid', 'YES', null)
),
actual_columns as (
  select
    table_schema,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema in ('app_private', 'menu_content', 'public')
)
select
  'column_shape_mismatch' as diagnostic,
  expected.table_schema,
  expected.table_name,
  expected.column_name,
  case
    when actual.column_name is null then 'missing'
    when actual.data_type <> expected.data_type then 'type_mismatch'
    when actual.is_nullable <> expected.is_nullable then 'nullability_mismatch'
    when coalesce(actual.column_default, '') <> coalesce(expected.column_default, '') then 'default_mismatch'
    else 'present'
  end as status,
  expected.data_type as expected_data_type,
  actual.data_type as actual_data_type,
  expected.is_nullable as expected_is_nullable,
  actual.is_nullable as actual_is_nullable,
  expected.column_default as expected_default,
  actual.column_default as actual_default
from expected_columns expected
left join actual_columns actual
  on actual.table_schema = expected.table_schema
 and actual.table_name = expected.table_name
 and actual.column_name = expected.column_name
where actual.column_name is null
   or actual.data_type <> expected.data_type
   or actual.is_nullable <> expected.is_nullable
   or coalesce(actual.column_default, '') <> coalesce(expected.column_default, '')
order by expected.table_schema, expected.table_name, expected.column_name;

with expected_columns (table_schema, table_name, column_name) as (
  values
    ('app_private', 'menu_publish_requests', 'id'),
    ('app_private', 'menu_publish_requests', 'requested_by'),
    ('app_private', 'menu_publish_requests', 'status'),
    ('app_private', 'menu_publish_requests', 'message'),
    ('app_private', 'menu_publish_requests', 'vercel_status_code'),
    ('app_private', 'menu_publish_requests', 'vercel_job_id'),
    ('app_private', 'menu_publish_requests', 'created_at'),
    ('app_private', 'menu_publish_requests', 'completed_at'),
    ('app_private', 'menu_publish_requests', 'updated_at'),
    ('app_private', 'menu_publish_requests', 'menu_content_hash'),
    ('app_private', 'menu_publish_requests', 'change_event_count'),
    ('app_private', 'menu_publish_requests', 'revision_id'),
    ('app_private', 'menu_publish_requests', 'expires_at'),
    ('app_private', 'menu_publish_requests', 'triggered_at'),
    ('app_private', 'menu_publish_requests', 'deployment_id'),
    ('app_private', 'menu_publish_requests', 'deployment_host'),
    ('app_private', 'menu_publish_requests', 'confirmation_event_id'),
    ('app_private', 'menu_publish_requests', 'confirmation_source'),
    ('app_private', 'menu_publish_requests', 'promoted_at'),
    ('app_private', 'menu_publish_requests', 'vercel_project_id'),
    ('app_private', 'menu_publish_requests', 'vercel_team_id'),
    ('app_private', 'menu_publication_revisions', 'id'),
    ('app_private', 'menu_publication_revisions', 'content_hash'),
    ('app_private', 'menu_publication_revisions', 'snapshot_version'),
    ('app_private', 'menu_publication_revisions', 'content_snapshot'),
    ('app_private', 'menu_publication_revisions', 'created_by'),
    ('app_private', 'menu_publication_revisions', 'created_at'),
    ('app_private', 'menu_publication_revision_events', 'revision_id'),
    ('app_private', 'menu_publication_revision_events', 'change_event_id'),
    ('app_private', 'menu_publication_state', 'singleton'),
    ('app_private', 'menu_publication_state', 'active_request_id'),
    ('app_private', 'menu_publication_state', 'deployed_request_id'),
    ('app_private', 'menu_publication_state', 'deployed_revision_id'),
    ('app_private', 'menu_publication_state', 'deployed_at'),
    ('app_private', 'menu_publication_state', 'updated_at'),
    ('app_private', 'menu_publication_state', 'deployed_evidence_event_id'),
    ('app_private', 'menu_publication_builds', 'deployment_id'),
    ('app_private', 'menu_publication_builds', 'project_id'),
    ('app_private', 'menu_publication_builds', 'request_id'),
    ('app_private', 'menu_publication_builds', 'revision_id'),
    ('app_private', 'menu_publication_builds', 'content_hash'),
    ('app_private', 'menu_publication_builds', 'created_at'),
    ('app_private', 'menu_publication_promotions', 'evidence_event_id'),
    ('app_private', 'menu_publication_promotions', 'evidence_source'),
    ('app_private', 'menu_publication_promotions', 'deployment_id'),
    ('app_private', 'menu_publication_promotions', 'request_id'),
    ('app_private', 'menu_publication_promotions', 'revision_id'),
    ('app_private', 'menu_publication_promotions', 'content_hash'),
    ('app_private', 'menu_publication_promotions', 'deployment_host'),
    ('app_private', 'menu_publication_promotions', 'project_id'),
    ('app_private', 'menu_publication_promotions', 'team_id'),
    ('app_private', 'menu_publication_promotions', 'promoted_at'),
    ('app_private', 'menu_publication_promotions', 'received_at'),
    ('app_private', 'menu_change_events', 'id'),
    ('app_private', 'menu_change_events', 'created_at'),
    ('app_private', 'menu_change_events', 'changed_by'),
    ('app_private', 'menu_change_events', 'operation'),
    ('app_private', 'menu_change_events', 'operation_input'),
    ('app_private', 'menu_change_events', 'result_message'),
    ('app_private', 'menu_change_events', 'menu_content_hash'),
    ('app_private', 'menu_change_events', 'publish_request_id'),
    ('menu_content', 'menu_profiles', 'id'),
    ('menu_content', 'menu_profiles', 'eyebrow'),
    ('menu_content', 'menu_profiles', 'title'),
    ('menu_content', 'menu_profiles', 'description'),
    ('menu_content', 'menu_profiles', 'info_title'),
    ('menu_content', 'menu_profile_facts', 'profile_id'),
    ('menu_content', 'menu_profile_facts', 'fact_id'),
    ('menu_content', 'menu_profile_facts', 'label'),
    ('menu_content', 'menu_profile_facts', 'value'),
    ('menu_content', 'menu_profile_facts', 'link_text'),
    ('menu_content', 'menu_profile_facts', 'link_href'),
    ('menu_content', 'menu_profile_facts', 'order_index'),
    ('menu_content', 'menu_prices', 'pricing_key'),
    ('menu_content', 'menu_prices', 'kind'),
    ('menu_content', 'menu_prices', 'amount'),
    ('menu_content', 'menu_price_variants', 'pricing_key'),
    ('menu_content', 'menu_price_variants', 'price_kind'),
    ('menu_content', 'menu_price_variants', 'variant_id'),
    ('menu_content', 'menu_price_variants', 'name'),
    ('menu_content', 'menu_price_variants', 'amount'),
    ('menu_content', 'menu_price_variants', 'available'),
    ('menu_content', 'menu_price_variants', 'order_index'),
    ('menu_content', 'menu_daily_items', 'id'),
    ('menu_content', 'menu_daily_items', 'item_id'),
    ('menu_content', 'menu_daily_items', 'name'),
    ('menu_content', 'menu_daily_items', 'description'),
    ('menu_content', 'menu_daily_items', 'available'),
    ('menu_content', 'menu_daily_items', 'pricing_key'),
    ('menu_content', 'menu_daily_items', 'order_index'),
    ('menu_content', 'menu_profile_service_settings', 'profile_id'),
    ('menu_content', 'menu_profile_service_settings', 'service_kind'),
    ('menu_content', 'menu_catalog_sections', 'id'),
    ('menu_content', 'menu_catalog_sections', 'section_id'),
    ('menu_content', 'menu_catalog_sections', 'title'),
    ('menu_content', 'menu_catalog_sections', 'description'),
    ('menu_content', 'menu_catalog_sections', 'order_index'),
    ('menu_content', 'menu_catalog_sections', 'presentation'),
    ('menu_content', 'menu_catalog_items', 'id'),
    ('menu_content', 'menu_catalog_items', 'section_id'),
    ('menu_content', 'menu_catalog_items', 'item_id'),
    ('menu_content', 'menu_catalog_items', 'name'),
    ('menu_content', 'menu_catalog_items', 'description'),
    ('menu_content', 'menu_catalog_items', 'available'),
    ('menu_content', 'menu_catalog_items', 'pricing_key'),
    ('menu_content', 'menu_catalog_items', 'order_index'),
    ('menu_content', 'menu_catalog_item_images', 'id'),
    ('menu_content', 'menu_catalog_item_images', 'catalog_item_id'),
    ('menu_content', 'menu_catalog_item_images', 'image_path'),
    ('menu_content', 'menu_catalog_item_images', 'order_index'),
    ('menu_content', 'menu_catalog_item_options', 'catalog_item_id'),
    ('menu_content', 'menu_catalog_item_options', 'option_id'),
    ('menu_content', 'menu_catalog_item_options', 'name'),
    ('menu_content', 'menu_catalog_item_options', 'available'),
    ('menu_content', 'menu_catalog_item_options', 'order_index'),
    ('menu_content', 'menu_grill_families', 'family_id'),
    ('menu_content', 'menu_grill_families', 'title'),
    ('menu_content', 'menu_grill_families', 'order_index'),
    ('menu_content', 'menu_grill_catalog_items', 'id'),
    ('menu_content', 'menu_grill_catalog_items', 'family_id'),
    ('menu_content', 'menu_grill_catalog_items', 'item_id'),
    ('menu_content', 'menu_grill_catalog_items', 'name'),
    ('menu_content', 'menu_grill_catalog_items', 'variant_name'),
    ('menu_content', 'menu_grill_catalog_items', 'available'),
    ('menu_content', 'menu_grill_catalog_items', 'pricing_key'),
    ('menu_content', 'menu_grill_catalog_items', 'order_index'),
    ('public', 'staff_users', 'user_id'),
    ('public', 'staff_users', 'display_name'),
    ('public', 'staff_users', 'role'),
    ('public', 'staff_users', 'active'),
    ('public', 'staff_users', 'default_availability_profile_id'),
    ('public', 'staff_users', 'created_at'),
    ('public', 'staff_users', 'updated_at'),
    ('public', 'menu_availability_overlays', 'id'),
    ('public', 'menu_availability_overlays', 'menu_id'),
    ('public', 'menu_availability_overlays', 'section_id'),
    ('public', 'menu_availability_overlays', 'item_id'),
    ('public', 'menu_availability_overlays', 'available_override'),
    ('public', 'menu_availability_overlays', 'updated_at'),
    ('public', 'menu_availability_overlays', 'updated_by')
),
project_tables (table_schema, table_name) as (
  select distinct table_schema, table_name from expected_columns
)
select
  'unexpected_project_column' as diagnostic,
  actual.table_schema,
  actual.table_name,
  actual.column_name,
  actual.data_type,
  actual.is_nullable
from information_schema.columns actual
join project_tables project_table
  on project_table.table_schema = actual.table_schema
 and project_table.table_name = actual.table_name
left join expected_columns expected
  on expected.table_schema = actual.table_schema
 and expected.table_name = actual.table_name
 and expected.column_name = actual.column_name
where expected.column_name is null
order by actual.table_schema, actual.table_name, actual.column_name;
