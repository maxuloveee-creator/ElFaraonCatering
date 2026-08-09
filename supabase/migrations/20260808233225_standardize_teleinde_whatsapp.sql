do $$
declare
  updated_count integer;
begin
  update menu_content.menu_profile_facts
  set link_href = 'https://wa.me/5491154003333?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%3A%20'
  where profile_id = 'teleinde'
    and fact_id = 'contacto';

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception 'Expected one Teleinde contact fact, updated %', updated_count;
  end if;
end;
$$;
