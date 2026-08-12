-- Immutable publication revisions close the time-of-check/time-of-use gap
-- between an operator requesting a publication and Vercel reading menu data.

create or replace function app_private.get_menu_publication_content_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_temp
as $$
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(profile) order by profile.id)
      from menu_content.menu_profiles profile
    ), '[]'::jsonb),
    'profile_facts', coalesce((
      select jsonb_agg(to_jsonb(fact) order by fact.profile_id, fact.order_index, fact.fact_id)
      from menu_content.menu_profile_facts fact
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(to_jsonb(price) order by price.pricing_key)
      from menu_content.menu_prices price
    ), '[]'::jsonb),
    'price_variants', coalesce((
      select jsonb_agg(to_jsonb(variant) order by variant.pricing_key, variant.order_index, variant.variant_id)
      from menu_content.menu_price_variants variant
    ), '[]'::jsonb),
    'daily_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.order_index, item.item_id)
      from menu_content.menu_daily_items item
    ), '[]'::jsonb),
    'profile_service_settings', coalesce((
      select jsonb_agg(to_jsonb(settings) order by settings.profile_id)
      from menu_content.menu_profile_service_settings settings
    ), '[]'::jsonb),
    'catalog_sections', coalesce((
      select jsonb_agg(to_jsonb(section) order by section.order_index, section.section_id)
      from menu_content.menu_catalog_sections section
    ), '[]'::jsonb),
    'catalog_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.section_id, item.order_index, item.item_id)
      from menu_content.menu_catalog_items item
    ), '[]'::jsonb),
    'catalog_item_images', coalesce((
      select jsonb_agg(to_jsonb(image) order by image.catalog_item_id, image.order_index, image.id)
      from menu_content.menu_catalog_item_images image
    ), '[]'::jsonb),
    'catalog_item_options', coalesce((
      select jsonb_agg(to_jsonb(option_entry) order by option_entry.catalog_item_id, option_entry.order_index, option_entry.option_id)
      from menu_content.menu_catalog_item_options option_entry
    ), '[]'::jsonb),
    'grill_families', coalesce((
      select jsonb_agg(to_jsonb(family) order by family.order_index, family.family_id)
      from menu_content.menu_grill_families family
    ), '[]'::jsonb),
    'grill_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.order_index, item.item_id)
      from menu_content.menu_grill_catalog_items item
    ), '[]'::jsonb)
  );
$$;

create or replace function app_private.get_menu_publication_content_hash()
returns text
language sql
stable
security definer
set search_path = pg_temp
as $$
  select md5(app_private.get_menu_publication_content_snapshot()::text);
$$;

create table app_private.menu_publication_revisions (
  id uuid primary key,
  content_hash text not null,
  snapshot_version integer not null default 1,
  content_snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint menu_publication_revisions_content_hash_valid
    check (content_hash ~ '^[a-f0-9]{32}$'),
  constraint menu_publication_revisions_snapshot_version_valid
    check (snapshot_version = 1),
  constraint menu_publication_revisions_snapshot_object
    check (jsonb_typeof(content_snapshot) = 'object'),
  constraint menu_publication_revisions_snapshot_hash_matches
    check (md5(content_snapshot::text) = content_hash)
);

create table app_private.menu_publication_revision_events (
  revision_id uuid not null references app_private.menu_publication_revisions(id) on delete cascade,
  change_event_id bigint not null references app_private.menu_change_events(id) on delete restrict,
  primary key (revision_id, change_event_id)
);

alter table app_private.menu_publish_requests
  add column revision_id uuid references app_private.menu_publication_revisions(id),
  add column expires_at timestamptz,
  add column triggered_at timestamptz,
  add column deployment_id text,
  add column deployment_host text,
  add column confirmation_event_id text,
  add column confirmation_source text,
  add column promoted_at timestamptz,
  add column vercel_project_id text,
  add column vercel_team_id text;

alter table app_private.menu_publish_requests
  drop constraint menu_publish_requests_status_check;

update app_private.menu_publish_requests
set status = 'failed',
    message = 'legacy_publish_request_unbound',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where status in ('queued', 'cooldown');

