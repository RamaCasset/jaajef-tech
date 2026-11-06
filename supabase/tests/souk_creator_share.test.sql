-- Tests for the Souk creator share.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk_creator_share.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) creator; bara (2) buyer; coumba (3) buyer; olu (4) shop owner; dame (5) admin;
-- sam (6) shop manager.

create schema csk;
grant usage on schema csk to public;

create function csk.uid(p_n int) returns uuid
language sql immutable as $$ select ('c3c3c3c3-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function csk.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', csk.uid(p_n)::text, true);
end $$;

create function csk.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function csk.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function csk.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := csk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function csk.kopeks(p_n int) returns bigint
language sql stable security definer as $$ select kopeks from public.wallets where user_id = csk.uid(p_n) $$;

create function csk.item(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where slug = p_slug $$;

create function csk.notices(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = csk.uid(p_n) and kind = p_kind
$$;

create function csk.credit(p_n int, p_amount bigint) returns void
language plpgsql as $$
begin
  set local role service_role;
  perform public.grant_reward(csk.uid(p_n), 0, p_amount, 'test_credit', 'csk:' || p_n || ':' || p_amount || ':' || clock_timestamp()::text, null, null);
  reset role;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (csk.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (csk.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (csk.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (csk.uid(4), 'olu@exemple.sn', '{"provider":"email"}', '{}'),
  (csk.uid(5), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (csk.uid(6), 'sam@exemple.sn', '{"provider":"email"}', '{}');

insert into public.souk_items (slug, kind, name, price_kopeks, is_active, creator_id) values
  ('cs-ana-100', 'theme', 'Theme Ana', 100, true, csk.uid(1)),
  ('cs-ana-15', 'avatar_frame', 'Cadre Ana', 15, true, csk.uid(1)),
  ('cs-ana-200', 'status_badge', 'Badge Ana', 200, true, csk.uid(1)),
  ('cs-bara-50', 'theme', 'Theme Bara', 50, true, csk.uid(2)),
  ('cs-house', 'theme', 'Theme maison', 40, true, null),
  ('cs-big', 'theme', 'Theme cher', 1000000, true, csk.uid(1));

do $$
begin
  set local role service_role;
  perform public.make_admin(csk.uid(5));
  reset role;
  perform csk.as_user(5);
  perform public.set_back_office_role(csk.uid(4), 'shop_owner', true);
  perform public.set_back_office_role(csk.uid(6), 'shop_manager', true);
  reset role;
  perform csk.credit(2, 1000);
  perform csk.credit(3, 1000);
  perform csk.credit(1, 1000);
end $$;

-- ---- 1. The share is paid, rounded down ---------------------------------------------------------------------
do $$
declare ana0 bigint := csk.kopeks(1); bara0 bigint := csk.kopeks(2);
begin
  if (select value #>> '{}' from public.game_config where key = 'souk_creator_share_percent') <> '70' then raise exception 'FAIL: default share is 70'; end if;
  perform csk.as_user(2);
  perform public.buy_item(csk.item('cs-ana-100'));
  reset role;
  if csk.kopeks(2) <> bara0 - 100 then raise exception 'FAIL: the buyer pays the full price'; end if;
  if csk.kopeks(1) <> ana0 + 70 then raise exception 'FAIL: the creator receives 70'; end if;
  perform csk.as_user(2);
  perform public.buy_item(csk.item('cs-ana-15'));
  reset role;
  if csk.kopeks(1) <> ana0 + 70 + 10 then raise exception 'FAIL: 70 percent of 15 is 10, rounded down, got %', csk.kopeks(1) - ana0 - 70; end if;
  if (select count(*) from public.souk_sales where creator_id = csk.uid(1)) <> 2 then raise exception 'FAIL: two sales recorded'; end if;
  if csk.notices(1, 'souk_sale') <> 2 then raise exception 'FAIL: the creator is told of each sale'; end if;
  if not exists (select 1 from public.kopek_transactions where user_id = csk.uid(1) and reason = 'souk_sale' and amount = 70) then raise exception 'FAIL: the payout is in the Kopek history'; end if;
  if (select data ->> 'amount' from public.notifications where user_id = csk.uid(1) and kind = 'souk_sale' order by id limit 1) <> '70' then raise exception 'FAIL: amount in the notice'; end if;
  raise notice 'OK 1: the buyer pays in full, the creator gets 70 percent rounded down, and it is recorded and notified';
end $$;

-- ---- 2. When no share is paid -------------------------------------------------------------------------------------------
do $$
declare ana0 bigint := csk.kopeks(1); sales0 bigint := (select count(*) from public.souk_sales);
begin
  -- the creator buys her own item: pays, gets nothing back, no sale recorded
  perform csk.as_user(1);
  perform public.buy_item(csk.item('cs-ana-200'));
  reset role;
  if csk.kopeks(1) <> ana0 - 200 then raise exception 'FAIL: buying your own item costs the full price with no share'; end if;
  if (select count(*) from public.souk_sales) <> sales0 then raise exception 'FAIL: not a sale'; end if;
  -- an item with no creator
  perform csk.as_user(3);
  perform public.buy_item(csk.item('cs-house'));
  reset role;
  if (select count(*) from public.souk_sales) <> sales0 then raise exception 'FAIL: house items have no creator sale'; end if;
  -- buying twice, or without money, pays nothing
  perform csk.as_user(2);
  perform csk.must_fail('buying twice', format('select public.buy_item(%L)', csk.item('cs-ana-100')), 'already own');
  reset role;
  perform csk.as_user(4);
  perform csk.must_fail('no Kopeks', format('select public.buy_item(%L)', csk.item('cs-big')), 'Not enough');
  reset role;
  if (select count(*) from public.souk_sales) <> sales0 then raise exception 'FAIL: refused purchases pay nothing'; end if;
  -- an item taken off sale
  update public.souk_items set is_active = false where slug = 'cs-bara-50';
  perform csk.as_user(3);
  perform csk.must_fail('item off sale', format('select public.buy_item(%L)', csk.item('cs-bara-50')), 'not for sale');
  reset role;
  update public.souk_items set is_active = true where slug = 'cs-bara-50';
  raise notice 'OK 2: no share for your own item, house items, or refused purchases';
end $$;

-- ---- 3. Changing the share only affects later sales ---------------------------------------------------------
do $$
declare ana0 bigint;
begin
  perform csk.as_user(6);
  perform csk.must_fail('a shop manager sets the share', 'select public.set_creator_share(50)', 'Only the shop owner');
  reset role;
  perform csk.as_user(2);
  perform csk.must_fail('a member sets the share', 'select public.set_creator_share(50)', 'Only the shop owner');
  reset role;
  perform csk.as_anon();
  perform csk.must_fail('a visitor sets the share', 'select public.set_creator_share(50)', 'permission denied');
  reset role;
  perform csk.as_user(4);
  perform csk.must_fail('over 100', 'select public.set_creator_share(101)', 'from 0 to 100');
  perform csk.must_fail('negative', 'select public.set_creator_share(-1)', 'from 0 to 100');
  perform csk.must_fail('empty', 'select public.set_creator_share(null)', 'from 0 to 100');
  perform public.set_creator_share(50);
  perform public.set_creator_share(50); -- again: one log only
  reset role;
  if (select count(*) from public.admin_audit_log where action = 'souk_creator_share_set' and actor_id = csk.uid(4)) <> 1 then raise exception 'FAIL: one audit entry for the change'; end if;
  if (select status from public.game_config where key = 'souk_creator_share_percent') <> 'defined' then raise exception 'FAIL: marked as decided'; end if;

  ana0 := csk.kopeks(1);
  perform csk.as_user(3);
  perform public.buy_item(csk.item('cs-ana-200')); -- coumba buys the 200 item at 50 percent
  reset role;
  if csk.kopeks(1) <> ana0 + 100 then raise exception 'FAIL: new sales use 50 percent'; end if;
  if (select share_percent from public.souk_sales where item_name = 'Theme Ana') <> 70 then raise exception 'FAIL: an old sale keeps its 70'; end if;
  if (select share_percent from public.souk_sales where item_name = 'Badge Ana') <> 50 then raise exception 'FAIL: the new sale records 50'; end if;

  -- zero percent: sale recorded, nothing paid
  perform csk.as_user(5);
  perform public.set_creator_share(0);
  reset role;
  ana0 := csk.kopeks(1);
  perform csk.as_user(3);
  perform public.buy_item(csk.item('cs-bara-50'));
  reset role;
  if (select creator_amount from public.souk_sales where item_name = 'Theme Bara') <> 0 then raise exception 'FAIL: 0 percent pays nothing'; end if;
  perform csk.as_user(5);
  perform public.set_creator_share(70);
  reset role;
  raise notice 'OK 3: only the shop owner changes the share, it is logged, and past sales keep their own percentage';
end $$;

-- ---- 4. What creators and the owner can see --------------------------------------------------------------------
do $$
declare r record;
begin
  perform csk.as_user(1);
  select * into r from public.my_creator_summary();
  if r.items_on_sale <> 4 or r.sales_count <> 3 or r.kopeks_earned <> 70 + 10 + 100 or r.share_percent <> 70 then raise exception 'FAIL: summary %', r; end if;
  if (select count(*) from public.list_my_sales()) <> 3 then raise exception 'FAIL: three sales listed'; end if;
  if (select item_name from public.list_my_sales(1)) <> 'Badge Ana' then raise exception 'FAIL: newest first'; end if;
  if exists (select 1 from jsonb_object_keys(to_jsonb((select s from public.list_my_sales(1) s))) k where k like '%buyer%') then raise exception 'FAIL: the buyer must not be shown'; end if;
  perform csk.must_fail('reading sales directly', 'select * from public.souk_sales', 'permission denied');
  perform csk.must_fail('a creator reads the owner overview', 'select * from public.creator_earnings_overview()', 'Only the shop owner');
  reset role;
  perform csk.as_user(2);
  select * into r from public.my_creator_summary();
  if r.sales_count <> 1 then raise exception 'FAIL: bara sold Theme Bara once, got %', r.sales_count; end if;
  if (select count(*) from public.list_my_sales()) <> 1 then raise exception 'FAIL: bara sees only her own sale'; end if;
  reset role;
  perform csk.as_user(3);
  select * into r from public.my_creator_summary();
  if r.sales_count <> 0 or r.kopeks_earned <> 0 then raise exception 'FAIL: a buyer who creates nothing has no sales'; end if;
  reset role;
  perform csk.as_anon();
  perform csk.must_fail('a visitor reads the summary', 'select * from public.my_creator_summary()', 'permission denied');
  reset role;
  perform csk.as_user(4);
  if (select count(*) from public.creator_earnings_overview()) <> 2 then raise exception 'FAIL: two creators in the overview'; end if;
  if (select paid_kopeks from public.creator_earnings_overview() where username = (select username from public.profiles where id = csk.uid(1))) <> 180 then raise exception 'FAIL: ana was paid 180'; end if;
  if (select gross_kopeks from public.creator_earnings_overview() where username = (select username from public.profiles where id = csk.uid(1))) <> 315 then raise exception 'FAIL: gross 100 + 15 + 200'; end if;
  reset role;
  perform csk.as_user(6);
  perform csk.must_fail('a shop manager reads the overview', 'select * from public.creator_earnings_overview()', 'Only the shop owner');
  reset role;
  raise notice 'OK 4: creators see their own sales without buyers; only the shop owner sees totals';
end $$;

-- ---- 5. Members buying from each other, and creators who leave -------------------------------------------
do $$
declare ana0 bigint := csk.kopeks(1); bara0 bigint := csk.kopeks(2);
begin
  -- ana buys bara's item (50) and bara buys ana's badge (200), one after the other
  perform csk.as_user(1);
  perform public.buy_item(csk.item('cs-bara-50'));
  reset role;
  perform csk.as_user(2);
  perform public.buy_item(csk.item('cs-ana-200'));
  reset role;
  if csk.kopeks(1) <> ana0 - 50 + 140 then raise exception 'FAIL: ana pays 50 and earns 70 percent of 200'; end if;
  if csk.kopeks(2) <> bara0 + 35 - 200 then raise exception 'FAIL: bara earns 70 percent of 50 and pays 200'; end if;
  raise notice 'OK 5: members can buy from each other';
end $$;

do $$
declare ana0 bigint;
begin
  -- a creator is deleted: the item stays for its owners; later sales pay nobody
  delete from public.profiles where id = csk.uid(1);
  if not exists (select 1 from public.souk_items where slug = 'cs-ana-100' and creator_id is null) then raise exception 'FAIL: item stays without a creator'; end if;
  if exists (select 1 from public.souk_sales where creator_id = csk.uid(1)) then raise exception 'FAIL: her sales go with her'; end if;
  raise notice 'OK 5b: deleting a creator keeps the items';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.member_items where user_id::text like 'c3c3c3c3-%';
delete from public.souk_items where slug like 'cs-%';
delete from public.profiles where id::text like 'c3c3c3c3-%';
delete from auth.users where id::text like 'c3c3c3c3-%';
drop schema csk cascade;
update public.game_config set value = '70'::jsonb, status = 'tbc' where key = 'souk_creator_share_percent';

do $$
begin
  if exists (select 1 from public.souk_sales) or exists (select 1 from public.souk_items where slug like 'cs-%') then raise exception 'FAIL: data left behind'; end if;
  if exists (select 1 from public.back_office_roles) or exists (select 1 from public.staff_roles) then raise exception 'FAIL: roles left behind'; end if;
  raise notice 'OK 6: the test left nothing behind';
end $$;

select 'ALL SOUK CREATOR SHARE TESTS PASSED' as result;
