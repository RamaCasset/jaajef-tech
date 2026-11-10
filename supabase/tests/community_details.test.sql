-- Tests for community details. Run AFTER all migrations. People: ola (1) owns, pam (2) is a plain member.
create schema cdt;
grant usage on schema cdt to public;
create function cdt.uid(p_n int) returns uuid language sql immutable as $$ select ('e2f3a4b5-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function cdt.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', cdt.uid(p_n)::text, true); end $$;
create function cdt.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (cdt.uid(1), 'ola-cd@exemple.sn', '{"provider":"email"}', '{}'),
  (cdt.uid(2), 'pam-cd@exemple.sn', '{"provider":"email"}', '{}');
insert into public.communities (id, slug, name, is_private, owner_id) values
  ('e2f3a4b5-aaaa-0000-0000-000000000001', 'cd-salon', 'Salon', false, cdt.uid(1));
insert into public.community_members (community_id, user_id, role) values
  ('e2f3a4b5-aaaa-0000-0000-000000000001', cdt.uid(1), 'owner'),
  ('e2f3a4b5-aaaa-0000-0000-000000000001', cdt.uid(2), 'member');

do $$
declare
  c uuid := 'e2f3a4b5-aaaa-0000-0000-000000000001';
  r record; e text;
begin
  perform cdt.as_user(1);
  perform public.set_community_details(c, 'web', array['React', ' JavaScript ', 'React', ''], 'entraide front-end');
  reset role;
  select * into r from public.communities where id = c;
  if r.topic <> 'web' or r.tags <> array['JavaScript', 'React'] or r.activity <> 'entraide front-end' then
    raise exception 'FAIL: details not saved (% % %)', r.topic, r.tags, r.activity;
  end if;
  raise notice 'OK 1: owner sets details, tags are cleaned';

  perform cdt.as_user(1);
  perform public.set_community_details(c, null, null, '');
  reset role;
  select * into r from public.communities where id = c;
  if r.topic <> 'web' or r.activity is not null then raise exception 'FAIL: partial update wrong'; end if;
  raise notice 'OK 2: untouched fields stay, empty text clears';

  perform cdt.as_user(2);
  e := cdt.error_of('select public.set_community_details(''' || c || ''', ''design'')');
  reset role;
  if e is null then raise exception 'FAIL: a plain member changed the details'; end if;
  perform cdt.as_user(1);
  e := cdt.error_of('select public.set_community_details(''' || c || ''', ''cuisine'')');
  if e is null then raise exception 'FAIL: unknown topic accepted'; end if;
  e := cdt.error_of('select public.set_community_details(''' || c || ''', null, array[''a'',''b'',''c'',''d'',''e''])');
  reset role;
  if e is null then raise exception 'FAIL: five tags accepted'; end if;
  raise notice 'OK 3: members and bad values are refused';
end $$;

delete from public.communities where id::text like 'e2f3a4b5-%';
delete from auth.users where id in (cdt.uid(1), cdt.uid(2));
drop schema cdt cascade;
