create or replace function public.get_admin_operational_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_temp
as $$
declare
  state jsonb;
  default_profile_id text;
begin
  state := app_private.get_admin_operational_state();

  if coalesce((state ->> 'ok')::boolean, false) is not true then
    return state;
  end if;

  select staff.default_availability_profile_id
  into default_profile_id
  from public.staff_users staff
  where staff.user_id = (select auth.uid())
    and staff.active = true;

  state := state || jsonb_build_object(
    'catalog_editor', app_private.get_admin_catalog_editor_state(),
    'grill_editor', app_private.get_admin_grill_editor_state(),
    'publication', app_private.get_menu_publication_state()
  );

  return jsonb_set(
    state,
    '{staff,default_availability_profile_id}',
    coalesce(to_jsonb(default_profile_id), 'null'::jsonb),
    true
  );
end;
$$;

revoke all on function public.get_admin_operational_state() from public, anon;
grant execute on function public.get_admin_operational_state() to authenticated;
