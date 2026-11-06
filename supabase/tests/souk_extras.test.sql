-- Tests for the Souk extras migration (ratings and theme of the week).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk_extras.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) and bara (...2) own items; coumba (...3) owns nothing;
-- dame (...4) is an admin; eli (...5) is a moderator.

create schema sxkit;
grant usage on schema sxkit to public;

create function sxkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('7c7c7c7c-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function sxkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', sxkit.uid(p_n)::text, true);
end $$;

create function sxkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function sxkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function sxkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function sxkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := sxkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function sxkit.item(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where slug = p_slug $$;

create function sxkit.week() returns date
language sql stable as $$ select date_trunc('week', current_date)::date $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (sxkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (sxkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (sxkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (sxkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (sxkit.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}');

insert into public.souk_items (slug, kind, name, price_kopeks, is_active, created_at) values
  ('sx-a', 'theme', 'Theme A', 10, true, now() - interval '3 days'),
  ('sx-b', 'avatar_frame', 'Cadre B', 20, true, now() - interval '2 days'),
  ('sx-c', 'status_badge', 'Statut C', 30, true, now() + interval '1 day'),
  ('sx-old', 'theme', 'Ancien', 5, false, now() + interval '2 days');

do $$
begin
  perform sxkit.as_server();
  perform public.make_admin(sxkit.uid(4));
  reset role;
  perform sxkit.as_user(4);
  perform public.set_moderator(sxkit.uid(5), true);
  reset role;
  -- ana owns A and B, bara owns A
  perform sxkit.as_user(1);
  perform public.buy_item(sxkit.item('sx-a'));
  perform public.buy_item(sxkit.item('sx-b'));
  reset role;
  perform sxkit.as_user(2);
  perform public.buy_item(sxkit.item('sx-a'));
  reset role;
end $$;

-- ---- 1. Only owners can rate ---------------------------------------------------------------------------------
do $$
declare a uuid := sxkit.item('sx-a'); b uuid := sxkit.item('sx-b');
begin
  perform sxkit.as_user(3);
  perform sxkit.must_fail('rating without owning', format('select public.rate_item(%L, 5)', a), 'only rate items you own');
  reset role;
  perform sxkit.as_user(2);
  perform sxkit.must_fail('rating an item you do not own', format('select public.rate_item(%L, 5)', b), 'only rate items you own');
  perform sxkit.must_fail('zero stars', format('select public.rate_item(%L, 0)', a), '1 to 5');
  perform sxkit.must_fail('six stars', format('select public.rate_item(%L, 6)', a), '1 to 5');
  perform sxkit.must_fail('no stars', format('select public.rate_item(%L, null)', a), '1 to 5');
  reset role;
  perform sxkit.as_anon();
  perform sxkit.must_fail('a visitor rates', format('select public.rate_item(%L, 5)', a), 'permission denied');
  reset role;
  if exists (select 1 from public.souk_ratings) then raise exception 'FAIL: a refused rating was saved'; end if;
  raise notice 'OK 1: only owners can rate, with 1 to 5 stars';
end $$;

-- ---- 2. Ratings, averages and privacy -------------------------------------------------------------------
do $$
declare a uuid := sxkit.item('sx-a');
begin
  perform sxkit.as_user(1);
  perform public.rate_item(a, 5);
  reset role;
  perform sxkit.as_user(2);
  perform public.rate_item(a, 3);
  reset role;
  if (select rating_count from public.souk_item_stats where item_id = a) <> 2 or (select rating_sum from public.souk_item_stats where item_id = a) <> 8 then
    raise exception 'FAIL: two ratings, sum 8 expected';
  end if;

  perform sxkit.as_user(1);
  perform public.rate_item(a, 4); -- changing a rating does not add one
  reset role;
  if (select rating_count from public.souk_item_stats where item_id = a) <> 2 or (select rating_sum from public.souk_item_stats where item_id = a) <> 7 then
    raise exception 'FAIL: changing a rating should keep the count and fix the sum';
  end if;

  perform sxkit.as_user(2);
  if (select count(*) from public.souk_ratings) <> 1 then raise exception 'FAIL: a member should see only her own rating'; end if;
  perform public.remove_rating(a);
  perform public.remove_rating(a); -- nothing left: harmless
  reset role;
  if (select rating_count from public.souk_item_stats where item_id = a) <> 1 or (select rating_sum from public.souk_item_stats where item_id = a) <> 4 then
    raise exception 'FAIL: removing a rating should update the counts';
  end if;

  perform sxkit.as_anon();
  if (select rating_count from public.souk_item_stats where item_id = a) <> 1 then raise exception 'FAIL: counts are public'; end if;
  perform sxkit.must_fail('a visitor reads who rated', 'select count(*) from public.souk_ratings', 'permission denied');
  reset role;

  perform sxkit.as_user(3);
  perform sxkit.must_fail('writing a rating directly', format('insert into public.souk_ratings (item_id, user_id, stars) values (%L, %L, 5)', a, sxkit.uid(3)), 'permission denied');
  perform sxkit.must_fail('editing the counts', format('update public.souk_item_stats set rating_sum = 999 where item_id = %L', a), 'permission denied');
  reset role;
  raise notice 'OK 2: ratings count once per member, can change and be removed; who rated is private';
end $$;

-- ---- 3. The shop list ---------------------------------------------------------------------------------------------
do $$
declare a uuid := sxkit.item('sx-a'); b uuid := sxkit.item('sx-b');
begin
  perform sxkit.as_user(1);
  perform public.rate_item(b, 2);
  -- A has one rating of 4, B has one rating of 2, C has none
  if (select avg_rating from public.souk_shop() where slug = 'sx-a') <> 4.00 then raise exception 'FAIL: average of A'; end if;
  if (select avg_rating from public.souk_shop() where slug = 'sx-c') is not null then raise exception 'FAIL: an unrated item has no average'; end if;
  if (select rating_count from public.souk_shop() where slug = 'sx-c') <> 0 then raise exception 'FAIL: unrated count should be 0'; end if;
  if (select owned from public.souk_shop() where slug = 'sx-a') is not true or (select owned from public.souk_shop() where slug = 'sx-c') is not false then raise exception 'FAIL: owned flags'; end if;
  if (select my_rating from public.souk_shop() where slug = 'sx-a') <> 4 then raise exception 'FAIL: my_rating'; end if;
  if (select my_rating from public.souk_shop() where slug = 'sx-c') is not null then raise exception 'FAIL: no rating of mine on C'; end if;
  if exists (select 1 from public.souk_shop() where slug = 'sx-old') then raise exception 'FAIL: an item off sale is listed'; end if;
  if (select array_agg(slug order by price_kopeks) from public.souk_shop() where slug like 'sx-%') <> array['sx-a', 'sx-b', 'sx-c'] then raise exception 'FAIL: test items missing'; end if;
  if (select array_agg(slug) from public.souk_shop(null, 'price_asc', 50) where slug like 'sx-%') <> array['sx-a', 'sx-b', 'sx-c'] then raise exception 'FAIL: price ascending'; end if;
  if (select array_agg(slug) from public.souk_shop(null, 'price_desc', 50) where slug like 'sx-%') <> array['sx-c', 'sx-b', 'sx-a'] then raise exception 'FAIL: price descending'; end if;
  if (select array_agg(slug) from public.souk_shop(null, 'rating', 50) where slug like 'sx-%') <> array['sx-a', 'sx-b', 'sx-c'] then raise exception 'FAIL: best rated first, unrated last: %', (select array_agg(slug) from public.souk_shop(null, 'rating', 50) where slug like 'sx-%'); end if;
  if (select array_agg(slug) from public.souk_shop(null, 'new', 50) where slug like 'sx-%') <> array['sx-c', 'sx-b', 'sx-a'] then raise exception 'FAIL: newest first'; end if;
  if (select count(*) from public.souk_shop('avatar_frame') where slug like 'sx-%') <> 1 then raise exception 'FAIL: kind filter'; end if;
  if (select count(*) from public.souk_shop(null, 'new', 0)) <> 1 then raise exception 'FAIL: limit 0 becomes 1'; end if;
  if (select count(*) from public.souk_shop(null, 'new', 1000)) > 50 then raise exception 'FAIL: limit capped at 50'; end if;
  perform sxkit.must_fail('an unknown sort', $q$select * from public.souk_shop(null, 'random')$q$, 'Unknown sort');
  reset role;

  perform sxkit.as_anon();
  if (select owned from public.souk_shop() where slug = 'sx-a') is not false then raise exception 'FAIL: a visitor owns nothing'; end if;
  if (select my_rating from public.souk_shop() where slug = 'sx-a') is not null then raise exception 'FAIL: a visitor has no rating'; end if;
  if (select avg_rating from public.souk_shop() where slug = 'sx-a') <> 4.00 then raise exception 'FAIL: visitors see the averages'; end if;
  reset role;
  raise notice 'OK 3: the shop list shows averages, ownership and my rating, sorts and filters correctly';
end $$;

-- ---- 4. Theme of the week -------------------------------------------------------------------------------------
do $$
declare a uuid := sxkit.item('sx-a'); b uuid := sxkit.item('sx-b'); old uuid := sxkit.item('sx-old');
begin
  perform sxkit.as_anon();
  if (select slug from public.featured_item()) <> 'sx-c' then raise exception 'FAIL: the newest item on sale should be featured by default, got %', (select slug from public.featured_item()); end if;
  if (select source from public.featured_item()) <> 'automatic' then raise exception 'FAIL: source should be automatic'; end if;
  reset role;

  perform sxkit.as_user(5);
  perform sxkit.must_fail('a moderator picks', format('select public.set_featured_item(%L)', a), 'Only an admin');
  perform sxkit.must_fail('a moderator clears', 'select public.clear_featured_item()', 'Only an admin');
  reset role;
  perform sxkit.as_user(1);
  perform sxkit.must_fail('a member picks', format('select public.set_featured_item(%L)', a), 'Only an admin');
  reset role;
  perform sxkit.as_anon();
  perform sxkit.must_fail('a visitor picks', format('select public.set_featured_item(%L)', a), 'permission denied');
  reset role;

  perform sxkit.as_user(4);
  perform sxkit.must_fail('an item off sale', format('select public.set_featured_item(%L)', old), 'not for sale');
  perform sxkit.must_fail('an unknown item', format('select public.set_featured_item(%L)', gen_random_uuid()), 'not for sale');
  perform sxkit.must_fail('a past week', format('select public.set_featured_item(%L, current_date - 8)', a), 'this week or a later one');
  perform sxkit.must_fail('too far ahead', format('select public.set_featured_item(%L, current_date + 400)', a), 'within the next year');
  perform sxkit.must_fail('clearing a past week', 'select public.clear_featured_item(current_date - 8)', 'this week or a later one');
  perform public.set_featured_item(a);
  perform public.set_featured_item(a); -- same again: nothing changes
  reset role;

  perform sxkit.as_anon();
  if (select slug from public.featured_item()) <> 'sx-a' or (select source from public.featured_item()) <> 'chosen' then raise exception 'FAIL: the chosen item should be featured'; end if;
  if (select week_start from public.featured_item()) <> sxkit.week() then raise exception 'FAIL: week should start on Monday'; end if;
  if (select avg_rating from public.featured_item()) <> 4.00 or (select rating_count from public.featured_item()) <> 1 then raise exception 'FAIL: the featured item should show its rating'; end if;
  reset role;

  perform sxkit.as_user(4);
  perform public.set_featured_item(b); -- replaces A
  perform public.set_featured_item(a, current_date + 7); -- next week
  reset role;
  if (select count(*) from public.souk_featured where item_id in (a, b)) <> 2 then raise exception 'FAIL: this week and next week should each have a pick'; end if;
  if (select item_id from public.souk_featured where week_start = sxkit.week()) <> b then raise exception 'FAIL: B should replace A this week'; end if;
  if (select count(*) from public.admin_audit_log where action = 'souk_featured_set' and target_id = a::text) <> 2 then raise exception 'FAIL: A was chosen twice (this week, then next) and logged once each: %', (select count(*) from public.admin_audit_log where action = 'souk_featured_set' and target_id = a::text); end if;
  if (select count(*) from public.admin_audit_log where action = 'souk_featured_set' and target_id = b::text) <> 1 then raise exception 'FAIL: B logged once'; end if;

  -- an item taken off sale falls back to the automatic pick
  perform sxkit.as_server();
  update public.souk_items set is_active = false where id = b;
  reset role;
  perform sxkit.as_anon();
  if (select source from public.featured_item()) <> 'automatic' or (select slug from public.featured_item()) <> 'sx-c' then raise exception 'FAIL: a retired featured item should fall back'; end if;
  reset role;
  perform sxkit.as_server();
  update public.souk_items set is_active = true where id = b;
  reset role;
  raise notice 'OK 4: admins choose the item of the week; otherwise the newest item is shown; every change is logged once';
end $$;

-- ---- 5. The staff schedule and clearing ------------------------------------------------------------------
do $$
declare a uuid := sxkit.item('sx-a'); b uuid := sxkit.item('sx-b');
begin
  perform sxkit.as_user(1);
  perform sxkit.must_fail('a member lists the schedule', 'select * from public.list_featured_schedule()', 'Only staff');
  reset role;
  perform sxkit.as_user(5);
  if (select count(*) from public.list_featured_schedule()) <> 8 then raise exception 'FAIL: 8 weeks by default'; end if;
  if (select count(*) from public.list_featured_schedule(0)) <> 1 then raise exception 'FAIL: 0 weeks becomes 1'; end if;
  if (select count(*) from public.list_featured_schedule(1000)) <> 52 then raise exception 'FAIL: capped at 52 weeks'; end if;
  if (select slug from public.list_featured_schedule(2) where week_start = sxkit.week()) <> 'sx-b' or (select source from public.list_featured_schedule(2) where week_start = sxkit.week()) <> 'chosen' then raise exception 'FAIL: this week should show the chosen item'; end if;
  if (select slug from public.list_featured_schedule(2) where week_start = sxkit.week() + 7) <> 'sx-a' then raise exception 'FAIL: next week should show A'; end if;
  if (select source from public.list_featured_schedule(3) where week_start = sxkit.week() + 14) <> 'automatic' or (select slug from public.list_featured_schedule(3) where week_start = sxkit.week() + 14) <> 'sx-c' then raise exception 'FAIL: an empty week shows the automatic pick'; end if;
  reset role;

  perform sxkit.as_user(4);
  perform public.clear_featured_item();
  perform public.clear_featured_item(); -- nothing left: harmless
  perform public.clear_featured_item(current_date + 7);
  reset role;
  if exists (select 1 from public.souk_featured) then raise exception 'FAIL: the picks were not cleared'; end if;
  if (select count(*) from public.admin_audit_log where action = 'souk_featured_cleared' and target_id = b::text) <> 1 then raise exception 'FAIL: clearing B should be logged once'; end if;
  if (select count(*) from public.admin_audit_log where action = 'souk_featured_cleared' and target_id = a::text) <> 1 then raise exception 'FAIL: clearing A should be logged once'; end if;
  if (select count(*) from public.admin_audit_log where action = 'souk_featured_cleared' and target_id in (a::text, b::text)) <> 2 then raise exception 'FAIL: only the two real clearings should be logged'; end if;
  perform sxkit.as_anon();
  if (select source from public.featured_item()) <> 'automatic' then raise exception 'FAIL: back to the automatic pick'; end if;
  reset role;
  raise notice 'OK 5: staff see the coming weeks; clearing works and is logged once';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.profiles where id::text like '7c7c7c7c-%';
delete from auth.users where id::text like '7c7c7c7c-%';
delete from public.souk_items where slug like 'sx-%';
drop schema sxkit cascade;

do $$
begin
  if exists (select 1 from public.souk_ratings) or exists (select 1 from public.souk_item_stats) or exists (select 1 from public.souk_featured) then
    raise exception 'FAIL: ratings or picks left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select count(*) from public.souk_items) <> 6 then raise exception 'FAIL: the item list was changed'; end if;
  raise notice 'OK 6: the test left nothing behind';
end $$;

select 'ALL SOUK EXTRAS TESTS PASSED' as result;
