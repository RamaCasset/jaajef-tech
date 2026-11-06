-- Tests for the quest-of-the-day bonus and streak freezes.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f daily_bonus_streak_freeze.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1), bara (2), coumba (3), dame (4), eli (5). Quests: db-today (the quest of the day),
-- db-other (not the quest of the day).
-- Stand-in for the old browser report: players can no longer call submit_quest, so the tests grade
-- through the server-only function, as the server would, for the signed-in test player.
create schema if not exists tg;
create or replace function tg.submit_quest(p_quest uuid, p_code text, p_passed integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public.record_graded_attempt(auth.uid(), p_quest, p_code, p_passed, p_total); end $$;
grant usage on schema tg to authenticated, anon, service_role;
grant execute on function tg.submit_quest(uuid, text, integer, integer) to authenticated, anon, service_role;



create schema dbk;
grant usage on schema dbk to public;

create function dbk.uid(p_n int) returns uuid
language sql immutable as $$ select ('f6f6f6f6-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function dbk.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', dbk.uid(p_n)::text, true);
end $$;

create function dbk.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function dbk.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function dbk.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := dbk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function dbk.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

create function dbk.quest(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.quests where slug = p_slug $$;

create function dbk.xp(p_n int) returns bigint
language sql stable security definer as $$ select xp from public.profiles where id = dbk.uid(p_n) $$;

create function dbk.kopeks(p_n int) returns bigint
language sql stable security definer as $$ select kopeks from public.wallets where user_id = dbk.uid(p_n) $$;

-- Member n solves a quest (starts it, waits two minutes, submits the one test).
create function dbk.solve(p_n int, p_slug text) returns jsonb
language plpgsql as $$
declare q uuid := dbk.quest(p_slug); r jsonb;
begin
  perform dbk.as_user(p_n);
  perform public.start_quest(q);
  reset role;
  update public.quest_attempts set started_at = now() - interval '2 minutes' where user_id = dbk.uid(p_n) and quest_id = q;
  perform dbk.as_user(p_n);
  r := tg.submit_quest(q, 'solution', 1, 1);
  reset role;
  return r;
end $$;

-- Run the streak update for member n as the server.
create function dbk.bump(p_n int) returns integer
language plpgsql as $$
declare v integer;
begin
  set local role service_role;
  v := public.bump_streak(dbk.uid(p_n));
  reset role;
  return v;
end $$;

create function dbk.set_streak(p_n int, p_days int, p_last_offset int, p_freezes int) returns void
language sql as $$
  update public.profiles set streak_days = p_days, longest_streak = greatest(longest_streak, p_days),
         last_active_on = current_date - p_last_offset, streak_freezes = p_freezes where id = dbk.uid(p_n)
$$;

create function dbk.log_count(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.streak_freeze_log where user_id = dbk.uid(p_n) and kind = p_kind
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (dbk.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (dbk.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (dbk.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (dbk.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (dbk.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}');

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published, daily_on) values
  ('db-today', 'Quete du jour', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, current_date),
  ('db-other', 'Autre quete', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, null),
  ('db-third', 'Troisieme quete', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, null);
insert into public.quest_tests (quest_id, position, name, input, expected)
select id, 1, 't', '1'::jsonb, '1'::jsonb from public.quests where slug like 'db-%';

-- ---- 1. The bonus is a placeholder: nothing is paid until it is set --------------------------------------
do $$
declare r jsonb; xp0 bigint; k0 bigint;
begin
  if (select status from public.game_config where key = 'daily_quest_bonus_xp') <> 'tbc' or (select value #>> '{}' from public.game_config where key = 'daily_quest_bonus_xp') <> '0' then raise exception 'FAIL: the XP bonus is a placeholder at 0'; end if;
  if (select status from public.game_config where key = 'daily_quest_bonus_kopeks') <> 'tbc' or (select value #>> '{}' from public.game_config where key = 'daily_quest_bonus_kopeks') <> '0' then raise exception 'FAIL: the Kopek bonus is a placeholder at 0'; end if;
  xp0 := dbk.xp(1); k0 := dbk.kopeks(1);
  r := dbk.solve(1, 'db-today');
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: solved %', r; end if;
  if not (r ->> 'daily_quest')::boolean then raise exception 'FAIL: it was the quest of the day'; end if;
  if (r ->> 'bonus_xp')::int <> 0 or (r ->> 'bonus_kopeks')::int <> 0 then raise exception 'FAIL: no bonus while the placeholder is 0'; end if;
  if dbk.xp(1) <> xp0 + 100 or dbk.kopeks(1) <> k0 + 10 then raise exception 'FAIL: only the quest reward is paid'; end if;
  if exists (select 1 from public.xp_events where user_id = dbk.uid(1) and reason = 'daily_quest_bonus') then raise exception 'FAIL: no bonus event'; end if;
  raise notice 'OK 1: with the placeholder at 0 the quest of the day pays only its normal reward';
end $$;

-- ---- 2. Once the bonus is set ---------------------------------------------------------------------------
do $$
declare r jsonb; xp0 bigint; k0 bigint;
begin
  perform dbk.set_config('daily_quest_bonus_xp', '30');
  perform dbk.set_config('daily_quest_bonus_kopeks', '20');
  xp0 := dbk.xp(2); k0 := dbk.kopeks(2);
  r := dbk.solve(2, 'db-today');
  if (r ->> 'bonus_xp')::int <> 30 or (r ->> 'bonus_kopeks')::int <> 20 then raise exception 'FAIL: bonus in the answer %', r; end if;
  if dbk.xp(2) <> xp0 + 100 + 30 or dbk.kopeks(2) <> k0 + 10 + 20 then raise exception 'FAIL: quest reward plus bonus'; end if;
  if (select count(*) from public.xp_events where user_id = dbk.uid(2) and reason = 'daily_quest_bonus' and amount = 30) <> 1 then raise exception 'FAIL: bonus in the XP history'; end if;
  if (select count(*) from public.kopek_transactions where user_id = dbk.uid(2) and reason = 'daily_quest_bonus' and amount = 20) <> 1 then raise exception 'FAIL: bonus in the Kopek history'; end if;

  -- solving the same quest again pays nothing more
  perform dbk.as_user(2);
  r := tg.submit_quest(dbk.quest('db-today'), 'again', 1, 1);
  reset role;
  if not (r ->> 'already_solved')::boolean then raise exception 'FAIL: already solved'; end if;
  if dbk.xp(2) <> xp0 + 130 then raise exception 'FAIL: no second payment'; end if;

  -- a quest that is not the quest of the day: no bonus
  xp0 := dbk.xp(2);
  r := dbk.solve(2, 'db-other');
  if (r ->> 'daily_quest')::boolean or (r ->> 'bonus_xp')::int <> 0 then raise exception 'FAIL: not the quest of the day: no bonus %', r; end if;
  if dbk.xp(2) <> xp0 + 100 then raise exception 'FAIL: only the quest reward'; end if;

  -- only Kopeks set
  perform dbk.set_config('daily_quest_bonus_xp', '0');
  xp0 := dbk.xp(3); k0 := dbk.kopeks(3);
  r := dbk.solve(3, 'db-today');
  if dbk.xp(3) <> xp0 + 100 or dbk.kopeks(3) <> k0 + 10 + 20 then raise exception 'FAIL: only the Kopek bonus is paid'; end if;
  perform dbk.set_config('daily_quest_bonus_kopeks', '0');
  raise notice 'OK 2: the bonus is paid once, only for the quest of the day, in XP, Kopeks or both';
end $$;

-- ---- 3. Earning freezes -------------------------------------------------------------------------------------
do $$
declare v integer;
begin
  perform dbk.set_streak(4, 6, 1, 0);
  v := dbk.bump(4);
  if v <> 7 then raise exception 'FAIL: streak 7'; end if;
  if (select streak_freezes from public.profiles where id = dbk.uid(4)) <> 1 or dbk.log_count(4, 'earned') <> 1 then raise exception 'FAIL: a freeze is earned at day 7'; end if;
  v := dbk.bump(4);
  if (select streak_freezes from public.profiles where id = dbk.uid(4)) <> 1 or dbk.log_count(4, 'earned') <> 1 then raise exception 'FAIL: not earned twice on the same day'; end if;
  -- the maximum
  perform dbk.set_streak(5, 13, 1, 2);
  v := dbk.bump(5);
  if v <> 14 or (select streak_freezes from public.profiles where id = dbk.uid(5)) <> 2 or dbk.log_count(5, 'earned') <> 0 then raise exception 'FAIL: no freeze above the maximum'; end if;
  -- off switch
  perform dbk.set_config('streak_freeze_every_days', '0');
  perform dbk.set_streak(5, 20, 1, 0);
  v := dbk.bump(5);
  if (select streak_freezes from public.profiles where id = dbk.uid(5)) <> 0 then raise exception 'FAIL: 0 turns earning off'; end if;
  perform dbk.set_config('streak_freeze_every_days', '7');
  raise notice 'OK 3: a freeze is earned every 7 days of streak, once, up to the maximum';
end $$;

-- ---- 4. Using freezes --------------------------------------------------------------------------------------
do $$
declare v integer;
begin
  -- one missed day, one freeze: the streak continues
  perform dbk.set_streak(1, 10, 2, 1);
  v := dbk.bump(1);
  if v <> 11 then raise exception 'FAIL: the streak continues through a frozen day, got %', v; end if;
  if (select streak_freezes from public.profiles where id = dbk.uid(1)) <> 0 or dbk.log_count(1, 'used') <> 1 then raise exception 'FAIL: the freeze is spent and logged'; end if;
  if not exists (select 1 from public.streak_freeze_log where user_id = dbk.uid(1) and kind = 'used' and day = current_date - 1) then raise exception 'FAIL: the covered day is logged'; end if;
  if exists (select 1 from public.member_activity_days where user_id = dbk.uid(1) and day = current_date - 1) then raise exception 'FAIL: a frozen day is not an activity day'; end if;

  -- two missed days, one freeze: the streak restarts and the freeze is kept
  perform dbk.set_streak(2, 10, 3, 1);
  v := dbk.bump(2);
  if v <> 1 then raise exception 'FAIL: not enough freezes: the streak restarts, got %', v; end if;
  if (select streak_freezes from public.profiles where id = dbk.uid(2)) <> 1 or dbk.log_count(2, 'used') <> 0 then raise exception 'FAIL: the freeze is not spent for nothing'; end if;

  -- two missed days, two freezes
  perform dbk.set_streak(3, 10, 3, 2);
  v := dbk.bump(3);
  if v <> 11 or (select streak_freezes from public.profiles where id = dbk.uid(3)) <> 0 or dbk.log_count(3, 'used') <> 2 then raise exception 'FAIL: two freezes cover two days'; end if;

  -- no freeze, one missed day: restarts
  perform dbk.set_streak(5, 10, 2, 0);
  v := dbk.bump(5);
  if v <> 1 then raise exception 'FAIL: no freeze: restarts'; end if;

  -- a streak that was already 0 does not use a freeze
  perform dbk.set_streak(4, 0, 5, 1);
  v := dbk.bump(4);
  if v <> 1 or (select streak_freezes from public.profiles where id = dbk.uid(4)) <> 1 then raise exception 'FAIL: nothing to protect'; end if;
  raise notice 'OK 4: freezes cover missed days automatically; not enough freezes means the streak restarts and nothing is spent';
end $$;

-- ---- 5. What the member sees ----------------------------------------------------------------------------
do $$
declare r record;
begin
  perform dbk.set_streak(1, 10, 2, 1);
  perform dbk.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 10 or not r.protected_by_freeze or not r.at_risk or r.freezes <> 1 or r.freeze_max <> 2 then raise exception 'FAIL: protected streak shown as alive %', r; end if;
  reset role;
  perform dbk.set_streak(1, 10, 2, 0);
  perform dbk.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 0 or r.protected_by_freeze then raise exception 'FAIL: unprotected lapsed streak shows 0 %', r; end if;
  reset role;
  perform dbk.set_streak(1, 10, 1, 1);
  perform dbk.as_user(1);
  select * into r from public.my_streak();
  if r.current_streak <> 10 or r.protected_by_freeze or not r.at_risk then raise exception 'FAIL: alive streak is not "protected" %', r; end if;
  reset role;
  perform dbk.set_streak(1, 10, 2, 1);
  perform dbk.as_anon();
  if exists (select 1 from public.top_streaks() where username = (select username from public.profiles where id = dbk.uid(1))) then raise exception 'FAIL: top streaks list only members who were really active'; end if;
  reset role;
  raise notice 'OK 5: my streak shows a freeze-protected streak as alive; top streaks does not';
end $$;

-- ---- 6. Privacy and tampering --------------------------------------------------------------------------
do $$
begin
  perform dbk.as_user(1);
  perform dbk.must_fail('setting my own freezes', format('update public.profiles set streak_freezes = 99 where id = %L', dbk.uid(1)), 'permission denied');
  perform dbk.must_fail('reading the freeze log directly', 'select * from public.streak_freeze_log', 'permission denied');
  perform dbk.must_fail('bumping my own streak', format('select public.bump_streak(%L)', dbk.uid(1)), 'permission denied');
  if (select count(*) from public.list_my_streak_freezes()) <> 1 then raise exception 'FAIL: ana sees her one used freeze, got %', (select count(*) from public.list_my_streak_freezes()); end if;
  reset role;
  perform dbk.as_user(2);
  if exists (select 1 from public.list_my_streak_freezes() where kind = 'used') then raise exception 'FAIL: bara sees only her own history'; end if;
  reset role;
  perform dbk.as_anon();
  perform dbk.must_fail('a visitor lists freezes', 'select * from public.list_my_streak_freezes()', 'permission denied');
  reset role;
  raise notice 'OK 6: freezes cannot be set or read except through the functions';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.quests where slug like 'db-%';
delete from public.profiles where id::text like 'f6f6f6f6-%';
delete from auth.users where id::text like 'f6f6f6f6-%';
drop schema dbk cascade;

do $$
begin
  if exists (select 1 from public.streak_freeze_log) or exists (select 1 from public.quests where slug like 'db-%') then raise exception 'FAIL: data left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'daily_quest_bonus_xp') <> '0'
     or (select value #>> '{}' from public.game_config where key = 'daily_quest_bonus_kopeks') <> '0'
     or (select value #>> '{}' from public.game_config where key = 'streak_freeze_every_days') <> '7'
     or (select value #>> '{}' from public.game_config where key = 'streak_freeze_max') <> '2' then
    raise exception 'FAIL: a setting was left changed';
  end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL DAILY BONUS AND STREAK FREEZE TESTS PASSED' as result;
