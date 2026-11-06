-- Tests for the streak and activity extras.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f streaks.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) plays; bara (...2) keeps a short streak; coumba (...3) lost hers.

create schema stkit;
grant usage on schema stkit to public;

create function stkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('c1c1c1c1-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function stkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', stkit.uid(p_n)::text, true);
end $$;

create function stkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function stkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function stkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function stkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := stkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function stkit.solve(p_n int) returns integer
language plpgsql as $$
declare v integer;
begin
  perform stkit.as_server();
  v := public.bump_streak(stkit.uid(p_n));
  reset role;
  return v;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (stkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (stkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (stkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. A new member -----------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform stkit.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 0 or r.longest_streak <> 0 or r.done_today or r.at_risk then raise exception 'FAIL: a new member has no streak'; end if;
  if r.chest_every <> 7 or r.chest_kopeks <> 100 or r.next_chest_in <> 7 then raise exception 'FAIL: chest info for a new member: % % %', r.chest_every, r.chest_kopeks, r.next_chest_in; end if;
  if r.last_active_on is not null then raise exception 'FAIL: no activity yet'; end if;
  perform stkit.must_fail('reading someone''s streak status directly', format('select * from public.streak_status(%L)', stkit.uid(2)), 'permission denied');
  reset role;
  perform stkit.as_anon();
  perform stkit.must_fail('a visitor asks for their streak', 'select * from public.my_streak()', 'permission denied');
  reset role;
  raise notice 'OK 1: a new member starts at zero with 7 days to the first chest';
end $$;

-- ---- 2. The first solve and the calendar -------------------------------------------------------------------
do $$
declare r record;
begin
  if stkit.solve(1) <> 1 then raise exception 'FAIL: first solve should give a streak of 1'; end if;
  if stkit.solve(1) <> 1 then raise exception 'FAIL: a second solve the same day keeps the streak at 1'; end if;
  perform stkit.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 1 or r.longest_streak <> 1 or not r.done_today or r.at_risk or r.next_chest_in <> 6 then
    raise exception 'FAIL: after solving today: % % % % %', r.current_streak, r.longest_streak, r.done_today, r.at_risk, r.next_chest_in;
  end if;
  if (select quests_solved from public.activity_calendar(stkit.uid(1), 7) where day = current_date) <> 2 then raise exception 'FAIL: two solves today expected in the calendar'; end if;
  reset role;
  raise notice 'OK 2: the first solve starts the streak and the calendar; a second one the same day only adds to the calendar';
end $$;

-- ---- 3. A streak that is alive but at risk -----------------------------------------------------------------
do $$
declare r record;
begin
  update public.profiles set streak_days = 5, longest_streak = 5, last_active_on = current_date - 1 where id = stkit.uid(1);
  perform stkit.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 5 or r.done_today or not r.at_risk or r.next_chest_in <> 2 then
    raise exception 'FAIL: an alive streak not yet done today: % % % %', r.current_streak, r.done_today, r.at_risk, r.next_chest_in;
  end if;
  reset role;
  if stkit.solve(1) <> 6 then raise exception 'FAIL: solving continues the streak'; end if;
  if (select longest_streak from public.profiles where id = stkit.uid(1)) <> 6 then raise exception 'FAIL: the longest streak should follow'; end if;
  raise notice 'OK 3: yesterday''s streak is alive and at risk until today''s solve';
end $$;

-- ---- 4. A streak that was lost -----------------------------------------------------------------------------------
do $$
declare r record;
begin
  update public.profiles set streak_days = 9, longest_streak = 9, last_active_on = current_date - 3 where id = stkit.uid(3);
  perform stkit.as_user(3);
  select * into r from public.my_streak();
  if r.current_streak <> 0 or r.longest_streak <> 9 or r.at_risk or r.done_today or r.next_chest_in <> 7 then
    raise exception 'FAIL: a lapsed streak should read 0 with the best kept: % % % % %', r.current_streak, r.longest_streak, r.at_risk, r.done_today, r.next_chest_in;
  end if;
  reset role;
  if stkit.solve(3) <> 1 then raise exception 'FAIL: a new chain starts at 1'; end if;
  if (select longest_streak from public.profiles where id = stkit.uid(3)) <> 9 then raise exception 'FAIL: the longest streak must not drop'; end if;
  update public.profiles set streak_days = 10, last_active_on = current_date - 3 where id = stkit.uid(3); -- lapsed again, for the ranking test
  raise notice 'OK 4: a lapsed streak shows 0, the best one is kept, and a new chain starts at 1';
end $$;

-- ---- 5. The chest ---------------------------------------------------------------------------------------------------
do $$
declare before_k bigint; r record;
begin
  update public.profiles set streak_days = 6, last_active_on = current_date - 1 where id = stkit.uid(1);
  select kopeks into before_k from public.wallets where user_id = stkit.uid(1);
  if stkit.solve(1) <> 7 then raise exception 'FAIL: day 7'; end if;
  perform stkit.solve(1); -- again the same day: no second chest
  if (select kopeks from public.wallets where user_id = stkit.uid(1)) <> before_k + 100 then raise exception 'FAIL: the chest should pay 100 Kopeks once'; end if;
  if (select count(*) from public.kopek_transactions where user_id = stkit.uid(1) and reason = 'streak_chest') <> 1 then raise exception 'FAIL: one chest payment expected'; end if;
  perform stkit.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 7 or r.next_chest_in <> 7 or not r.done_today then raise exception 'FAIL: after the chest, 7 more days: % %', r.current_streak, r.next_chest_in; end if;
  reset role;
  raise notice 'OK 5: the chest pays once on day 7 and the count to the next one restarts';
end $$;

-- ---- 6. Top streaks -----------------------------------------------------------------------------------------------
do $$
begin
  update public.profiles set streak_days = 3, longest_streak = 3, last_active_on = current_date - 1 where id = stkit.uid(2);
  perform stkit.as_anon();
  if (select array_agg(user_id order by current_streak desc) from public.top_streaks(50) where user_id::text like 'c1c1c1c1-%') <> array[stkit.uid(1), stkit.uid(2)] then
    raise exception 'FAIL: ana (7) then bara (3), and not coumba whose streak is over: %', (select array_agg(user_id) from public.top_streaks(50) where user_id::text like 'c1c1c1c1-%');
  end if;
  if (select count(*) from public.top_streaks(0)) > 1 then raise exception 'FAIL: limit 0 becomes 1'; end if;
  if (select count(*) from public.top_streaks(1000)) > 50 then raise exception 'FAIL: limit capped at 50'; end if;
  reset role;
  raise notice 'OK 6: top streaks are public, ordered, and leave out lapsed streaks';
end $$;

-- ---- 7. Calendar windows --------------------------------------------------------------------------------------------
do $$
begin
  insert into public.member_activity_days (user_id, day, quests_solved) values
    (stkit.uid(2), current_date - 1, 1), (stkit.uid(2), current_date - 10, 3),
    (stkit.uid(2), current_date - 100, 1), (stkit.uid(2), current_date - 400, 1), (stkit.uid(2), current_date + 1, 1)
  on conflict do nothing;
  perform stkit.as_anon();
  if (select count(*) from public.activity_calendar(stkit.uid(2), 5)) <> 1 then raise exception 'FAIL: 5 days should show only yesterday'; end if;
  if (select count(*) from public.activity_calendar(stkit.uid(2))) <> 2 then raise exception 'FAIL: the default 90 days should show 2 days'; end if;
  if (select count(*) from public.activity_calendar(stkit.uid(2), 1000)) <> 3 then raise exception 'FAIL: up to a year back should show 3 days, not older ones'; end if;
  if (select count(*) from public.activity_calendar(stkit.uid(2), 0)) <> 0 then raise exception 'FAIL: 0 days becomes 1 (today), where bara did nothing'; end if;
  if exists (select 1 from public.activity_calendar(stkit.uid(2), 1000) where day > current_date) then raise exception 'FAIL: no future days'; end if;
  if (select array_agg(day) from public.activity_calendar(stkit.uid(2), 90)) <> array[current_date - 10, current_date - 1] then raise exception 'FAIL: oldest first'; end if;
  perform stkit.must_fail('a visitor writes a day', format('insert into public.member_activity_days (user_id, day) values (%L, current_date)', stkit.uid(2)), 'permission denied');
  reset role;
  perform stkit.as_user(2);
  perform stkit.must_fail('a member writes a day', format('insert into public.member_activity_days (user_id, day) values (%L, current_date - 50)', stkit.uid(2)), 'permission denied');
  reset role;
  raise notice 'OK 7: the calendar is public, limited to a window, and only the server writes it';
end $$;

-- ---- 8. Nobody edits their own streak -------------------------------------------------------------------------
do $$
begin
  perform stkit.as_user(2);
  perform stkit.must_fail('editing the longest streak', format('update public.profiles set longest_streak = 99 where id = %L', stkit.uid(2)), 'permission denied');
  perform stkit.must_fail('editing the streak', format('update public.profiles set streak_days = 99 where id = %L', stkit.uid(2)), 'permission denied');
  reset role;
  perform stkit.as_anon();
  if (select longest_streak from public.profiles where id = stkit.uid(1)) < 7 then raise exception 'FAIL: the longest streak should be public on the profile'; end if;
  reset role;
  raise notice 'OK 8: streaks cannot be edited by members; the longest streak is public';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------
delete from public.profiles where id::text like 'c1c1c1c1-%';
delete from auth.users where id::text like 'c1c1c1c1-%';
drop schema stkit cascade;

do $$
begin
  if exists (select 1 from public.member_activity_days where user_id::text like 'c1c1c1c1-%') then raise exception 'FAIL: calendar days left behind'; end if;
  raise notice 'OK 9: the test left nothing behind';
end $$;

select 'ALL STREAK TESTS PASSED' as result;
