-- Broad read-only inventory and exposure audit for the project schemas.
-- This file does not mutate data or schema.

-- 01. Schema inventory.
select
  n.nspname as schema_name,
  'schema' as object_type,
  case
    when n.nspname in ('auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'pgbouncer') then 'do_not_touch'
    when n.nspname = 'app_private' then 'keep'
    when n.nspname = 'menu_content' then 'keep'
    when n.nspname = 'public' then 'review'
    else 'unknown'
  end as suggested_status,
  case
    when n.nspname = 'app_private' then 'Private operational CMS support objects.'
    when n.nspname = 'menu_content' then 'Project build-time structural and operational source.'
    when n.nspname = 'public' then 'Runtime availability overlay and operational CMS staff permissions.'
    else 'Supabase-managed or unrelated schema.'
  end as reason
from pg_namespace n
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname;

-- 02. Relation inventory in project-relevant schemas.
select
  n.nspname as schema_name,
  c.relname as object_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned_table'
    when 'v' then 'view'
    when 'm' then 'materialized_view'
    else c.relkind::text
  end as object_type,
  case
    when n.nspname = 'app_private' and c.relname in ('menu_publish_requests', 'menu_change_events') then 'keep'
    when n.nspname = 'menu_content' then 'keep'
    when n.nspname = 'public' and c.relname in ('staff_users', 'menu_availability_overlays') then 'keep'
    else 'review'
  end as suggested_status,
  c.reltuples::bigint as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('app_private', 'menu_content', 'public')
  and c.relkind in ('r', 'p', 'v', 'm')
order by n.nspname, c.relname;

-- 03. Documented relation drift.
with documented_relations(schema_name, object_name, object_type, status) as (
  values
    ('app_private', 'menu_publish_requests', 'table', 'active'),
    ('app_private', 'menu_change_events', 'table', 'active'),
    ('menu_content', 'menu_profiles', 'table', 'active'),
    ('menu_content', 'menu_profile_facts', 'table', 'active'),
    ('menu_content', 'menu_prices', 'table', 'active'),
    ('menu_content', 'menu_price_variants', 'table', 'active'),
    ('menu_content', 'menu_daily_items', 'table', 'active'),
    ('menu_content', 'menu_profile_service_settings', 'table', 'active'),
    ('menu_content', 'menu_catalog_sections', 'table', 'active'),
    ('menu_content', 'menu_catalog_items', 'table', 'active'),
    ('menu_content', 'menu_catalog_item_images', 'table', 'active'),
    ('menu_content', 'menu_catalog_item_options', 'table', 'active'),
    ('menu_content', 'menu_grill_families', 'table', 'active'),
    ('menu_content', 'menu_grill_catalog_items', 'table', 'active'),
    ('public', 'staff_users', 'table', 'active'),
    ('public', 'menu_availability_overlays', 'table', 'active')
),
observed_relations as (
  select
    n.nspname as schema_name,
    c.relname as object_name,
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      else c.relkind::text
    end as object_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app_private', 'menu_content', 'public')
    and c.relkind in ('r', 'p', 'v', 'm')
)
select
  o.schema_name,
  o.object_name,
  o.object_type,
  case
    when d.status = 'active' then 'keep'
    when d.object_name is null then 'unknown'
    else 'review'
  end as suggested_status,
  case
    when d.status = 'active' then 'Documented active project relation.'
    else 'Relation is not documented by this project audit.'
  end as reason
from observed_relations o
left join documented_relations d
  on d.schema_name = o.schema_name
 and d.object_name = o.object_name
 and d.object_type = o.object_type
order by o.schema_name, o.object_name;

-- 04. Grants visible to client-facing roles.
select
  g.table_schema,
  g.table_name,
  g.grantee,
  g.privilege_type,
  case
    when g.table_schema in ('app_private', 'menu_content') and lower(g.grantee) in ('anon', 'authenticated', 'public') then 'risk'
    when g.table_schema = 'public' and g.table_name = 'menu_availability_overlays' and lower(g.grantee) in ('anon', 'authenticated') and g.privilege_type = 'SELECT' then 'risk'
    when g.table_schema = 'public' and g.table_name = 'menu_availability_overlays' and lower(g.grantee) = 'authenticated' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE') then 'risk'
    when g.table_schema = 'public' and g.table_name = 'staff_users' and lower(g.grantee) = 'authenticated' and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE') then 'keep'
    when g.table_schema = 'public' and g.table_name = 'staff_users' and lower(g.grantee) in ('anon', 'public') then 'risk'
    when lower(g.grantee) in ('anon', 'authenticated', 'public') then 'review'
    else 'review'
  end as suggested_status
from information_schema.table_privileges g
where g.table_schema in ('app_private', 'menu_content', 'public')
  and lower(g.grantee) in ('anon', 'authenticated', 'public')
order by g.table_schema, g.table_name, g.grantee, g.privilege_type;

-- 05. Public overlay column grants.
with expected_overlay_select_columns(column_name) as (
  values
    ('menu_id'),
    ('section_id'),
    ('item_id'),
    ('available_override')
),
client_roles(grantee) as (
  values
    ('anon'),
    ('authenticated')
),
actual_column_grants as (
  select
    lower(grantee) as grantee,
    column_name
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'menu_availability_overlays'
    and privilege_type = 'SELECT'
    and lower(grantee) in ('anon', 'authenticated')
)
select
  role.grantee,
  expected.column_name,
  case
    when actual.column_name is null then 'missing'
    else 'present'
  end as status,
  case
    when actual.column_name is null then 'risk'
    else 'keep'
  end as suggested_status
from client_roles role
cross join expected_overlay_select_columns expected
left join actual_column_grants actual
  on actual.grantee = role.grantee
 and actual.column_name = expected.column_name
order by role.grantee, expected.column_name;

select
  lower(grantee) as grantee,
  column_name,
  'risk' as suggested_status,
  'Unexpected public overlay column SELECT grant.' as reason
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'menu_availability_overlays'
  and privilege_type = 'SELECT'
  and lower(grantee) in ('anon', 'authenticated')
  and column_name not in (
    'menu_id',
    'section_id',
    'item_id',
    'available_override'
  )
order by grantee, column_name;

-- 06. RLS status for public project tables.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  case
    when n.nspname = 'app_private' and c.relname in ('menu_publish_requests', 'menu_change_events') and c.relrowsecurity then 'keep'
    when n.nspname = 'public' and c.relname in ('staff_users', 'menu_availability_overlays') and c.relrowsecurity then 'keep'
    when n.nspname = 'public' then 'review'
    else 'keep'
  end as suggested_status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('app_private', 'menu_content', 'public')
  and c.relkind = 'r'
order by n.nspname, c.relname;

-- 07. Policies in project-relevant schemas.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname in ('app_private', 'menu_content', 'public')
order by schemaname, tablename, policyname;

-- 07b. Required public policies after the prelaunch baseline.
with expected_policies (table_name, policy_name, command) as (
  values
    ('staff_users', 'Staff users can read permitted rows', 'SELECT'),
    ('staff_users', 'Admins can insert staff users', 'INSERT'),
    ('staff_users', 'Admins can update staff users', 'UPDATE'),
    ('menu_availability_overlays', 'Menu availability overlays are publicly readable', 'SELECT')
),
actual_policies as (
  select
    tablename as table_name,
    policyname as policy_name,
    cmd as command
  from pg_policies
  where schemaname = 'public'
)
select
  expected.table_name,
  expected.policy_name,
  expected.command,
  case
    when actual.policy_name is null then 'missing'
    else 'present'
  end as status
from expected_policies expected
left join actual_policies actual
  on actual.table_name = expected.table_name
 and actual.policy_name = expected.policy_name
 and actual.command = expected.command
order by expected.table_name, expected.policy_name;

-- 08. Staff permission and operational edit functions.
with expected_functions (function_name, identity_arguments, expectation) as (
  values
    ('is_active_staff', '', 'active staff membership check'),
    ('can_edit_availability', 'target_profile_id text', 'operator availability edit check'),
    ('can_edit_menu_content', '', 'build-time menu edit role check'),
    ('can_manage_staff', '', 'staff administration role check'),
    ('can_publish_menu', '', 'build-time publish role check'),
    ('get_admin_operational_state', '', 'operational admin read RPC'),
    ('menu_availability_target_exists', 'target_menu_id text, target_section_id text, target_item_id text', 'availability target universe validation'),
    ('set_menu_availability_overlay', 'menu_id text, section_id text, item_id text, available_override boolean', 'availability overlay upsert RPC'),
    ('clear_menu_availability_overlay', 'menu_id text, section_id text, item_id text', 'availability overlay clear RPC'),
    ('set_menu_availability_overlays', 'targets jsonb, available_override boolean', 'availability overlay batch upsert RPC'),
    ('clear_menu_availability_overlays', 'targets jsonb', 'availability overlay batch clear RPC'),
    ('set_profile_service_kind', 'profile_id text, service_kind text', 'active service edit RPC'),
    ('set_daily_menu', 'regular_name text, regular_description text, vegetarian_name text, vegetarian_description text', 'daily menu edit RPC'),
    ('set_global_fixed_price', 'pricing_key text, amount integer', 'fixed price edit RPC'),
    ('set_global_price_variant', 'pricing_key text, variant_id text, amount integer', 'variant price edit RPC'),
    ('add_catalog_item', 'section_id text, item_id text, name text, description text, amount integer', 'fixed menu item add RPC'),
    ('delete_catalog_item', 'section_id text, item_id text', 'fixed menu item delete RPC'),
    ('update_catalog_item', 'section_id text, item_id text, name text, description text', 'fixed menu item text edit RPC'),
    ('add_catalog_item_option', 'section_id text, item_id text, option_id text, name text', 'fixed menu option add RPC'),
    ('delete_catalog_item_option', 'section_id text, item_id text, option_id text', 'fixed menu option delete RPC'),
    ('update_catalog_item_option', 'section_id text, item_id text, option_id text, name text', 'fixed menu option text edit RPC'),
    ('add_grill_product', 'family_id text, title text, item_id text, variant_name text, amount integer', 'grill product add RPC'),
    ('delete_grill_product', 'family_id text', 'grill product delete RPC'),
    ('update_grill_product', 'family_id text, title text', 'grill product text edit RPC'),
    ('add_grill_item', 'family_id text, item_id text, name text, variant_name text, amount integer', 'grill option add RPC'),
    ('delete_grill_item', 'item_id text', 'grill option delete RPC'),
    ('update_grill_item', 'item_id text, name text, variant_name text', 'grill option text edit RPC'),
    ('reserve_menu_publish_request', 'user_id uuid, cooldown_seconds integer', 'private publish reservation helper'),
    ('complete_menu_publish_request', 'request_id bigint, publish_status text, publish_message text, vercel_status_code integer, vercel_job_id text', 'private publish completion helper')
),
actual_functions as (
  select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select
  expected.function_name,
  expected.identity_arguments,
  case
    when actual.function_name is null then 'missing'
    else 'present'
  end as status,
  expected.expectation
from expected_functions expected
left join actual_functions actual
  on actual.function_name = expected.function_name
 and actual.identity_arguments = expected.identity_arguments
order by expected.function_name;

-- 08b. Security definer functions still executable from exposed API schemas.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  'risk' as suggested_status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef = true
  and (
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
  and (
    (
      current_setting('pgrst.db_schemas', true) is null
      and n.nspname = 'public'
    )
    or n.nspname = any (
      array(
        select btrim(exposed_schema.schema_name)
        from unnest(string_to_array(current_setting('pgrst.db_schemas', true), ',')) as exposed_schema(schema_name)
      )
    )
  )
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 09. Publish helper execute privileges.
with expected_publish_helper_grants(function_name, identity_arguments) as (
  values
    ('reserve_menu_publish_request', 'user_id uuid, cooldown_seconds integer'),
    ('complete_menu_publish_request', 'request_id bigint, publish_status text, publish_message text, vercel_status_code integer, vercel_job_id text')
),
actual_functions as (
  select
    p.oid,
    p.proacl,
    p.proowner,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
actual_privileges as (
  select
    actual.oid,
    coalesce(grantee.rolname, 'PUBLIC') as grantee,
    acl.privilege_type
  from actual_functions actual
  cross join lateral aclexplode(coalesce(actual.proacl, acldefault('f', actual.proowner))) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
)
select
  expected.function_name,
  expected.identity_arguments,
  coalesce(bool_or(privilege.grantee = 'service_role' and privilege.privilege_type = 'EXECUTE'), false) as service_role_can_execute,
  coalesce(bool_or(privilege.grantee = 'anon' and privilege.privilege_type = 'EXECUTE'), false) as anon_can_execute,
  coalesce(bool_or(privilege.grantee = 'authenticated' and privilege.privilege_type = 'EXECUTE'), false) as authenticated_can_execute,
  coalesce(bool_or(privilege.grantee = 'PUBLIC' and privilege.privilege_type = 'EXECUTE'), false) as public_can_execute,
  case
    when actual.oid is null then 'missing'
    when coalesce(bool_or(privilege.grantee = 'service_role' and privilege.privilege_type = 'EXECUTE'), false)
      and not coalesce(bool_or(privilege.grantee = 'anon' and privilege.privilege_type = 'EXECUTE'), false)
      and not coalesce(bool_or(privilege.grantee = 'authenticated' and privilege.privilege_type = 'EXECUTE'), false)
      and not coalesce(bool_or(privilege.grantee = 'PUBLIC' and privilege.privilege_type = 'EXECUTE'), false) then 'keep'
    else 'risk'
  end as suggested_status
from expected_publish_helper_grants expected
left join actual_functions actual
  on actual.function_name = expected.function_name
 and actual.identity_arguments = expected.identity_arguments
left join actual_privileges privilege
  on privilege.oid = actual.oid
group by expected.function_name, expected.identity_arguments, actual.oid
order by expected.function_name;

-- 10. Availability overlay targets that do not match possible menu targets.
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
select
  overlay.menu_id,
  overlay.section_id,
  overlay.item_id,
  'risk' as suggested_status,
  'Availability overlay row does not match a possible menu target.' as reason
from public.menu_availability_overlays overlay
where not exists (
  select 1
  from possible_targets target
  where target.menu_id = overlay.menu_id
    and target.section_id = overlay.section_id
    and target.item_id = overlay.item_id
)
order by overlay.menu_id, overlay.section_id, overlay.item_id;

-- 11. Image paths with invalid format in the active catalog.
select
  'menu_catalog_item_images' as object_name,
  item.section_id,
  null::text as context_id,
  item.item_id,
  image.image_path
from menu_content.menu_catalog_item_images image
join menu_content.menu_catalog_items item
  on item.id = image.catalog_item_id
where not (
  image.image_path like '/uploads/%'
  and image.image_path not like '%//%'
  and image.image_path not like '%\%'
  and image.image_path not like '%?%'
  and image.image_path not like '%#%'
  and image.image_path !~ '(^|/)\.\.?(/|$)'
  and lower(image.image_path) ~ '\.(avif|jpeg|jpg|png|svg|webp)$'
);

-- 11b. Image order must be contiguous from zero for every catalog item.
select
  item.section_id,
  item.item_id,
  min(image.order_index) as minimum_order,
  max(image.order_index) as maximum_order,
  count(*) as image_count
from menu_content.menu_catalog_item_images image
join menu_content.menu_catalog_items item
  on item.id = image.catalog_item_id
group by item.id, item.section_id, item.item_id
having min(image.order_index) <> 0
  or max(image.order_index) + 1 <> count(*);

-- 11c. Legacy item image columns must remain removed.
select
  table_name,
  column_name
from information_schema.columns
where table_schema = 'menu_content'
  and table_name in (
    'menu_catalog_items',
    'menu_daily_items',
    'menu_grill_catalog_items'
  )
  and column_name = 'image_path';

-- 12. Build-time availability must stay normalized to true.
select
  table_name,
  false_count,
  'risk' as suggested_status,
  'Build-time available columns must remain true; runtime unavailability belongs in public.menu_availability_overlays.' as reason
from (
  select 'menu_daily_items' as table_name, count(*)::integer as false_count
  from menu_content.menu_daily_items
  where available is distinct from true

  union all

  select 'menu_price_variants', count(*)::integer
  from menu_content.menu_price_variants
  where available is distinct from true

  union all

  select 'menu_catalog_items', count(*)::integer
  from menu_content.menu_catalog_items
  where available is distinct from true

  union all

  select 'menu_catalog_item_options', count(*)::integer
  from menu_content.menu_catalog_item_options
  where available is distinct from true

  union all

  select 'menu_grill_catalog_items', count(*)::integer
  from menu_content.menu_grill_catalog_items
  where available is distinct from true
) availability_counts
where false_count > 0
order by table_name;

-- 13. Exact project function security and volatility shape.
with expected_functions (schema_name, function_name, identity_arguments, security_definer, volatility, expectation) as (
  values
    ('app_private', 'add_catalog_item', 'section_id text, item_id text, name text, description text, amount integer', true, 'v', 'privileged catalog item add implementation'),
    ('app_private', 'add_catalog_item_option', 'section_id text, item_id text, option_id text, name text', true, 'v', 'privileged catalog option add implementation'),
    ('app_private', 'add_grill_item', 'family_id text, item_id text, name text, variant_name text, amount integer', true, 'v', 'privileged grill option add implementation'),
    ('app_private', 'add_grill_product', 'family_id text, title text, item_id text, variant_name text, amount integer', true, 'v', 'privileged grill product add implementation'),
    ('app_private', 'can_edit_availability', 'target_profile_id text', true, 's', 'privileged availability permission check'),
    ('app_private', 'can_edit_menu_content', '', true, 's', 'privileged content edit permission check'),
    ('app_private', 'can_manage_staff', '', true, 's', 'privileged staff management permission check'),
    ('app_private', 'can_publish_menu', '', true, 's', 'privileged publish permission check'),
    ('app_private', 'clear_menu_availability_overlay', 'menu_id text, section_id text, item_id text', true, 'v', 'privileged overlay clear implementation'),
    ('app_private', 'clear_menu_availability_overlays', 'targets jsonb', true, 'v', 'privileged overlay batch clear implementation'),
    ('app_private', 'delete_catalog_item', 'section_id text, item_id text', true, 'v', 'privileged catalog item delete implementation'),
    ('app_private', 'delete_catalog_item_option', 'section_id text, item_id text, option_id text', true, 'v', 'privileged catalog option delete implementation'),
    ('app_private', 'delete_grill_item', 'item_id text', true, 'v', 'privileged grill option delete implementation'),
    ('app_private', 'delete_grill_product', 'family_id text', true, 'v', 'privileged grill product delete implementation'),
    ('app_private', 'generate_admin_id', 'prefix text', true, 'v', 'privileged technical id generator'),
    ('app_private', 'get_admin_catalog_editor_state', '', true, 's', 'privileged catalog editor state reader'),
    ('app_private', 'get_admin_grill_editor_state', '', true, 's', 'privileged grill editor state reader'),
    ('app_private', 'get_admin_operational_state', '', true, 's', 'privileged admin state reader'),
    ('app_private', 'get_menu_publication_content_hash', '', true, 's', 'privileged publication content hash reader'),
    ('app_private', 'get_menu_publication_state', '', true, 's', 'privileged publication state reader'),
    ('app_private', 'is_active_staff', '', true, 's', 'privileged active staff check'),
    ('app_private', 'menu_availability_target_exists', 'target_menu_id text, target_section_id text, target_item_id text', true, 's', 'privileged overlay target validator'),
    ('app_private', 'normalize_visible_name', 'value text', false, 'i', 'immutable visible-name normalizer'),
    ('app_private', 'record_menu_change_event', 'change_operation text, operation_input jsonb, result_message text', true, 'v', 'privileged menu change audit writer'),
    ('app_private', 'set_daily_menu', 'regular_name text, regular_description text, vegetarian_name text, vegetarian_description text', true, 'v', 'privileged daily menu edit implementation'),
    ('app_private', 'set_global_fixed_price', 'pricing_key text, amount integer', true, 'v', 'privileged fixed price edit implementation'),
    ('app_private', 'set_global_price_variant', 'pricing_key text, variant_id text, amount integer', true, 'v', 'privileged variant price edit implementation'),
    ('app_private', 'set_menu_availability_overlay', 'menu_id text, section_id text, item_id text, available_override boolean', true, 'v', 'privileged overlay set implementation'),
    ('app_private', 'set_menu_availability_overlays', 'targets jsonb, available_override boolean', true, 'v', 'privileged overlay batch set implementation'),
    ('app_private', 'set_profile_service_kind', 'profile_id text, service_kind text', true, 'v', 'privileged active service edit implementation'),
    ('app_private', 'update_catalog_item', 'section_id text, item_id text, name text, description text', true, 'v', 'privileged catalog item update implementation'),
    ('app_private', 'update_catalog_item_option', 'section_id text, item_id text, option_id text, name text', true, 'v', 'privileged catalog option update implementation'),
    ('app_private', 'update_grill_item', 'item_id text, name text, variant_name text', true, 'v', 'privileged grill option update implementation'),
    ('app_private', 'update_grill_product', 'family_id text, title text', true, 'v', 'privileged grill product update implementation'),
    ('public', 'add_catalog_item', 'section_id text, item_id text, name text, description text, amount integer', false, 'v', 'public catalog item add wrapper'),
    ('public', 'add_catalog_item_option', 'section_id text, item_id text, option_id text, name text', false, 'v', 'public catalog option add wrapper'),
    ('public', 'add_grill_item', 'family_id text, item_id text, name text, variant_name text, amount integer', false, 'v', 'public grill option add wrapper'),
    ('public', 'add_grill_product', 'family_id text, title text, item_id text, variant_name text, amount integer', false, 'v', 'public grill product add wrapper'),
    ('public', 'can_edit_availability', 'target_profile_id text', false, 's', 'public availability permission wrapper'),
    ('public', 'can_edit_menu_content', '', false, 's', 'public content edit permission wrapper'),
    ('public', 'can_manage_staff', '', false, 's', 'public staff management permission wrapper'),
    ('public', 'can_publish_menu', '', false, 's', 'public publish permission wrapper'),
    ('public', 'clear_menu_availability_overlay', 'menu_id text, section_id text, item_id text', false, 'v', 'public overlay clear wrapper'),
    ('public', 'clear_menu_availability_overlays', 'targets jsonb', false, 'v', 'public overlay batch clear wrapper'),
    ('public', 'complete_menu_publish_request', 'request_id bigint, publish_status text, publish_message text, vercel_status_code integer, vercel_job_id text', true, 'v', 'service-role-only publish completion helper'),
    ('public', 'delete_catalog_item', 'section_id text, item_id text', false, 'v', 'public catalog item delete wrapper'),
    ('public', 'delete_catalog_item_option', 'section_id text, item_id text, option_id text', false, 'v', 'public catalog option delete wrapper'),
    ('public', 'delete_grill_item', 'item_id text', false, 'v', 'public grill option delete wrapper'),
    ('public', 'delete_grill_product', 'family_id text', false, 'v', 'public grill product delete wrapper'),
    ('public', 'get_admin_operational_state', '', false, 's', 'public admin state wrapper'),
    ('public', 'is_active_staff', '', false, 's', 'public active staff wrapper'),
    ('public', 'menu_availability_target_exists', 'target_menu_id text, target_section_id text, target_item_id text', false, 's', 'public overlay target validation wrapper'),
    ('public', 'reserve_menu_publish_request', 'user_id uuid, cooldown_seconds integer', true, 'v', 'service-role-only publish reservation helper'),
    ('public', 'set_daily_menu', 'regular_name text, regular_description text, vegetarian_name text, vegetarian_description text', false, 'v', 'public daily menu edit wrapper'),
    ('public', 'set_global_fixed_price', 'pricing_key text, amount integer', false, 'v', 'public fixed price edit wrapper'),
    ('public', 'set_global_price_variant', 'pricing_key text, variant_id text, amount integer', false, 'v', 'public variant price edit wrapper'),
    ('public', 'set_menu_availability_overlay', 'menu_id text, section_id text, item_id text, available_override boolean', false, 'v', 'public overlay set wrapper'),
    ('public', 'set_menu_availability_overlays', 'targets jsonb, available_override boolean', false, 'v', 'public overlay batch set wrapper'),
    ('public', 'set_profile_service_kind', 'profile_id text, service_kind text', false, 'v', 'public active service edit wrapper'),
    ('public', 'set_staff_users_updated_at', '', false, 'v', 'staff updated_at trigger function'),
    ('public', 'update_catalog_item', 'section_id text, item_id text, name text, description text', false, 'v', 'public catalog item update wrapper'),
    ('public', 'update_catalog_item_option', 'section_id text, item_id text, option_id text, name text', false, 'v', 'public catalog option update wrapper'),
    ('public', 'update_grill_item', 'item_id text, name text, variant_name text', false, 'v', 'public grill option update wrapper'),
    ('public', 'update_grill_product', 'family_id text, title text', false, 'v', 'public grill product update wrapper')
),
actual_functions as (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    p.provolatile as volatility
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app_private', 'public')
)
select
  expected.schema_name,
  expected.function_name,
  expected.identity_arguments,
  case
    when actual.function_name is null then 'missing'
    when actual.security_definer <> expected.security_definer then 'security_mismatch'
    when actual.volatility <> expected.volatility then 'volatility_mismatch'
    else 'present'
  end as status,
  expected.security_definer as expected_security_definer,
  actual.security_definer as actual_security_definer,
  expected.volatility as expected_volatility,
  actual.volatility as actual_volatility,
  expected.expectation
from expected_functions expected
left join actual_functions actual
  on actual.schema_name = expected.schema_name
 and actual.function_name = expected.function_name
 and actual.identity_arguments = expected.identity_arguments
where actual.function_name is null
   or actual.security_definer <> expected.security_definer
   or actual.volatility <> expected.volatility
order by expected.schema_name, expected.function_name, expected.identity_arguments;

-- 14. Unexpected project functions in public or app_private.
with expected_functions (schema_name, function_name, identity_arguments) as (
  values
    ('app_private', 'add_catalog_item', 'section_id text, item_id text, name text, description text, amount integer'),
    ('app_private', 'add_catalog_item_option', 'section_id text, item_id text, option_id text, name text'),
    ('app_private', 'add_grill_item', 'family_id text, item_id text, name text, variant_name text, amount integer'),
    ('app_private', 'add_grill_product', 'family_id text, title text, item_id text, variant_name text, amount integer'),
    ('app_private', 'can_edit_availability', 'target_profile_id text'),
    ('app_private', 'can_edit_menu_content', ''),
    ('app_private', 'can_manage_staff', ''),
    ('app_private', 'can_publish_menu', ''),
    ('app_private', 'clear_menu_availability_overlay', 'menu_id text, section_id text, item_id text'),
    ('app_private', 'clear_menu_availability_overlays', 'targets jsonb'),
    ('app_private', 'delete_catalog_item', 'section_id text, item_id text'),
    ('app_private', 'delete_catalog_item_option', 'section_id text, item_id text, option_id text'),
    ('app_private', 'delete_grill_item', 'item_id text'),
    ('app_private', 'delete_grill_product', 'family_id text'),
    ('app_private', 'generate_admin_id', 'prefix text'),
    ('app_private', 'get_admin_catalog_editor_state', ''),
    ('app_private', 'get_admin_grill_editor_state', ''),
    ('app_private', 'get_admin_operational_state', ''),
    ('app_private', 'get_menu_publication_content_hash', ''),
    ('app_private', 'get_menu_publication_state', ''),
    ('app_private', 'is_active_staff', ''),
    ('app_private', 'menu_availability_target_exists', 'target_menu_id text, target_section_id text, target_item_id text'),
    ('app_private', 'normalize_visible_name', 'value text'),
    ('app_private', 'record_menu_change_event', 'change_operation text, operation_input jsonb, result_message text'),
    ('app_private', 'set_daily_menu', 'regular_name text, regular_description text, vegetarian_name text, vegetarian_description text'),
    ('app_private', 'set_global_fixed_price', 'pricing_key text, amount integer'),
    ('app_private', 'set_global_price_variant', 'pricing_key text, variant_id text, amount integer'),
    ('app_private', 'set_menu_availability_overlay', 'menu_id text, section_id text, item_id text, available_override boolean'),
    ('app_private', 'set_menu_availability_overlays', 'targets jsonb, available_override boolean'),
    ('app_private', 'set_profile_service_kind', 'profile_id text, service_kind text'),
    ('app_private', 'update_catalog_item', 'section_id text, item_id text, name text, description text'),
    ('app_private', 'update_catalog_item_option', 'section_id text, item_id text, option_id text, name text'),
    ('app_private', 'update_grill_item', 'item_id text, name text, variant_name text'),
    ('app_private', 'update_grill_product', 'family_id text, title text'),
    ('public', 'add_catalog_item', 'section_id text, item_id text, name text, description text, amount integer'),
    ('public', 'add_catalog_item_option', 'section_id text, item_id text, option_id text, name text'),
    ('public', 'add_grill_item', 'family_id text, item_id text, name text, variant_name text, amount integer'),
    ('public', 'add_grill_product', 'family_id text, title text, item_id text, variant_name text, amount integer'),
    ('public', 'can_edit_availability', 'target_profile_id text'),
    ('public', 'can_edit_menu_content', ''),
    ('public', 'can_manage_staff', ''),
    ('public', 'can_publish_menu', ''),
    ('public', 'clear_menu_availability_overlay', 'menu_id text, section_id text, item_id text'),
    ('public', 'clear_menu_availability_overlays', 'targets jsonb'),
    ('public', 'complete_menu_publish_request', 'request_id bigint, publish_status text, publish_message text, vercel_status_code integer, vercel_job_id text'),
    ('public', 'delete_catalog_item', 'section_id text, item_id text'),
    ('public', 'delete_catalog_item_option', 'section_id text, item_id text, option_id text'),
    ('public', 'delete_grill_item', 'item_id text'),
    ('public', 'delete_grill_product', 'family_id text'),
    ('public', 'get_admin_operational_state', ''),
    ('public', 'is_active_staff', ''),
    ('public', 'menu_availability_target_exists', 'target_menu_id text, target_section_id text, target_item_id text'),
    ('public', 'reserve_menu_publish_request', 'user_id uuid, cooldown_seconds integer'),
    ('public', 'set_daily_menu', 'regular_name text, regular_description text, vegetarian_name text, vegetarian_description text'),
    ('public', 'set_global_fixed_price', 'pricing_key text, amount integer'),
    ('public', 'set_global_price_variant', 'pricing_key text, variant_id text, amount integer'),
    ('public', 'set_menu_availability_overlay', 'menu_id text, section_id text, item_id text, available_override boolean'),
    ('public', 'set_menu_availability_overlays', 'targets jsonb, available_override boolean'),
    ('public', 'set_profile_service_kind', 'profile_id text, service_kind text'),
    ('public', 'set_staff_users_updated_at', ''),
    ('public', 'update_catalog_item', 'section_id text, item_id text, name text, description text'),
    ('public', 'update_catalog_item_option', 'section_id text, item_id text, option_id text, name text'),
    ('public', 'update_grill_item', 'item_id text, name text, variant_name text'),
    ('public', 'update_grill_product', 'family_id text, title text')
)
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  'review' as suggested_status,
  'Function is not part of the documented active project surface.' as reason
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join expected_functions expected
  on expected.schema_name = n.nspname
 and expected.function_name = p.proname
 and expected.identity_arguments = pg_get_function_identity_arguments(p.oid)
where n.nspname in ('app_private', 'public')
  and expected.function_name is null
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 15. Required trigger for staff_users.updated_at.
with expected_triggers (event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement) as (
  values
    ('public', 'staff_users', 'set_staff_users_updated_at', 'BEFORE', 'UPDATE', 'EXECUTE FUNCTION set_staff_users_updated_at()')
),
actual_triggers as (
  select
    event_object_schema,
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation,
    action_statement
  from information_schema.triggers
  where event_object_schema in ('public', 'app_private', 'menu_content')
)
select
  expected.event_object_schema,
  expected.event_object_table,
  expected.trigger_name,
  case
    when actual.trigger_name is null then 'missing'
    when actual.action_timing <> expected.action_timing then 'timing_mismatch'
    when actual.event_manipulation <> expected.event_manipulation then 'event_mismatch'
    when actual.action_statement <> expected.action_statement then 'statement_mismatch'
    else 'present'
  end as status,
  expected.action_statement as expected_statement,
  actual.action_statement as actual_statement
from expected_triggers expected
left join actual_triggers actual
  on actual.event_object_schema = expected.event_object_schema
 and actual.event_object_table = expected.event_object_table
 and actual.trigger_name = expected.trigger_name
where actual.trigger_name is null
   or actual.action_timing <> expected.action_timing
   or actual.event_manipulation <> expected.event_manipulation
   or actual.action_statement <> expected.action_statement;

select
  trigger_schema,
  event_object_table,
  trigger_name,
  'review' as suggested_status,
  'Unexpected project trigger.' as reason
from (
  select
    event_object_schema as trigger_schema,
    event_object_table,
    trigger_name
  from information_schema.triggers
  where event_object_schema in ('public', 'app_private', 'menu_content')
) actual
where not (
  trigger_schema = 'public'
  and event_object_table = 'staff_users'
  and trigger_name = 'set_staff_users_updated_at'
)
order by trigger_schema, event_object_table, trigger_name;

-- 16. Canonical Supabase migration history must be a known complete handoff state.
with actual_history as (
  select coalesce(array_agg(version order by version), array[]::text[]) as versions
  from supabase_migrations.schema_migrations
),
allowed_history(label, versions) as (
  values
    (
      'pre_squash_remote',
      array[
        '20260606235844',
        '20260630203051',
        '20260630204047',
        '20260701001506',
        '20260701062401',
        '20260701145810',
        '20260701151758',
        '20260706113430',
        '20260706114205',
        '20260706162000',
        '20260723230712'
      ]::text[]
    ),
    (
      'handoff_baseline',
      array[
        '20260707000000',
        '20260723230712'
      ]::text[]
    )
)
select
  array_to_string(actual_history.versions, ',') as migration_versions,
  'risk' as suggested_status,
  'Unexpected Supabase migration history for the handoff model.' as reason
from actual_history
where not exists (
  select 1
  from allowed_history allowed
  where allowed.versions = actual_history.versions
);

-- 17. Basic schema usage grants for protected schemas.
select
  protected_schema.schema_name,
  role_name as grantee,
  'USAGE' as privilege_type,
  'risk' as suggested_status,
  'Unexpected client-facing schema privilege.' as reason
from (values ('menu_content')) protected_schema(schema_name)
cross join (values ('anon'), ('authenticated'), ('public')) checked_role(role_name)
where has_schema_privilege(role_name, protected_schema.schema_name, 'USAGE')
union all
select
  protected_schema.schema_name,
  role_name as grantee,
  'USAGE' as privilege_type,
  'risk' as suggested_status,
  'Unexpected anon/public privilege on app_private schema.' as reason
from (values ('app_private')) protected_schema(schema_name)
cross join (values ('anon'), ('public')) checked_role(role_name)
where has_schema_privilege(role_name, protected_schema.schema_name, 'USAGE')
order by schema_name, grantee, privilege_type;

-- 18. Private publish request sequence must not be client-facing.
select
  object_schema,
  object_name,
  grantee,
  privilege_type,
  'risk' as suggested_status,
  'Unexpected client-facing sequence privilege.' as reason
from information_schema.usage_privileges
where object_schema = 'app_private'
  and object_name in ('menu_publish_requests_id_seq', 'menu_change_events_id_seq')
  and lower(grantee) in ('anon', 'authenticated', 'public')
order by grantee, privilege_type;

-- 19. The build login role must retain its exact least-privilege boundary.
with role_state as (
  select
    rolname,
    rolsuper,
    rolinherit,
    rolcreaterole,
    rolcreatedb,
    rolreplication,
    rolbypassrls,
    rolconnlimit
  from pg_roles
  where rolname = 'menu_build_ci'
)
select
  'menu_build_ci_role_attributes' as diagnostic,
  role_state.*,
  'risk' as suggested_status,
  'Build role is missing or has an unexpected capability.' as reason
from (values (1)) expected(singleton)
left join role_state on true
where role_state.rolname is null
   or role_state.rolsuper
   or role_state.rolinherit
   or role_state.rolcreaterole
   or role_state.rolcreatedb
   or role_state.rolreplication
   or role_state.rolbypassrls
   or role_state.rolconnlimit <> 3;

with expected_tables (table_name) as (
  values
    ('menu_profiles'),
    ('menu_profile_facts'),
    ('menu_prices'),
    ('menu_price_variants'),
    ('menu_daily_items'),
    ('menu_profile_service_settings'),
    ('menu_catalog_sections'),
    ('menu_catalog_items'),
    ('menu_catalog_item_images'),
    ('menu_catalog_item_options'),
    ('menu_grill_families'),
    ('menu_grill_catalog_items')
)
select
  'menu_build_ci_missing_select' as diagnostic,
  expected.table_name,
  'risk' as suggested_status,
  'Build role is missing required menu table SELECT.' as reason
from expected_tables expected
where not has_table_privilege(
  'menu_build_ci',
  format('menu_content.%I', expected.table_name),
  'select'
)
order by expected.table_name;

select
  'menu_build_ci_excess_privilege' as diagnostic,
  capability,
  'risk' as suggested_status,
  'Build role exceeds its documented read-only boundary.' as reason
from (
  values
    (
      'menu_profiles_insert',
      has_table_privilege('menu_build_ci', 'menu_content.menu_profiles', 'insert')
    ),
    (
      'menu_profiles_update',
      has_table_privilege('menu_build_ci', 'menu_content.menu_profiles', 'update')
    ),
    (
      'menu_profiles_delete',
      has_table_privilege('menu_build_ci', 'menu_content.menu_profiles', 'delete')
    ),
    (
      'staff_users_select',
      has_table_privilege('menu_build_ci', 'public.staff_users', 'select')
    ),
    (
      'auth_users_select',
      has_table_privilege('menu_build_ci', 'auth.users', 'select')
    ),
    (
      'private_publish_requests_select',
      has_table_privilege('menu_build_ci', 'app_private.menu_publish_requests', 'select')
    ),
    (
      'menu_content_create',
      has_schema_privilege('menu_build_ci', 'menu_content', 'create')
    ),
    (
      'public_create',
      has_schema_privilege('menu_build_ci', 'public', 'create')
    ),
    (
      'app_private_create',
      has_schema_privilege('menu_build_ci', 'app_private', 'create')
    )
) checks(capability, is_granted)
where is_granted
union all
select
  'menu_build_ci_missing_fingerprint_execute',
  'publication_hash_execute',
  'risk',
  'Build role cannot execute the required publication hash function.'
where not has_function_privilege(
  'menu_build_ci',
  'app_private.get_menu_publication_content_hash()',
  'execute'
)
order by capability;
