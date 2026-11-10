-- Test: the shop list names the creator of an item. Run AFTER all migrations.
create schema scs;
create function scs.uid(p_n int) returns uuid language sql immutable as $$ select ('d7e8f9a0-0000-0000-0000-00000000000' || p_n)::uuid $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (scs.uid(1), 'cree-sc@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set display_name = 'Awa Diallo', clan = 'griot_du_code' where id = scs.uid(1);
insert into public.souk_items (slug, kind, name, price_kopeks, data, creator_id) values
  ('scs-fait', 'theme', 'Fait par Awa', 100, '{"accent":"#3fb8f0"}', scs.uid(1)),
  ('scs-maison', 'theme', 'Fait maison', 100, '{"accent":"#3fb8f0"}', null);

do $$
declare r record;
begin
  select * into r from public.souk_shop('theme') where slug = 'scs-fait';
  if r.creator_name is distinct from 'Awa Diallo' or r.creator_clan is distinct from 'griot_du_code' then
    raise exception 'FAIL: creator not shown (% / %)', r.creator_name, r.creator_clan;
  end if;
  select * into r from public.souk_shop('theme') where slug = 'scs-maison';
  if r.creator_name is not null then raise exception 'FAIL: an item without a creator shows one'; end if;
  raise notice 'OK: creator on the shop list';
end $$;

delete from public.souk_items where slug like 'scs-%';
delete from auth.users where id = scs.uid(1);
drop schema scs cascade;
