alter table app_private.menu_publish_requests
  drop constraint menu_publish_requests_confirmation_event_id_valid,
  add constraint menu_publish_requests_confirmation_event_id_valid
  check (
    confirmation_event_id is null
    or (
      char_length(confirmation_event_id) between 1 and 256
      and confirmation_event_id !~ '[^A-Za-z0-9:_-]'
    )
  );

alter table app_private.menu_publication_promotions
  drop constraint menu_publication_promotions_event_id_valid,
  add constraint menu_publication_promotions_event_id_valid
  check (
    char_length(evidence_event_id) between 1 and 256
    and evidence_event_id !~ '[^A-Za-z0-9:_-]'
  );

create or replace function public.confirm_menu_publish_deployment(
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
    or char_length(normalized_event_id) > 256
    or normalized_event_id ~ '[^A-Za-z0-9:_-]'
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

revoke all on function public.confirm_menu_publish_deployment(
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.confirm_menu_publish_deployment(
  bigint,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text
) to service_role;
