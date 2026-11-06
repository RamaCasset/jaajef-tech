-- jaajef.tech - Server-side grading of quests
--
-- Until now the browser ran a player's code and told the database "4 of 4 tests passed", and the
-- database believed it. That is easy to fake. From now on:
--   * The hidden tests are private. Players can no longer read them.
--   * Players can no longer report their own result (submit_quest is removed).
--   * A server (the run-quest Edge Function) runs the code in a sandbox against the hidden tests and
--     records the result itself, through record_graded_attempt, which only the server can call.
--   * begin_quest_run gives the server the tests and enforces a run limit per player.
--
-- Requires: quests, quest teaching, daily bonus (migration "daily_bonus_streak_freeze").
begin;

-- ---------------------------------------------------------------------
-- 1. The hidden tests become private
-- ---------------------------------------------------------------------
drop policy "tests of published quests are public" on public.quest_tests;
revoke select on public.quest_tests from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Run log (for the per-player limit). Nobody but the server reads it.
-- ---------------------------------------------------------------------
create table public.quest_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id uuid not null references public.quests (id) on delete cascade,
  ran_at timestamptz not null default now()
);
create index quest_runs_user_recent on public.quest_runs (user_id, ran_at desc);
alter table public.quest_runs enable row level security;
revoke all on public.quest_runs from public, anon, authenticated;
grant all on public.quest_runs to service_role;
grant usage, select on sequence public.quest_runs_id_seq to service_role;

-- ---------------------------------------------------------------------
-- 3. begin_quest_run: what the server needs before running a player's code
--    Limits are placeholders to confirm: 6 runs per minute and 150 per day per player.
-- ---------------------------------------------------------------------
create function public.begin_quest_run(p_user uuid, p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quest public.quests;
  v_status text;
  v_minute integer;
  v_day integer;
begin
  if p_user is null then raise exception 'not authenticated'; end if;

  select * into v_quest from public.quests where id = p_quest_id and published;
  if not found then raise exception 'quest not available'; end if;

  select status into v_status from public.quest_attempts where user_id = p_user and quest_id = p_quest_id;
  if not found then raise exception 'start the quest first'; end if;
  if v_status = 'solved' then raise exception 'quest already solved'; end if;

  delete from public.quest_runs where ran_at < now() - interval '1 day';
  select count(*) filter (where ran_at > now() - interval '1 minute'), count(*)
    into v_minute, v_day from public.quest_runs where user_id = p_user;
  if v_minute >= 6 or v_day >= 150 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_runs');
  end if;
  insert into public.quest_runs (user_id, quest_id) values (p_user, p_quest_id);

  return jsonb_build_object(
    'allowed', true,
    'language', v_quest.language,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'input', t.input, 'expected', t.expected) order by t.position, t.id)
        from public.quest_tests t where t.quest_id = p_quest_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 4. record_graded_attempt: the old submit_quest, but for a named player and server-only
-- ---------------------------------------------------------------------
create function public.record_graded_attempt(
  p_user uuid,
  p_quest_id uuid,
  p_code text,
  p_tests_passed integer,
  p_tests_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := p_user;
  v_quest public.quests;
  v_attempt public.quest_attempts;
  v_required integer;
  v_elapsed integer;
  v_streak integer;
  v_daily boolean := false;
  v_bonus_xp integer := 0;
  v_bonus_kopeks bigint := 0;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(p_code, '')) > 50000 then
    raise exception 'code too long';
  end if;

  select * into v_quest from public.quests where id = p_quest_id and published;
  if not found then
    raise exception 'quest not available';
  end if;

  select * into v_attempt from public.quest_attempts
   where user_id = v_user and quest_id = p_quest_id for update;
  if not found then
    raise exception 'start the quest first';
  end if;

  -- Already solved: no second payment.
  if v_attempt.status = 'solved' then
    return jsonb_build_object('solved', true, 'already_solved', true,
                              'duration_ms', v_attempt.duration_ms,
                              'hints_used', v_attempt.hints_used);
  end if;

  select count(*) into v_required from public.quest_tests where quest_id = p_quest_id;
  if v_required = 0 then
    raise exception 'quest has no tests yet';
  end if;

  -- The result must cover every test of the quest and all of them must pass.
  if p_tests_total is distinct from v_required or p_tests_passed is distinct from v_required then
    update public.quest_attempts
       set code = p_code,
           tests_total = v_required,
           tests_passed = least(greatest(coalesce(p_tests_passed, 0), 0), v_required)
     where id = v_attempt.id;
    return jsonb_build_object('solved', false, 'reason', 'tests_not_passed',
                              'tests_passed', least(greatest(coalesce(p_tests_passed, 0), 0), v_required),
                              'tests_total', v_required);
  end if;

  -- The SERVER measures time, not the browser.
  v_elapsed := least(extract(epoch from (now() - v_attempt.started_at)) * 1000, 2147483647)::integer;
  if v_elapsed < v_quest.min_seconds * 1000 then
    return jsonb_build_object('solved', false, 'reason', 'too_fast',
                              'min_seconds', v_quest.min_seconds);
  end if;

  update public.quest_attempts
     set status = 'solved', code = p_code, tests_passed = v_required,
         tests_total = v_required, solved_at = now(), duration_ms = v_elapsed
   where id = v_attempt.id;

  -- One payment per member per quest, however many times this is called.
  perform public.grant_reward(
    v_user, v_quest.xp_reward, v_quest.kopek_reward, 'quest_solved',
    'quest:' || p_quest_id::text || ':' || v_user::text, 'quest', p_quest_id::text);

  v_streak := public.bump_streak(v_user);

  -- Solving the quest of the day on its day earns a bonus (amounts are placeholders until decided).
  if p_quest_id = public.daily_quest_for(current_date) then
    v_daily := true;
    v_bonus_xp := greatest(public.chat_setting('daily_quest_bonus_xp'), 0);
    v_bonus_kopeks := greatest(public.chat_setting('daily_quest_bonus_kopeks'), 0);
    if v_bonus_xp > 0 or v_bonus_kopeks > 0 then
      perform public.grant_reward(
        v_user, v_bonus_xp, v_bonus_kopeks, 'daily_quest_bonus',
        'dailybonus:' || v_user::text || ':' || current_date::text, 'quest', p_quest_id::text);
    end if;
  end if;

  return jsonb_build_object(
    'solved', true, 'already_solved', false,
    'xp', v_quest.xp_reward, 'kopeks', v_quest.kopek_reward,
    'duration_ms', v_elapsed, 'streak_days', v_streak,
    'hints_used', v_attempt.hints_used,
    'daily_quest', v_daily, 'bonus_xp', v_bonus_xp, 'bonus_kopeks', v_bonus_kopeks);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Players can no longer report their own result
-- ---------------------------------------------------------------------
drop function public.submit_quest(uuid, text, integer, integer);

revoke execute on function public.begin_quest_run(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_graded_attempt(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.begin_quest_run(uuid, uuid) to service_role;
grant execute on function public.record_graded_attempt(uuid, uuid, text, integer, integer) to service_role;

commit;
