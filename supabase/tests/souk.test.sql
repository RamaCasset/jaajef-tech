-- Tests for the Souk migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...01) buys and wears things; bamba (...02) is another member.

create schema skkit;
grant usage on schema skkit to public;

create function skkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('a5a5a5a5-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function skkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', skkit.uid(p_n)::text, true);
end $$;

create function skkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function skkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function skkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function skkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := skkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function skkit.item(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where slug = p_slug $$;

create function skkit.balance(p_n int) returns bigint
language sql stable security definer as $$ select kopeks from public.wallets where user_id = skkit.uid(p_n) $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (skkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (skkit.uid(2), 'bamba@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. The shop is public ----------------------------------------------------------------------
do $$
begin
  perform skkit.as_anon();
  if (select count(*) from public.souk_items where slug like 'exemple-%') <> 6 then raise exception 'FAIL: visitors should see the 6 sample items'; end if;
  reset role;
  if (select count(*) from public.souk_items where slug like 'exemple-%' and kind = 'theme') <> 2
     or (select count(*) from public.souk_items where slug like 'exemple-%' and kind = 'avatar_frame') <> 2
     or (select count(*) from public.souk_items where slug like 'exemple-%' and kind = 'status_badge') <> 2 then
    raise exception 'FAIL: two sample items of each kind expected';
  end if;
  raise notice 'OK 1: the shop is public and has items of the three kinds';
end $$;

-- ---- 2. Buying ----------------------------------------------------------------------------------
do $$
declare frame uuid := skkit.item('exemple-cadre-or');
begin
  perform skkit.as_user(1);
  perform skkit.must_fail('buying without enough Kopeks', format('select public.buy_item(%L)', frame), 'Not enough Kopeks');
  reset role;
  if skkit.balance(1) <> 100 then raise exception 'FAIL: a refused purchase changed the balance'; end if;
  if exists (select 1 from public.member_items where user_id = skkit.uid(1)) then raise exception 'FAIL: a refused purchase gave the item'; end if;

  perform skkit.as_server();
  perform public.grant_reward(skkit.uid(1), 0, 500, 'test_topup', 'souk-test-topup-1');
  reset role;
  if skkit.balance(1) <> 600 then raise exception 'FAIL: top up did not work'; end if;

  perform skkit.as_user(1);
  perform public.buy_item(frame);
  if (select count(*) from public.member_items) <> 1 then raise exception 'FAIL: the member should own the item'; end if;
  perform skkit.must_fail('buying the same item twice', format('select public.buy_item(%L)', frame), 'already own');
  reset role;

  if skkit.balance(1) <> 400 then raise exception 'FAIL: the item cost 200, balance is %', skkit.balance(1); end if;
  if (select count(*) from public.kopek_transactions where user_id = skkit.uid(1) and reason = 'souk_purchase' and amount = -200 and balance_after = 400) <> 1 then
    raise exception 'FAIL: the purchase is not in the Kopek history exactly once';
  end if;
  if (select price_paid from public.member_items where user_id = skkit.uid(1)) <> 200 then raise exception 'FAIL: price paid not recorded'; end if;
  raise notice 'OK 2: buying costs the price once, shows in the history, and needs enough Kopeks';
end $$;

do $$
declare free uuid := skkit.item('exemple-statut-nouveau');
begin
  perform skkit.as_user(1);
  perform public.buy_item(free);
  reset role;
  if skkit.balance(1) <> 400 then raise exception 'FAIL: a free item changed the balance'; end if;
  if (select count(*) from public.member_items where user_id = skkit.uid(1)) <> 2 then raise exception 'FAIL: the free item was not given'; end if;
  raise notice 'OK 3: a free item can be taken';
end $$;

do $$
declare nothing uuid := gen_random_uuid(); t uuid;
begin
  perform skkit.as_user(1);
  perform skkit.must_fail('buying an item that does not exist', format('select public.buy_item(%L)', nothing), 'not for sale');
  reset role;

  perform skkit.as_server();
  insert into public.souk_items (slug, kind, name, price_kopeks) values ('test-retire', 'theme', 'Retire', 10) returning id into t;
  reset role;

  perform skkit.as_user(2);
  perform public.buy_item(t); -- bamba owns it before it is taken off sale
  reset role;

  perform skkit.as_server();
  update public.souk_items set is_active = false where id = t;
  reset role;

  perform skkit.as_user(1);
  perform skkit.must_fail('buying an item taken off sale', format('select public.buy_item(%L)', t), 'not for sale');
  reset role;

  perform skkit.as_user(2);
  if (select count(*) from public.member_items where item_id = t) <> 1 then raise exception 'FAIL: the owner lost an item taken off sale'; end if;
  perform public.equip_item(t); -- an owner can still wear it
  reset role;

  perform skkit.as_anon();
  perform skkit.must_fail('a visitor buys', format('select public.buy_item(%L)', skkit.item('exemple-cadre-feu')), 'permission denied');
  reset role;
  raise notice 'OK 4: unknown or retired items cannot be bought; owners keep them; visitors cannot buy';
end $$;

-- ---- 3. What you own is private -----------------------------------------------------------------
do $$
begin
  perform skkit.as_user(2);
  if (select count(*) from public.member_items where user_id = skkit.uid(1)) <> 0 then raise exception 'FAIL: a member sees what another owns'; end if;
  if (select count(*) from public.member_items) <> 1 then raise exception 'FAIL: bamba should see only her own item'; end if;
  reset role;
  perform skkit.as_anon();
  perform skkit.must_fail('a visitor reads what people own', 'select count(*) from public.member_items', 'permission denied');
  reset role;
  raise notice 'OK 5: what you own is private';
end $$;

-- ---- 4. Wearing items ---------------------------------------------------------------------------
do $$
declare frame uuid := skkit.item('exemple-cadre-or'); status uuid := skkit.item('exemple-statut-nouveau'); other uuid := skkit.item('exemple-cadre-feu');
begin
  perform skkit.as_user(1);
  perform skkit.must_fail('wearing an item you do not own', format('select public.equip_item(%L)', other), 'do not own');
  perform public.equip_item(frame);
  perform public.equip_item(status);
  if (select count(*) from public.equipped_items where user_id = skkit.uid(1)) <> 2 then raise exception 'FAIL: a frame and a status should be worn together'; end if;
  reset role;

  -- buying a second frame and wearing it replaces the first
  perform skkit.as_user(1);
  perform public.buy_item(other);
  perform public.equip_item(other);
  if (select count(*) from public.equipped_items where user_id = skkit.uid(1) and kind = 'avatar_frame') <> 1 then raise exception 'FAIL: only one frame can be worn'; end if;
  if (select item_id from public.equipped_items where user_id = skkit.uid(1) and kind = 'avatar_frame') <> other then raise exception 'FAIL: the new frame did not replace the old one'; end if;
  reset role;

  -- everyone sees what someone wears
  perform skkit.as_anon();
  if (select count(*) from public.equipped_items where user_id = skkit.uid(1)) <> 2 then raise exception 'FAIL: visitors should see what ana wears'; end if;
  reset role;

  perform skkit.as_user(1);
  perform public.unequip_item('avatar_frame');
  if (select count(*) from public.equipped_items where user_id = skkit.uid(1)) <> 1 then raise exception 'FAIL: unequip did not remove the frame'; end if;
  perform public.unequip_item('theme'); -- nothing worn there: harmless
  reset role;

  perform skkit.as_anon();
  perform skkit.must_fail('a visitor wears an item', format('select public.equip_item(%L)', frame), 'permission denied');
  reset role;
  raise notice 'OK 6: one item per kind can be worn; it is public; unwearing works';
end $$;

-- ---- 5. Nobody writes the tables directly ---------------------------------------------------------
do $$
declare frame uuid := skkit.item('exemple-cadre-or');
begin
  perform skkit.as_user(2);
  perform skkit.must_fail('giving yourself an item', format('insert into public.member_items (user_id, item_id, price_paid) values (%L, %L, 0)', skkit.uid(2), frame), 'permission denied');
  perform skkit.must_fail('wearing an item directly', format('insert into public.equipped_items (user_id, kind, item_id) values (%L, %L, %L)', skkit.uid(2), 'avatar_frame', frame), 'permission denied');
  perform skkit.must_fail('changing a price', format('update public.souk_items set price_kopeks = 0 where id = %L', frame), 'permission denied');
  perform skkit.must_fail('adding an item', $q$insert into public.souk_items (slug, kind, name, price_kopeks) values ('test-triche', 'theme', 'Triche', 0)$q$, 'permission denied');
  perform skkit.must_fail('editing your wallet', format('update public.wallets set kopeks = 99999 where user_id = %L', skkit.uid(2)), 'permission denied');
  reset role;
  raise notice 'OK 7: items, ownership and wearing can only change through the functions';
end $$;

-- ---- 6. Rules on the items themselves --------------------------------------------------------------
do $$
begin
  perform skkit.as_server();
  perform skkit.must_fail('negative price', $q$insert into public.souk_items (slug, kind, name, price_kopeks) values ('test-neg', 'theme', 'Neg', -5)$q$, 'check');
  perform skkit.must_fail('duplicate slug', $q$insert into public.souk_items (slug, kind, name, price_kopeks) values ('exemple-cadre-or', 'theme', 'Dup', 5)$q$, 'duplicate');
  perform skkit.must_fail('bad slug', $q$insert into public.souk_items (slug, kind, name, price_kopeks) values ('Mauvais Slug', 'theme', 'Bad', 5)$q$, 'check');
  perform skkit.must_fail('look that is not an object', $q$insert into public.souk_items (slug, kind, name, price_kopeks, data) values ('test-data', 'theme', 'Data', 5, '[1]')$q$, 'check');
  reset role;
  raise notice 'OK 8: items must have a sensible price, a clean address and a proper look';
end $$;

-- ---- Clean up -------------------------------------------------------------------------------------------
delete from public.profiles where id::text like 'a5a5a5a5-%';
delete from auth.users where id::text like 'a5a5a5a5-%';
delete from public.souk_items where slug like 'test-%';
drop schema skkit cascade;

do $$
begin
  if exists (select 1 from public.member_items) then raise exception 'FAIL: owned items left behind'; end if;
  if exists (select 1 from public.equipped_items) then raise exception 'FAIL: worn items left behind'; end if;
  if (select count(*) from public.souk_items) <> 6 then raise exception 'FAIL: the item list was changed'; end if;
  raise notice 'OK 9: the test left nothing behind';
end $$;

select 'ALL SOUK TESTS PASSED' as result;