alter table app_private.menu_publish_requests
  add constraint menu_publish_requests_status_check
    check (status in ('queued', 'triggered', 'succeeded', 'failed')),
  add constraint menu_publish_requests_revision_required
    check (status not in ('queued', 'triggered') or revision_id is not null),
  add constraint menu_publish_requests_expiry_required
    check (revision_id is null or expires_at is not null),
  add constraint menu_publish_requests_deployment_id_valid
    check (deployment_id is null or deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  add constraint menu_publish_requests_deployment_host_valid
    check (
      deployment_host is null
      or deployment_host ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$'
    ),
  add constraint menu_publish_requests_confirmation_event_id_valid
    check (
      confirmation_event_id is null
      or confirmation_event_id ~ '^[A-Za-z0-9:_-]{1,256}$'
    ),
  add constraint menu_publish_requests_confirmation_source_valid
    check (
      confirmation_source is null
      or confirmation_source in ('vercel_webhook', 'canonical_probe')
    ),
  add constraint menu_publish_requests_confirmation_pair
    check ((confirmation_event_id is null) = (confirmation_source is null)),
  add constraint menu_publish_requests_vercel_project_id_valid
    check (vercel_project_id is null or vercel_project_id ~ '^prj_[A-Za-z0-9]+$'),
  add constraint menu_publish_requests_vercel_team_id_valid
    check (vercel_team_id is null or vercel_team_id ~ '^team_[A-Za-z0-9]+$');

create unique index menu_publish_requests_one_active_idx
  on app_private.menu_publish_requests ((true))
  where status in ('queued', 'triggered');

create index menu_publish_requests_revision_idx
  on app_private.menu_publish_requests (revision_id, created_at desc)
  where revision_id is not null;

create index menu_publication_revisions_created_by_idx
  on app_private.menu_publication_revisions (created_by, created_at desc)
  where created_by is not null;

create table app_private.menu_publication_state (
  singleton boolean primary key default true,
  active_request_id bigint references app_private.menu_publish_requests(id) on delete set null,
  deployed_request_id bigint references app_private.menu_publish_requests(id) on delete set null,
  deployed_revision_id uuid references app_private.menu_publication_revisions(id),
  deployed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint menu_publication_state_singleton check (singleton)
);

insert into app_private.menu_publication_state (singleton)
values (true);

create table app_private.menu_publication_builds (
  deployment_id text primary key,
  project_id text not null,
  request_id bigint references app_private.menu_publish_requests(id) on delete set null,
  revision_id uuid not null references app_private.menu_publication_revisions(id),
  content_hash text not null,
  created_at timestamptz not null default now(),
  constraint menu_publication_builds_deployment_id_valid
    check (deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  constraint menu_publication_builds_content_hash_valid
    check (content_hash ~ '^[a-f0-9]{32}$'),
  constraint menu_publication_builds_project_id_valid
    check (project_id ~ '^prj_[A-Za-z0-9]+$')
);

create table app_private.menu_publication_promotions (
  evidence_event_id text primary key,
  evidence_source text not null,
  deployment_id text not null references app_private.menu_publication_builds(deployment_id) on delete restrict,
  request_id bigint references app_private.menu_publish_requests(id) on delete restrict,
  revision_id uuid not null references app_private.menu_publication_revisions(id) on delete restrict,
  content_hash text not null,
  deployment_host text not null,
  project_id text not null,
  team_id text,
  promoted_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint menu_publication_promotions_event_id_valid
    check (evidence_event_id ~ '^[A-Za-z0-9:_-]{1,256}$'),
  constraint menu_publication_promotions_source_valid
    check (evidence_source in ('vercel_webhook', 'canonical_probe')),
  constraint menu_publication_promotions_deployment_id_valid
    check (deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  constraint menu_publication_promotions_content_hash_valid
    check (content_hash ~ '^[a-f0-9]{32}$'),
  constraint menu_publication_promotions_deployment_host_valid
    check (deployment_host ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$'),
  constraint menu_publication_promotions_project_id_valid
    check (project_id ~ '^prj_[A-Za-z0-9]+$'),
  constraint menu_publication_promotions_team_id_valid
    check (team_id is null or team_id ~ '^team_[A-Za-z0-9]+$')
);

alter table app_private.menu_publication_state
  add column deployed_evidence_event_id text
    references app_private.menu_publication_promotions(evidence_event_id) on delete restrict;

create index menu_publication_revision_events_change_event_idx
  on app_private.menu_publication_revision_events (change_event_id, revision_id);

create index menu_publication_builds_request_idx
  on app_private.menu_publication_builds (request_id, created_at desc)
  where request_id is not null;

create index menu_publication_builds_revision_idx
  on app_private.menu_publication_builds (revision_id, created_at desc);

create index menu_publication_promotions_deployment_idx
  on app_private.menu_publication_promotions (deployment_id, promoted_at desc);

alter table app_private.menu_publication_revisions enable row level security;
alter table app_private.menu_publication_revision_events enable row level security;
alter table app_private.menu_publication_state enable row level security;
alter table app_private.menu_publication_builds enable row level security;
alter table app_private.menu_publication_promotions enable row level security;

create or replace function app_private.get_menu_publication_revision(target_revision_id uuid)
returns table (
  revision_id uuid,
  content_hash text,
  snapshot_version integer,
  content_snapshot jsonb
)
language plpgsql
stable
security definer
set search_path = pg_temp
as $$
begin
  if target_revision_id is null then
    raise exception 'Menu publication revision id is required.';
  end if;

  return query
  select revision.id, revision.content_hash, revision.snapshot_version, revision.content_snapshot
  from app_private.menu_publication_revisions revision
  where revision.id = target_revision_id
    and md5(revision.content_snapshot::text) = revision.content_hash;

  if not found then
    raise exception 'Menu publication revision is missing or corrupt.';
  end if;
end;
$$;

create or replace function app_private.get_menu_publication_build_target(
  build_deployment_id text,
  build_project_id text
)
returns table (
  request_id bigint,
  revision_id uuid,
  content_hash text,
  snapshot_version integer
)
language plpgsql
volatile
security definer
set search_path = pg_temp
as $$
declare
  normalized_deployment_id text := nullif(btrim(build_deployment_id), '');
  normalized_project_id text := nullif(btrim(build_project_id), '');
  selected_request_id bigint;
  selected_revision_id uuid;
  selected_content_hash text;
  selected_snapshot_version integer;
begin
  if (normalized_deployment_id is null) <> (normalized_project_id is null) then
    raise exception 'Vercel deployment and project ids must be provided together.';
  end if;

  if normalized_deployment_id is not null
    and normalized_deployment_id !~ '^dpl_[A-Za-z0-9]+$' then
    raise exception 'Invalid Vercel deployment id.';
  end if;

  if normalized_project_id is not null
    and normalized_project_id !~ '^prj_[A-Za-z0-9]+$' then
    raise exception 'Invalid Vercel project id.';
  end if;

  if normalized_deployment_id is not null then
    select build.request_id, build.revision_id, build.content_hash, revision.snapshot_version
    into selected_request_id, selected_revision_id, selected_content_hash, selected_snapshot_version
    from app_private.menu_publication_builds build
    join app_private.menu_publication_revisions revision on revision.id = build.revision_id
    where build.deployment_id = normalized_deployment_id
      and build.project_id = normalized_project_id;

    if not found and exists (
      select 1
      from app_private.menu_publication_builds build
      where build.deployment_id = normalized_deployment_id
    ) then
      raise exception 'Vercel deployment id is already bound to another project.';
    end if;

    if found then
      return query select selected_request_id, selected_revision_id, selected_content_hash, selected_snapshot_version;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('menu_publication_build_target')::bigint);

  select
    case when request.status in ('queued', 'triggered') then request.id else null end,
    coalesce(request.revision_id, state.deployed_revision_id),
    revision.content_hash,
    revision.snapshot_version
  into selected_request_id, selected_revision_id, selected_content_hash, selected_snapshot_version
  from app_private.menu_publication_state state
  left join app_private.menu_publish_requests request
    on request.id = state.active_request_id
   and request.status in ('queued', 'triggered')
   and request.expires_at > now()
  join app_private.menu_publication_revisions revision
    on revision.id = coalesce(request.revision_id, state.deployed_revision_id)
  where state.singleton = true;

  if selected_revision_id is null then
    raise exception 'No immutable menu publication target is configured.';
  end if;

  if normalized_deployment_id is not null then
    insert into app_private.menu_publication_builds (
      deployment_id,
      project_id,
      request_id,
      revision_id,
      content_hash
    ) values (
      normalized_deployment_id,
      normalized_project_id,
      selected_request_id,
      selected_revision_id,
      selected_content_hash
    )
    on conflict (deployment_id) do nothing;

    select build.request_id, build.revision_id, build.content_hash, revision.snapshot_version
    into selected_request_id, selected_revision_id, selected_content_hash, selected_snapshot_version
    from app_private.menu_publication_builds build
    join app_private.menu_publication_revisions revision on revision.id = build.revision_id
    where build.deployment_id = normalized_deployment_id
      and build.project_id = normalized_project_id;
  end if;

  return query select selected_request_id, selected_revision_id, selected_content_hash, selected_snapshot_version;
end;
$$;

create or replace function public.bootstrap_menu_publication_deployment(served_content_hash text)
returns table (bootstrapped boolean, message text, revision_id uuid)
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  normalized_hash text := lower(nullif(btrim(served_content_hash), ''));
  snapshot jsonb;
  snapshot_hash text;
  selected_revision_id uuid;
begin
  if normalized_hash is null or normalized_hash !~ '^[a-f0-9]{32}$' then
    return query select false, 'invalid_served_content_hash'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('publish_menu_changes')::bigint);

  if exists (
    select 1 from app_private.menu_publication_state state
    where state.singleton = true
      and (state.active_request_id is not null or state.deployed_revision_id is not null)
  ) then
    return query select false, 'publication_already_initialized'::text, null::uuid;
    return;
  end if;

  snapshot := app_private.get_menu_publication_content_snapshot();
  snapshot_hash := md5(snapshot::text);

  if snapshot_hash <> normalized_hash then
    return query select false, 'served_content_hash_mismatch'::text, null::uuid;
    return;
  end if;

  insert into app_private.menu_publication_revisions (
    id,
    content_hash,
    snapshot_version,
    content_snapshot
  ) values (
    extensions.gen_random_uuid(),
    snapshot_hash,
    1,
    snapshot
  )
  returning id into selected_revision_id;

  update app_private.menu_publication_state state
  set deployed_revision_id = selected_revision_id,
      deployed_at = now(),
      updated_at = now()
  where state.singleton = true;

  return query select true, 'publication_bootstrapped'::text, selected_revision_id;
end;
$$;

drop function if exists public.reserve_menu_publish_request(uuid, integer);

create function public.reserve_menu_publish_request(
  user_id uuid,
  stale_after_seconds integer
)
returns table (request_id bigint, reserved boolean, message text)
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  effective_stale_seconds integer := least(greatest(coalesce(stale_after_seconds, 900), 60), 3600);
  active_request_id bigint;
  deployed_hash text;
  snapshot jsonb;
  snapshot_hash text;
  selected_revision_id uuid;
  included_change_event_ids bigint[];
  inserted_request_id bigint;
begin
  if user_id is null or not exists (
    select 1
    from public.staff_users staff
    where staff.user_id = reserve_menu_publish_request.user_id
      and staff.active = true
      and staff.role in ('operator', 'admin')
  ) then
    return query select null::bigint, false, 'permission_denied'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('publish_menu_changes')::bigint);

  update app_private.menu_publish_requests request
  set status = 'failed',
      message = 'publish_timed_out',
      completed_at = now(),
      updated_at = now()
  where request.status in ('queued', 'triggered')
    and request.expires_at <= now();

  update app_private.menu_publication_state state
  set active_request_id = null,
      updated_at = now()
  where state.singleton = true
    and state.active_request_id is not null
    and not exists (
      select 1
      from app_private.menu_publish_requests request
      where request.id = state.active_request_id
        and request.status in ('queued', 'triggered')
    );

  select request.id
  into active_request_id
  from app_private.menu_publish_requests request
  where request.status in ('queued', 'triggered')
  order by request.created_at desc
  limit 1;

  if active_request_id is not null then
    return query select active_request_id, false, 'publish_already_active'::text;
    return;
  end if;

  select
    captured.content_snapshot,
    md5(captured.content_snapshot::text),
    captured.change_event_ids
  into snapshot, snapshot_hash, included_change_event_ids
  from (
    select
      app_private.get_menu_publication_content_snapshot() as content_snapshot,
      coalesce((
        select array_agg(event.id order by event.id)
        from app_private.menu_change_events event
        where event.publish_request_id is null
      ), '{}'::bigint[]) as change_event_ids
  ) captured;

  select revision.content_hash
  into deployed_hash
  from app_private.menu_publication_state state
  join app_private.menu_publication_revisions revision on revision.id = state.deployed_revision_id
  where state.singleton = true;

  if deployed_hash = snapshot_hash then
    return query select null::bigint, false, 'publish_already_current'::text;
    return;
  end if;

  insert into app_private.menu_publication_revisions (
    id,
    content_hash,
    snapshot_version,
    content_snapshot,
    created_by
  ) values (
    extensions.gen_random_uuid(),
    snapshot_hash,
    1,
    snapshot,
    reserve_menu_publish_request.user_id
  )
  returning id into selected_revision_id;

  insert into app_private.menu_publication_revision_events (revision_id, change_event_id)
  select selected_revision_id, captured_event_id
  from unnest(included_change_event_ids) captured_event_id;

  insert into app_private.menu_publish_requests (
    requested_by,
    status,
    message,
    menu_content_hash,
    revision_id,
    expires_at
  ) values (
    reserve_menu_publish_request.user_id,
    'queued',
    'publish_reserved',
    snapshot_hash,
    selected_revision_id,
    now() + make_interval(secs => effective_stale_seconds)
  ) returning id into inserted_request_id;

  update app_private.menu_publication_state state
  set active_request_id = inserted_request_id,
      updated_at = now()
  where state.singleton = true;

  return query select inserted_request_id, true, 'publish_reserved'::text;
end;
$$;

drop function if exists public.complete_menu_publish_request(bigint, text, text, integer, text);

create function public.start_menu_publish_request(
  request_id bigint,
  hook_status_code integer,
  hook_job_id text
)
returns table (started boolean, message text)
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  normalized_job_id text := nullif(btrim(hook_job_id), '');
begin
  if request_id is null
    or hook_status_code is null
    or hook_status_code < 200
    or hook_status_code > 299 then
    return query select false, 'invalid_publish_start'::text;
    return;
  end if;

  update app_private.menu_publish_requests request
  set status = 'triggered',
      message = 'publish_triggered',
      vercel_status_code = hook_status_code,
      vercel_job_id = normalized_job_id,
      triggered_at = coalesce(request.triggered_at, now()),
      updated_at = now()
  where request.id = start_menu_publish_request.request_id
    and request.status = 'queued'
    and request.expires_at > now();

  if found then
    return query select true, 'publish_triggered'::text;
    return;
  end if;

  update app_private.menu_publish_requests request
  set status = 'failed',
      message = 'publish_timed_out',
      completed_at = now(),
      updated_at = now()
  where request.id = start_menu_publish_request.request_id
    and request.status = 'queued'
    and request.expires_at <= now();

  if found then
    update app_private.menu_publication_state state
    set active_request_id = null,
        updated_at = now()
    where state.singleton = true
      and state.active_request_id = start_menu_publish_request.request_id;

    return query select false, 'publish_request_expired'::text;
    return;
  end if;

  if exists (
    select 1 from app_private.menu_publish_requests request
    where request.id = start_menu_publish_request.request_id
      and request.status = 'triggered'
  ) then
    return query select true, 'publish_already_triggered'::text;
    return;
  end if;

  if exists (
    select 1 from app_private.menu_publish_requests request
    where request.id = start_menu_publish_request.request_id
      and request.status = 'succeeded'
  ) then
    return query select true, 'publish_already_confirmed'::text;
    return;
  end if;

  return query select false, 'publish_request_not_queued'::text;
end;
$$;

create function public.fail_menu_publish_request(
  request_id bigint,
  publish_message text,
  hook_status_code integer,
  hook_job_id text
)
returns table (failed boolean, message text)
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  normalized_message text := left(coalesce(nullif(btrim(publish_message), ''), 'publish_failed'), 120);
  normalized_job_id text := nullif(btrim(hook_job_id), '');
begin
  update app_private.menu_publish_requests request
  set status = 'failed',
      message = normalized_message,
      vercel_status_code = hook_status_code,
      vercel_job_id = normalized_job_id,
      completed_at = now(),
      updated_at = now()
  where request.id = fail_menu_publish_request.request_id
    and request.status in ('queued', 'triggered');

  if found then
    update app_private.menu_publication_state state
    set active_request_id = null,
        updated_at = now()
    where state.singleton = true
      and state.active_request_id = fail_menu_publish_request.request_id;

    return query select true, 'publish_failed'::text;
    return;
  end if;

  if exists (
    select 1 from app_private.menu_publish_requests request
    where request.id = fail_menu_publish_request.request_id
      and request.status = 'failed'
  ) then
    return query select true, 'publish_already_failed'::text;
    return;
  end if;

  return query select false, 'publish_request_not_active'::text;
end;
$$;

create function public.confirm_menu_publish_deployment(
  request_id bigint,
  revision_id uuid,
  deployment_id text,
  deployment_host text,
  content_hash text,
  evidence_event_id text,
  evidence_source text,
  event_created_at timestamptz,
  project_id text,
  team_id text
)
returns table (confirmed boolean, message text)
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  linked_change_count integer := 0;
  request_transitioned boolean := false;
  normalized_deployment_id text := nullif(btrim(deployment_id), '');
  normalized_deployment_host text := lower(nullif(btrim(deployment_host), ''));
  normalized_content_hash text := lower(nullif(btrim(content_hash), ''));
  normalized_event_id text := nullif(btrim(evidence_event_id), '');
  normalized_evidence_source text := nullif(btrim(evidence_source), '');
  normalized_project_id text := nullif(btrim(project_id), '');
  normalized_team_id text := nullif(btrim(team_id), '');
begin
  if (request_id is not null and request_id <= 0)
    or revision_id is null
    or normalized_deployment_id is null
    or normalized_deployment_id !~ '^dpl_[A-Za-z0-9]+$'
    or normalized_deployment_host is null
    or length(normalized_deployment_host) > 253
    or normalized_deployment_host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$'
    or normalized_content_hash is null
    or normalized_content_hash !~ '^[a-f0-9]{32}$'
    or normalized_event_id is null
    or normalized_event_id !~ '^[A-Za-z0-9:_-]{1,256}$'
    or normalized_evidence_source is null
    or normalized_evidence_source not in ('vercel_webhook', 'canonical_probe')
    or event_created_at is null
    or normalized_project_id is null
    or normalized_project_id !~ '^prj_[A-Za-z0-9]+$'
    or (normalized_team_id is not null and normalized_team_id !~ '^team_[A-Za-z0-9]+$') then
    return query select false, 'invalid_deployment_confirmation'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('publish_menu_changes')::bigint);

  if normalized_evidence_source = 'canonical_probe' and exists (
    select 1
    from app_private.menu_publication_state state
    join app_private.menu_publication_promotions promotion
      on promotion.evidence_event_id = state.deployed_evidence_event_id
    where state.singleton = true
      and state.deployed_revision_id = confirm_menu_publish_deployment.revision_id
      and promotion.deployment_id = normalized_deployment_id
      and promotion.request_id is not distinct from confirm_menu_publish_deployment.request_id
      and promotion.revision_id = confirm_menu_publish_deployment.revision_id
      and promotion.content_hash = normalized_content_hash
      and promotion.project_id = normalized_project_id
  ) then
    return query select true, 'deployment_already_confirmed'::text;
    return;
  end if;

  if exists (
    select 1
    from app_private.menu_publication_promotions promotion
    where promotion.evidence_event_id = normalized_event_id
      and promotion.evidence_source = normalized_evidence_source
      and promotion.deployment_id = normalized_deployment_id
      and promotion.request_id is not distinct from confirm_menu_publish_deployment.request_id
      and promotion.revision_id = confirm_menu_publish_deployment.revision_id
      and promotion.content_hash = normalized_content_hash
      and promotion.deployment_host = normalized_deployment_host
      and promotion.project_id = normalized_project_id
      and promotion.team_id is not distinct from normalized_team_id
      and promotion.promoted_at = event_created_at
  ) then
    return query select true, 'deployment_already_confirmed'::text;
    return;
  end if;

  if exists (
    select 1
    from app_private.menu_publication_promotions promotion
    where promotion.evidence_event_id = normalized_event_id
  ) then
    return query select false, 'deployment_event_conflict'::text;
    return;
  end if;

  if not exists (
    select 1
    from app_private.menu_publication_builds build
    join app_private.menu_publication_revisions revision
      on revision.id = build.revision_id
    where build.deployment_id = normalized_deployment_id
      and build.project_id = normalized_project_id
      and build.request_id is not distinct from confirm_menu_publish_deployment.request_id
      and build.revision_id = confirm_menu_publish_deployment.revision_id
      and build.content_hash = normalized_content_hash
      and revision.content_hash = normalized_content_hash
      and md5(revision.content_snapshot::text) = revision.content_hash
  ) then
    return query select false, 'deployment_build_mismatch'::text;
    return;
  end if;

  if request_id is not null and not exists (
    select 1
    from app_private.menu_publish_requests request
    where request.id = confirm_menu_publish_deployment.request_id
      and request.revision_id = confirm_menu_publish_deployment.revision_id
      and request.menu_content_hash = normalized_content_hash
      and request.status in ('queued', 'triggered', 'failed', 'succeeded')
  ) then
    return query select false, 'publish_request_mismatch'::text;
    return;
  end if;

  insert into app_private.menu_publication_promotions (
    evidence_event_id,
    evidence_source,
    deployment_id,
    request_id,
    revision_id,
    content_hash,
    deployment_host,
    project_id,
    team_id,
    promoted_at
  ) values (
    normalized_event_id,
    normalized_evidence_source,
    normalized_deployment_id,
    confirm_menu_publish_deployment.request_id,
    confirm_menu_publish_deployment.revision_id,
    normalized_content_hash,
    normalized_deployment_host,
    normalized_project_id,
    normalized_team_id,
    event_created_at
  );

  if request_id is not null then
    update app_private.menu_publish_requests request
    set status = 'succeeded',
      message = 'publish_succeeded',
      deployment_id = normalized_deployment_id,
      deployment_host = normalized_deployment_host,
        confirmation_event_id = normalized_event_id,
        confirmation_source = normalized_evidence_source,
        promoted_at = event_created_at,
        completed_at = now(),
        updated_at = now(),
        vercel_project_id = normalized_project_id,
        vercel_team_id = normalized_team_id
    where request.id = confirm_menu_publish_deployment.request_id
      and request.status in ('queued', 'triggered', 'failed');

    request_transitioned := found;

    if request_transitioned then
      update app_private.menu_change_events event
      set publish_request_id = confirm_menu_publish_deployment.request_id
      from app_private.menu_publication_revision_events included_event
      where included_event.revision_id = confirm_menu_publish_deployment.revision_id
        and included_event.change_event_id = event.id
        and event.publish_request_id is null;

      get diagnostics linked_change_count = row_count;

      update app_private.menu_publish_requests request
      set change_event_count = linked_change_count,
          updated_at = now()
      where request.id = confirm_menu_publish_deployment.request_id;
    end if;
  end if;

  update app_private.menu_publication_state state
  set active_request_id = case
        when confirm_menu_publish_deployment.request_id is not null
          and state.active_request_id = confirm_menu_publish_deployment.request_id then null
        else state.active_request_id
      end,
      deployed_request_id = case
        when state.deployed_at is null
          or event_created_at > state.deployed_at
          or (
            event_created_at = state.deployed_at
            and normalized_event_id > coalesce(state.deployed_evidence_event_id, '')
          )
          then confirm_menu_publish_deployment.request_id
        else state.deployed_request_id
      end,
      deployed_revision_id = case
        when state.deployed_at is null
          or event_created_at > state.deployed_at
          or (
            event_created_at = state.deployed_at
            and normalized_event_id > coalesce(state.deployed_evidence_event_id, '')
          )
          then confirm_menu_publish_deployment.revision_id
        else state.deployed_revision_id
      end,
      deployed_at = case
        when state.deployed_at is null
          or event_created_at > state.deployed_at
          or (
            event_created_at = state.deployed_at
            and normalized_event_id > coalesce(state.deployed_evidence_event_id, '')
          )
          then event_created_at
        else state.deployed_at
      end,
      deployed_evidence_event_id = case
        when state.deployed_at is null
          or event_created_at > state.deployed_at
          or (
            event_created_at = state.deployed_at
            and normalized_event_id > coalesce(state.deployed_evidence_event_id, '')
          )
          then normalized_event_id
        else state.deployed_evidence_event_id
      end,
      updated_at = now()
  where state.singleton = true;

  return query select true, 'deployment_confirmed'::text;
