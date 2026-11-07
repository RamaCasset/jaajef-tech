-- Tests for the quest arena rule: only the quest of the day pays, on its day (behind a switch).
-- Run AFTER all migrations. Everything created here is deleted at the end.
-- People: ana (1), bara (2), coumba (3). Quests: ar-today (the quest of the day), ar-old (not the quest of the day).
create schema if not exists tg;
create or replace function tg.submit_quest(p_quest uuid, p_code text, p_passed integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public.record_graded_attempt(auth.uid(), p_quest, p_code, p_passed, p_total); end $$;
grant usage on schema tg to authenticated, anon, service_role;
grant execute on function tg.submit_quest(uuid, text, integer, integer) to authenticated, anon, service_role;

create schema arn;
grant usage on schema arn to public;

create function arn.uid(p_n int) returns uuid language sql immutable as $$ select ('a7a7a7a7-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function arn.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', arn.uid(p_n)::text, true);
end $$;
create function arn.as_anon() returns void language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function arn.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function arn.set_switch(p_value text) returns void language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = 'quests_pay_only_on_their_day';
  reset role;
end $$;
create function arn.quest(p_slug text) returns uuid language sql stable security definer as $$ select id from public.quests where slug = p_slug $$;
create function arn.xp(p_n int) returns bigint language sql stable security definer as $$ select xp from public.profiles where id = arn.uid(p_n) $$;
create function arn.streak(p_n int) returns integer language sql stable security definer as $$ select streak_days from public.profiles where id = arn.uid(p_n) $$;
create function arn.solve(p_n int, p_slug text) returns jsonb language plpgsql as $$
declare q uuid := arn.quest(p_slug); r jsonb;
begin
  perform arn.as_user(p_n);
  perform public.start_quest(q);
  reset role;
  update public.quest_attempts set started_at = now() - interval '2 minutes' where user_id = arn.uid(p_n) and quest_id = q;
  perform arn.as_user(p_n);
  r := tg.submit_quest(q, 'solution', 1, 1);
  reset role;
  return r;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (arn.uid(1), 'ana-ar@exemple.sn', '{"provider":"email"}', '{}'),
  (arn.uid(2), 'bara-ar@exemple.sn', '{"provider":"email"}', '{}'),
  (arn.uid(3), 'coumba-ar@exemple.sn', '{"provider":"email"}', '{}');

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published, daily_on) values
  ('ar-today', 'Quete du jour', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, current_date),
  ('ar-old', 'Ancienne quete', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, current_date - 3);
insert into public.quest_tests (quest_id, position, name, input, expected)
select id, 1, 't', '1'::jsonb, '1'::jsonb from public.quests where slug like 'ar-%';

