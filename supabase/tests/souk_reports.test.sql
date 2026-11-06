-- Tests for reports on Souk items and taking items off sale.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk_reports.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) creator; bara (2) reporter; sam (3) shop manager; modi (4) moderator;
-- dame (5) admin; eli (6) buyer.

create schema srk;
grant usage on schema srk to public;

create function srk.uid(p_n int) returns uuid
language sql immutable as $$ select ('e5e5e5e5-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function srk.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', srk.uid(p_n)::text, true);
end $$;

create function srk.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function srk.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function srk.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := srk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function srk.item(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where slug = p_slug $$;

create function srk.notices(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = srk.uid(p_n) and kind = p_kind
$$;

create function srk.on_sale(p_slug text) returns boolean
language sql stable security definer as $$ select is_active from public.souk_items where slug = p_slug $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (srk.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (srk.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (srk.uid(3), 'sam@exemple.sn', '{"provider":"email"}', '{}'),
  (srk.uid(4), 'modi@exemple.sn', '{"provider":"email"}', '{}'),
  (srk.uid(5), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (srk.uid(6), 'eli@exemple.sn', '{"provider":"email"}', '{}');

insert into public.souk_items (slug, kind, name, description, price_kopeks, is_active, creator_id) values
  ('sr-ana-1', 'theme', 'Theme Ana', 'Un theme', 50, true, srk.uid(1)),
  ('sr-ana-2', 'status_badge', 'Badge Ana', null, 30, true, srk.uid(1)),
  ('sr-ana-3', 'theme', 'Theme Ana 3', null, 30, true, srk.uid(1)),
  ('sr-ana-off', 'theme', 'Theme retire', null, 30, false, srk.uid(1)),
  ('sr-house', 'theme', 'Theme maison', null, 30, true, null);

do $$
begin
  set local role service_role;
  perform public.make_admin(srk.uid(5));
  perform public.grant_reward(srk.uid(6), 0, 500, 'test_credit', 'srk:credit', null, null);
  reset role;
  perform srk.as_user(5);
  perform public.set_moderator(srk.uid(4), true);
  perform public.set_back_office_role(srk.uid(3), 'shop_manager', true);
  reset role;
  perform srk.as_user(6);
  perform public.buy_item(srk.item('sr-ana-1'));
  reset role;
end $$;

-- ---- 1. Reporting an item ------------------------------------------------------------------------------------
do $$
declare r uuid;
begin
  perform srk.as_anon();
  perform srk.must_fail('a visitor reports', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-ana-1')::text, 'spam'), 'permission denied');
  reset role;
  perform srk.as_user(2);
  perform srk.must_fail('an item with no creator', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-house')::text, 'spam'), 'Target not found');
  perform srk.must_fail('an item off sale', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-ana-off')::text, 'spam'), 'Target not found');
  perform srk.must_fail('an unknown item', format('select public.report_content(%L, %L, %L)', 'souk_item', gen_random_uuid()::text, 'spam'), 'Target not found');
  perform srk.must_fail('a bad id', 'select public.report_content(''souk_item'', ''pas-un-id'', ''spam'')', 'Target not found');
  r := public.report_content('souk_item', srk.item('sr-ana-1')::text, 'inappropriate', 'Image choquante');
  perform srk.must_fail('reporting twice', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-ana-1')::text, 'spam'), 'already reported');
  reset role;
  perform srk.as_user(1);
  perform srk.must_fail('reporting your own item', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-ana-1')::text, 'spam'), 'own content');
  reset role;
  if (select target_author_id from public.reports where id = r) <> srk.uid(1) then raise exception 'FAIL: the creator is the author'; end if;
  if (select snapshot ->> 'name' from public.reports where id = r) <> 'Theme Ana' or (select (snapshot ->> 'price')::int from public.reports where id = r) <> 50 then raise exception 'FAIL: snapshot of the item'; end if;
  raise notice 'OK 1: members can report an item made by another member, once, with a snapshot';
end $$;

-- ---- 2. Staff remove it ------------------------------------------------------------------------------------
do $$
declare r uuid := (select id from public.reports where reporter_id = srk.uid(2) and target_type = 'souk_item');
begin
  perform srk.as_user(2);
  perform srk.must_fail('a member resolves', format('select public.resolve_report(%L, %L)', r, 'remove_content'), 'Only staff');
  reset role;
  perform srk.as_user(3);
  perform srk.must_fail('a shop manager resolves reports', format('select public.resolve_report(%L, %L)', r, 'remove_content'), 'Only staff');
  reset role;
  perform srk.as_user(4);
  perform public.resolve_report(r, 'remove_content', 'Image inappropriee');
  reset role;
  if srk.on_sale('sr-ana-1') then raise exception 'FAIL: the item is off sale'; end if;
  if not exists (select 1 from public.member_items where user_id = srk.uid(6) and item_id = srk.item('sr-ana-1')) then raise exception 'FAIL: the buyer keeps the item'; end if;
  if srk.notices(1, 'souk_item_removed') <> 1 then raise exception 'FAIL: the creator is told'; end if;
  perform srk.as_anon();
  if exists (select 1 from public.souk_shop() where slug = 'sr-ana-1') then raise exception 'FAIL: not in the shop any more'; end if;
  reset role;
  perform srk.as_user(1);
  perform srk.must_fail('muting the removal notice', 'select public.set_notification_mute(''souk_item_removed'', true)', 'cannot');
  reset role;
  perform srk.as_user(2);
  perform srk.must_fail('reporting it again', format('select public.report_content(%L, %L, %L)', 'souk_item', srk.item('sr-ana-1')::text, 'spam'), 'Target not found');
  reset role;
  raise notice 'OK 2: removing takes the item off sale, owners keep it, and the creator is told';
end $$;

-- ---- 3. Shop staff on and off sale ------------------------------------------------------------------------
do $$
declare n_before bigint; i uuid := srk.item('sr-ana-2');
begin
  select count(*) into n_before from public.admin_audit_log;
  perform srk.as_user(2);
  perform srk.must_fail('a member takes an item off sale', format('select public.set_souk_item_on_sale(%L, false, %L)', i, 'x'), 'Only shop staff');
  reset role;
  perform srk.as_user(4);
  perform srk.must_fail('a moderator takes an item off sale', format('select public.set_souk_item_on_sale(%L, false, %L)', i, 'x'), 'Only shop staff');
  reset role;
  perform srk.as_anon();
  perform srk.must_fail('a visitor', format('select public.set_souk_item_on_sale(%L, false, %L)', i, 'x'), 'permission denied');
  reset role;
  perform srk.as_user(3);
  perform srk.must_fail('no reason', format('select public.set_souk_item_on_sale(%L, false)', i), 'reason');
  perform srk.must_fail('a long reason', format('select public.set_souk_item_on_sale(%L, false, %L)', i, repeat('a', 501)), 'too long');
  perform srk.must_fail('an unknown item', format('select public.set_souk_item_on_sale(%L, false, %L)', gen_random_uuid(), 'x'), 'Item not found');
  perform srk.must_fail('no choice', format('select public.set_souk_item_on_sale(%L, null)', i), 'on sale or off sale');
  perform public.set_souk_item_on_sale(i, false, 'Doublon');
  perform public.set_souk_item_on_sale(i, false, 'Doublon'); -- again: no second log, no second notice
  reset role;
  if srk.on_sale('sr-ana-2') then raise exception 'FAIL: off sale'; end if;
  if srk.notices(1, 'souk_item_removed') <> 2 then raise exception 'FAIL: one more notice, once'; end if;
  perform srk.as_user(3);
  perform public.set_souk_item_on_sale(i, true);
  perform public.set_souk_item_on_sale(i, true);
  reset role;
  if not srk.on_sale('sr-ana-2') then raise exception 'FAIL: back on sale'; end if;
  if (select count(*) from public.admin_audit_log) <> n_before + 2 then raise exception 'FAIL: two audit entries (off, on), got %', (select count(*) from public.admin_audit_log) - n_before; end if;
  -- a house item can be taken off too, with no notice to anyone
  perform srk.as_user(5);
  perform public.set_souk_item_on_sale(srk.item('sr-house'), false, 'Retire');
  perform public.set_souk_item_on_sale(srk.item('sr-house'), true);
  reset role;
  raise notice 'OK 3: shop staff take items off and on sale with a reason, logged once, and the creator is told';
end $$;

-- ---- 4. Resolving other ways, and a featured item that is removed ---------------------------------------
do $$
declare r uuid; i uuid := srk.item('sr-ana-3');
begin
  perform srk.as_user(3);
  perform public.set_featured_item(i, current_date);
  reset role;
  perform srk.as_anon();
  if (select item_id from public.featured_item()) is distinct from i then raise exception 'FAIL: the item is featured'; end if;
  reset role;
  perform srk.as_user(2);
  r := public.report_content('souk_item', i::text, 'scam');
  reset role;
  perform srk.as_user(4);
  perform public.resolve_report(r, 'dismiss');
  reset role;
  if not srk.on_sale('sr-ana-3') then raise exception 'FAIL: a dismissed report leaves the item alone'; end if;
  perform srk.as_user(3);
  perform public.set_souk_item_on_sale(i, false, 'Retire');
  reset role;
  perform srk.as_anon();
  if (select item_id from public.featured_item()) is not distinct from i then raise exception 'FAIL: an item off sale is not featured'; end if;
  reset role;
  raise notice 'OK 4: dismissing leaves the item; an item taken off sale stops being featured';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.souk_featured;
delete from public.reports where reporter_id::text like 'e5e5e5e5-%';
delete from public.member_items where user_id::text like 'e5e5e5e5-%';
delete from public.souk_items where slug like 'sr-%';
delete from public.profiles where id::text like 'e5e5e5e5-%';
delete from auth.users where id::text like 'e5e5e5e5-%';
drop schema srk cascade;

do $$
begin
  if exists (select 1 from public.souk_items where slug like 'sr-%') or exists (select 1 from public.reports) or exists (select 1 from public.souk_featured) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.back_office_roles) or exists (select 1 from public.staff_roles) then raise exception 'FAIL: roles left behind'; end if;
  raise notice 'OK 5: the test left nothing behind';
end $$;

select 'ALL SOUK REPORTS TESTS PASSED' as result;