end;
$$;

create or replace function app_private.get_menu_publication_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
as $$
declare
  current_hash text;
  deployed_hash text;
  active_status text;
  active_hash text;
  active_created_at timestamptz;
  active_expires_at timestamptz;
  latest_failed_at timestamptz;
  deployed_at timestamptz;
  phase text;
begin
  if not app_private.is_active_staff() then
    return jsonb_build_object(
      'phase', 'failed',
      'has_newer_changes', false,
      'can_retry', false,
      'requested_at', null,
      'expires_at', null
    );
  end if;

  current_hash := app_private.get_menu_publication_content_hash();

  select revision.content_hash, state.deployed_at
  into deployed_hash, deployed_at
  from app_private.menu_publication_state state
  left join app_private.menu_publication_revisions revision on revision.id = state.deployed_revision_id
  where state.singleton = true;

  select request.status, request.menu_content_hash, request.created_at, request.expires_at
  into active_status, active_hash, active_created_at, active_expires_at
  from app_private.menu_publication_state state
  join app_private.menu_publish_requests request on request.id = state.active_request_id
  where state.singleton = true
    and request.status in ('queued', 'triggered');

  select max(request.completed_at)
  into latest_failed_at
  from app_private.menu_publish_requests request
  where request.status = 'failed';

  phase := case
    when active_status in ('queued', 'triggered') and active_expires_at > now() then 'publishing'
    when active_status in ('queued', 'triggered') then 'failed'
    when deployed_hash is not null and current_hash = deployed_hash then 'up_to_date'
    when latest_failed_at is not null and latest_failed_at > coalesce(deployed_at, '-infinity'::timestamptz) then 'failed'
    else 'changes_pending'
  end;

  return jsonb_build_object(
    'phase', phase,
    'has_newer_changes', phase = 'publishing' and current_hash is distinct from active_hash,
    'can_retry', phase = 'failed',
    'requested_at', case when phase = 'publishing' then active_created_at else null end,
    'expires_at', case when phase = 'publishing' then active_expires_at else null end
  );
