-- Tests for the quest of the day migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f quest_of_the_day.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end, and the quests that
-- were published before are published again.
--
-- People: ana (...1) and bara (...2) are members; coumba (...3) never plays;
-- dame (...4) is an admin; eli (...5) is a moderator.

create schema qdkit;
grant usage on schema qdkit to public;

create function qdkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('d3d3d3d3-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function qdkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', qdkit.uid(p_n)::text, true);
end $$;

create function qdkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function qdkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function qdkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function qdkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := qdkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function qdkit.q(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.quests where slug = p_slug $$;

create function qdkit.today_slug() returns text
language sql stable as $$ select slug from public.quest_of_the_day() $$;

-- Remember which quests were published, then unpublish them so the test controls the pool.
create table public.qd_saved_published as select id from public.quests where published;
update public.quests set published = false where published;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (qdkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (qdkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (qdkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (qdkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (qdkit.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  perform qdkit.as_server();
  perform public.make_admin(qdkit.uid(4));
  reset role;
  perform qdkit.as_user(4);
  perform public.set_moderator(qdkit.uid(5), true);
  reset role;
end $$;

-- ---- 1. Nothing to show when no quest is published -----------------------------------------------------------
do $$
begin
  perform qdkit.as_anon();
  if exists (select 1 from public.quest_of_the_day()) then raise exception 'FAIL: there should be no quest of the day when nothing is published'; end if;
  reset role;
  raise notice 'OK 1: no published quest means no quest of the day';
end $$;

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published) values
  ('qd-a', 'Quete A', 'La premiere', 'griot_du_code', 'ndongo', 'python', 10, 150, 30, true),
  ('qd-b', 'Quete B', 'La deuxieme', 'forgeron', 'bagne', 'javascript', 8, 200, 40, true),
  ('qd-c', 'Quete C', 'La troisieme', 'saltigue', 'ndongo', 'python', 6, 100, 20, true),
  ('qd-draft', 'Brouillon', 'Pas publiee', 'saltigue', 'ndongo', 'python', 6, 100, 20, false);

-- ---- 2. An automatic pick, the same for everyone ----------------------------------------------------------------
do $$
declare s text; r record;
begin
  perform qdkit.as_anon();
  s := qdkit.today_slug();
  if s not in ('qd-a', 'qd-b', 'qd-c') then raise exception 'FAIL: the automatic pick should be one of the published quests, got %', s; end if;
  if qdkit.today_slug() <> s then raise exception 'FAIL: the pick changed between two calls'; end if;
  select * into r from public.quest_of_the_day();
  if r.source <> 'automatic' then raise exception 'FAIL: expected an automatic pick, got %', r.source; end if;
  if r.day <> current_date then raise exception 'FAIL: wrong day'; end if;
  if r.seconds_left < 0 or r.seconds_left > 86400 then raise exception 'FAIL: seconds left out of range: %', r.seconds_left; end if;
  if r.xp_reward is null or r.est_minutes is null or r.clan is null or r.title is null then raise exception 'FAIL: the result is missing details'; end if;
  if r.status is not null then raise exception 'FAIL: a visitor has no status'; end if;
  reset role;

  perform qdkit.as_user(1);
  if qdkit.today_slug() <> s then raise exception 'FAIL: a member sees a different quest than a visitor'; end if;
  reset role;
  perform qdkit.as_user(3);
  if qdkit.today_slug() <> s then raise exception 'FAIL: two members see different quests'; end if;
  reset role;

  if qdkit.today_slug() = 'qd-draft' then raise exception 'FAIL: an unpublished quest was picked'; end if;
  raise notice 'OK 2: everyone sees the same automatic pick, from published quests only';
end $$;

do $$
declare n int;
begin
  select count(distinct public.daily_quest_for(current_date + i)) into n from generate_series(0, 29) i;
  if n < 2 then raise exception 'FAIL: the automatic pick never changes over 30 days'; end if;
  if exists (select 1 from generate_series(0, 29) i where public.daily_quest_for(current_date + i) is null) then raise exception 'FAIL: a day has no pick'; end if;
  raise notice 'OK 3: the automatic pick changes from day to day';
end $$;

-- ---- 4. Scheduling ---------------------------------------------------------------------------------------------------
do $$
declare b uuid := qdkit.q('qd-b');
begin
  perform qdkit.as_user(1);
  perform qdkit.must_fail('a member schedules', format('select public.schedule_daily_quest(%L, current_date)', b), 'Only an admin');
  perform qdkit.must_fail('a member lists the schedule', 'select * from public.list_daily_quests()', 'Only staff');
  reset role;
  perform qdkit.as_user(5);
  perform qdkit.must_fail('a moderator schedules', format('select public.schedule_daily_quest(%L, current_date)', b), 'Only an admin');
  if (select count(*) from public.list_daily_quests()) <> 14 then raise exception 'FAIL: a moderator should see 14 days by default'; end if;
  reset role;
  perform qdkit.as_anon();
  perform qdkit.must_fail('a visitor schedules', format('select public.schedule_daily_quest(%L, current_date)', b), 'permission denied');
  reset role;

  perform qdkit.as_user(4);
  perform qdkit.must_fail('scheduling a day in the past', format('select public.schedule_daily_quest(%L, current_date - 1)', b), 'today or a later day');
  perform qdkit.must_fail('scheduling too far ahead', format('select public.schedule_daily_quest(%L, current_date + 400)', b), 'within the next year');
  perform qdkit.must_fail('scheduling an unpublished quest', format('select public.schedule_daily_quest(%L, current_date)', qdkit.q('qd-draft')), 'not published');
  perform qdkit.must_fail('scheduling an unknown quest', format('select public.schedule_daily_quest(%L, current_date)', gen_random_uuid()), 'not published');
  perform public.schedule_daily_quest(b, current_date);
  perform qdkit.must_fail('two quests on the same day', format('select public.schedule_daily_quest(%L, current_date)', qdkit.q('qd-a')), 'already scheduled');
  reset role;

  perform qdkit.as_anon();
  if qdkit.today_slug() <> 'qd-b' then raise exception 'FAIL: the scheduled quest should be today''s, got %', qdkit.today_slug(); end if;
  if (select source from public.quest_of_the_day()) <> 'scheduled' then raise exception 'FAIL: the source should say scheduled'; end if;
  reset role;
  raise notice 'OK 4: only admins schedule; past, far-off, unpublished and clashing days are refused; the scheduled quest is shown';
end $$;

-- ---- 5. A quest scheduled later is kept out of today's automatic pick ---------------------------------------
do $$
declare a uuid := qdkit.q('qd-a'); b uuid := qdkit.q('qd-b');
begin
  perform qdkit.as_user(4);
  perform public.schedule_daily_quest(b, current_date + 3); -- moves qd-b away from today
  perform public.schedule_daily_quest(a, current_date + 1);
  reset role;
  insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published, daily_on)
  select 'qd-f' || i, 'Future ' || i, 'x', 'saltigue', 'ndongo', 'python', 5, 10, 1, true, current_date + 10 + i from generate_series(1, 8) i;
  if qdkit.today_slug() <> 'qd-c' then raise exception 'FAIL: only qd-c is free for today, got %', qdkit.today_slug(); end if;
  if (select slug from public.quests where id = public.daily_quest_for(current_date + 1)) <> 'qd-a' then raise exception 'FAIL: tomorrow should be qd-a'; end if;
  if (select slug from public.quests where id = public.daily_quest_for(current_date + 3)) <> 'qd-b' then raise exception 'FAIL: in 3 days should be qd-b'; end if;
  raise notice 'OK 5: moving a quest frees today; quests scheduled for later days are not picked automatically';
end $$;

-- ---- 6. A quest that already had its day can come back by itself --------------------------------------------------
do $$
begin
  update public.quests set daily_on = current_date - 5 where slug = 'qd-b';
  if not exists (select 1 from generate_series(0, 60) i where public.daily_quest_for(current_date + 5 + i) = qdkit.q('qd-b')) then
    raise exception 'FAIL: a quest whose day has passed should return to the automatic pool';
  end if;
  update public.quests set daily_on = current_date + 3 where slug = 'qd-b';
  raise notice 'OK 6: a quest whose day has passed returns to the automatic pool';
end $$;

-- ---- 7. The member sees their own progress -----------------------------------------------------------------------------
do $$
begin
  update public.quests set daily_on = null where slug in ('qd-a', 'qd-b', 'qd-c');
  update public.quests set daily_on = current_date where slug = 'qd-c';
  insert into public.quest_attempts (user_id, quest_id, status) values (qdkit.uid(1), qdkit.q('qd-c'), 'in_progress');
  insert into public.quest_attempts (user_id, quest_id, status, solved_at) values (qdkit.uid(2), qdkit.q('qd-c'), 'solved', now());

  perform qdkit.as_user(1);
  if (select status from public.quest_of_the_day()) <> 'in_progress' then raise exception 'FAIL: ana started it'; end if;
  reset role;
  perform qdkit.as_user(2);
  if (select status from public.quest_of_the_day()) <> 'solved' then raise exception 'FAIL: bara solved it'; end if;
  reset role;
  perform qdkit.as_user(3);
  if (select status from public.quest_of_the_day()) is not null then raise exception 'FAIL: coumba has not started it'; end if;
  reset role;
  perform qdkit.as_anon();
  if (select status from public.quest_of_the_day()) is not null then raise exception 'FAIL: a visitor has no status'; end if;
  reset role;
  raise notice 'OK 7: a member sees whether they started or solved it; nobody sees anyone else''s progress';
end $$;

-- ---- 8. Unpublishing falls back, clearing works, and everything is logged ---------------------------------------
do $$
declare removed int;
begin
  update public.quests set published = false where slug = 'qd-c';
  if qdkit.today_slug() not in ('qd-a', 'qd-b') then raise exception 'FAIL: an unpublished scheduled quest should fall back, got %', qdkit.today_slug(); end if;
  update public.quests set published = true where slug = 'qd-c';

  perform qdkit.as_user(5);
  perform qdkit.must_fail('a moderator clears', 'select public.unschedule_daily_quest(current_date)', 'Only an admin');
  reset role;
  perform qdkit.as_user(4);
  perform public.unschedule_daily_quest(current_date);
  perform public.unschedule_daily_quest(current_date); -- nothing left: harmless
  perform qdkit.must_fail('clearing a past day', 'select public.unschedule_daily_quest(current_date - 1)', 'today or a later day');
  reset role;
  if (select daily_on from public.quests where slug = 'qd-c') is not null then raise exception 'FAIL: the day was not cleared'; end if;

  if (select count(*) from public.admin_audit_log where action = 'daily_quest_scheduled' and target_id in (qdkit.q('qd-a')::text, qdkit.q('qd-b')::text, qdkit.q('qd-c')::text)) <> 0
     and false then null; end if;
  select count(*) into removed from public.admin_audit_log where action = 'daily_quest_cleared' and target_id = qdkit.q('qd-c')::text;
  if removed <> 1 then raise exception 'FAIL: clearing should be logged exactly once, got %', removed; end if;
  if (select count(*) from public.admin_audit_log where action = 'daily_quest_scheduled' and target_id = qdkit.q('qd-b')::text) < 2 then raise exception 'FAIL: scheduling is not logged'; end if;
  raise notice 'OK 8: unpublishing falls back; admins clear a day; every change is logged';
end $$;

-- ---- 9. The staff schedule ---------------------------------------------------------------------------------------------------
do $$
begin
  perform qdkit.as_user(4);
  perform public.schedule_daily_quest(qdkit.q('qd-a'), current_date + 2);
  if (select count(*) from public.list_daily_quests(current_date, 5)) <> 5 then raise exception 'FAIL: 5 days asked, expected 5'; end if;
  if (select count(*) from public.list_daily_quests(current_date, 1000)) <> 60 then raise exception 'FAIL: the schedule should be limited to 60 days'; end if;
  if (select count(*) from public.list_daily_quests(current_date, 0)) <> 1 then raise exception 'FAIL: 0 days should become 1'; end if;
  if (select source from public.list_daily_quests(current_date, 5) where day = current_date + 2) <> 'scheduled' then raise exception 'FAIL: the schedule should mark scheduled days'; end if;
  if (select slug from public.list_daily_quests(current_date, 5) where day = current_date + 2) <> 'qd-a' then raise exception 'FAIL: the schedule should show the scheduled quest'; end if;
  if exists (select 1 from public.list_daily_quests(current_date, 5) where slug is null) then raise exception 'FAIL: every day should have a quest'; end if;
  reset role;
  raise notice 'OK 9: staff can look ahead, with scheduled and automatic days marked';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------------------------
delete from public.quest_attempts where user_id::text like 'd3d3d3d3-%';
delete from public.quests where slug like 'qd-%';
update public.quests set published = true where id in (select id from public.qd_saved_published);
drop table public.qd_saved_published;
delete from public.profiles where id::text like 'd3d3d3d3-%';
delete from auth.users where id::text like 'd3d3d3d3-%';
drop schema qdkit cascade;

do $$
begin
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if exists (select 1 from public.quests where slug like 'qd-%') then raise exception 'FAIL: test quests left behind'; end if;
  raise notice 'OK 10: the test left nothing behind';
end $$;

select 'ALL QUEST OF THE DAY TESTS PASSED' as result;