-- ---- 1. The switch is off by default: every quest still pays once --------------------------------------
do $$
declare r jsonb; xp0 bigint;
begin
  if (select value #>> '{}' from public.game_config where key = 'quests_pay_only_on_their_day') <> '0' then raise exception 'FAIL: the switch starts off'; end if;
  xp0 := arn.xp(1);
  r := arn.solve(1, 'ar-old');
  if not (r ->> 'solved')::boolean or not coalesce((r ->> 'rewarded')::boolean, false) then raise exception 'FAIL: pays while off %', r; end if;
  if arn.xp(1) <> xp0 + 100 then raise exception 'FAIL: reward paid while off'; end if;
  raise notice 'OK 1: with the switch off, an older quest still pays';
end $$;

-- ---- 2. Switch on: the quest of the day pays on its day ------------------------------------------------
do $$
declare r jsonb; xp0 bigint;
begin
  perform arn.set_switch('1');
  xp0 := arn.xp(2);
  r := arn.solve(2, 'ar-today');
  if not coalesce((r ->> 'rewarded')::boolean, false) or (r ->> 'xp')::int <> 100 then raise exception 'FAIL: today pays %', r; end if;
  if arn.xp(2) <> xp0 + 100 then raise exception 'FAIL: XP paid for the quest of the day'; end if;
  if arn.streak(2) < 1 then raise exception 'FAIL: the quest of the day counts for the streak'; end if;
  raise notice 'OK 2: with the switch on, the quest of the day pays and counts for the streak';
end $$;

-- ---- 3. Switch on: an older quest is solved but pays nothing ------------------------------------------------
do $$
declare r jsonb; xp0 bigint; k0 bigint; s0 integer; v_before bigint;
begin
  xp0 := arn.xp(3);
  select kopeks into k0 from public.wallets where user_id = arn.uid(3);
  s0 := arn.streak(3);
  select count(*) into v_before from public.xp_events where user_id = arn.uid(3);
  r := arn.solve(3, 'ar-old');
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: the old quest can still be solved %', r; end if;
  if coalesce((r ->> 'rewarded')::boolean, true) or (r ->> 'xp')::int <> 0 or (r ->> 'kopeks')::int <> 0 then raise exception 'FAIL: nothing paid %', r; end if;
  if arn.xp(3) <> xp0 or (select kopeks from public.wallets where user_id = arn.uid(3)) <> k0 then raise exception 'FAIL: no XP and no Kopeks'; end if;
  if arn.streak(3) is distinct from s0 then raise exception 'FAIL: the streak is untouched'; end if;
  if (select count(*) from public.xp_events where user_id = arn.uid(3)) <> v_before then raise exception 'FAIL: no reward history'; end if;
  if (select status from public.quest_attempts where user_id = arn.uid(3) and quest_id = arn.quest('ar-old')) <> 'solved' then raise exception 'FAIL: it is marked solved'; end if;
  -- doing it again changes nothing
  perform arn.as_user(3);
  r := tg.submit_quest(arn.quest('ar-old'), 'again', 1, 1);
  reset role;
  if not (r ->> 'already_solved')::boolean or arn.xp(3) <> xp0 then raise exception 'FAIL: redo pays nothing'; end if;
  raise notice 'OK 3: an older quest is marked solved, pays nothing and leaves the streak alone';
end $$;

-- ---- 4. Past days ---------------------------------------------------------------------------------------------
do $$
declare n integer; s text;
begin
  perform arn.as_user(3);
  select count(*) into n from public.list_past_daily_quests(7);
  if n <> 7 then raise exception 'FAIL: one quest per past day, got %', n; end if;
  if exists (select 1 from public.list_past_daily_quests(7) where day >= current_date) then raise exception 'FAIL: today is not a past day'; end if;
  select status into s from public.list_past_daily_quests(7) where day = current_date - 3;
  if s is distinct from 'solved' then raise exception 'FAIL: the scheduled old quest shows my progress, got %', s; end if;
  reset role;
  perform arn.as_user(1);
  select status into s from public.list_past_daily_quests(7) where day = current_date - 3;
  if s is distinct from 'solved' then raise exception 'FAIL: ana solved it while the switch was off'; end if;
  reset role;
  raise notice 'OK 4: past days list the quest of each day with the member''s own progress';
end $$;

-- ---- 5. Security ------------------------------------------------------------------------------------------------
do $$
declare e text;
begin
  perform arn.as_anon();
  e := arn.error_of('select * from public.list_past_daily_quests(7)');
  if e is null or e not ilike '%permission denied%' then raise exception 'FAIL: a visitor cannot list past days (%)', e; end if;
  reset role;
  perform arn.as_user(1);
  perform arn.as_user(1);
  e := arn.error_of('select public.record_graded_attempt(auth.uid(), null::uuid, ''x'', 1, 1)');
  if e is null or e not ilike '%permission denied%' then raise exception 'FAIL: a member cannot call the grading function (%)', e; end if;
  reset role;
  raise notice 'OK 5: visitors cannot list past days and members cannot grade themselves';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
select arn.set_switch('0');
delete from public.quests where slug like 'ar-%';
delete from public.profiles where id::text like 'a7a7a7a7-%';
delete from auth.users where id::text like 'a7a7a7a7-%';
drop schema arn cascade;

do $$
begin
  if exists (select 1 from public.quests where slug like 'ar-%') then raise exception 'FAIL: data left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'quests_pay_only_on_their_day') <> '0' then raise exception 'FAIL: the switch was left on'; end if;
  raise notice 'OK 6: the test left nothing behind';
end $$;

select 'ALL QUEST ARENA TESTS PASSED' as result;