end;
$$;

create or replace function public.get_admin_operational_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_temp
as $$
declare
  state jsonb;
begin
  state := app_private.get_admin_operational_state();

  if coalesce((state ->> 'ok')::boolean, false) then
    return state || jsonb_build_object(
      'publication', app_private.get_menu_publication_state()
    );
  end if;

  return state;
end;
$$;

revoke all on table app_private.menu_publication_revisions from public, anon, authenticated, service_role;
revoke all on table app_private.menu_publication_revision_events from public, anon, authenticated, service_role;
revoke all on table app_private.menu_publication_state from public, anon, authenticated, service_role;
revoke all on table app_private.menu_publication_builds from public, anon, authenticated, service_role;
revoke all on table app_private.menu_publication_promotions from public, anon, authenticated, service_role;

revoke all on function app_private.get_menu_publication_content_snapshot() from public;
revoke all on function app_private.get_menu_publication_content_hash() from public;
revoke all on function app_private.get_menu_publication_revision(uuid) from public;
revoke all on function app_private.get_menu_publication_build_target(text, text) from public;
revoke all on function app_private.get_menu_publication_state() from public;

grant execute on function app_private.get_menu_publication_content_hash() to menu_build_ci;
grant execute on function app_private.get_menu_publication_revision(uuid) to menu_build_ci;
grant execute on function app_private.get_menu_publication_build_target(text, text) to menu_build_ci;
grant execute on function app_private.get_menu_publication_state() to authenticated;

revoke all on function public.get_admin_operational_state() from public, anon;
grant execute on function public.get_admin_operational_state() to authenticated;

revoke all on function public.bootstrap_menu_publication_deployment(text) from public, anon, authenticated;
grant execute on function public.bootstrap_menu_publication_deployment(text) to service_role;

revoke all on function public.reserve_menu_publish_request(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_menu_publish_request(uuid, integer) to service_role;

revoke all on function public.start_menu_publish_request(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.start_menu_publish_request(bigint, integer, text) to service_role;

revoke all on function public.fail_menu_publish_request(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.fail_menu_publish_request(bigint, text, integer, text) to service_role;

revoke all on function public.confirm_menu_publish_deployment(bigint, uuid, text, text, text, text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_menu_publish_deployment(bigint, uuid, text, text, text, text, text, timestamptz, text, text)
  to service_role;
