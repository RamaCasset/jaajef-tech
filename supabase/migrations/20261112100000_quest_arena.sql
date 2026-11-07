-- jaajef.tech  -  Migration: the quest arena
--
--   * Rule (confirmed 7 November): only the quest of the day pays, and only on its day. Older
--     quests, quests of days a member missed, and quests redone can all be done and are marked
--     solved, but pay no XP and no Kopeks and do not count for the streak.
--   * The rule is behind a switch, quests_pay_only_on_their_day, which is OFF (0) for now. Turn it on
--     (1) once the pool of daily quests exists. While it is off, every quest pays once, as before.
--   * list_past_daily_quests: the quests of the last days (not today), with the member's own
--     progress, so the arena can show days they missed.
--   * Limit: a quest has one daily date, so a past day that was never scheduled shows the quest
--     the database would have picked automatically for it.
--   * A quest solved early (before its day) is already solved on its day, so it does not pay then.
--
-- Requires: quest of the day, server grading, daily bonus.

begin;

insert into public.game_config (key, value, status, description) values
  ('quests_pay_only_on_their_day', '0', 'tbc', '1 = only the quest of the day pays, on its day (arena rule); 0 = every quest pays once. Turn on when the daily pool exists');

create or replace function public.record_graded_attempt(
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

  -- Quest arena rule: when the switch is on, only the quest of the day pays, and only on its day.
  -- Any other quest (an older one, or one practised early) is marked solved but pays nothing and
  -- does not count for the streak.
  if public.chat_setting('quests_pay_only_on_their_day') = 1 and p_quest_id is distinct from public.daily_quest_for(current_date) then
    return jsonb_build_object(
      'solved', true, 'already_solved', false, 'rewarded', false,
      'xp', 0, 'kopeks', 0, 'duration_ms', v_elapsed, 'streak_days', null,
      'hints_used', v_attempt.hints_used,
      'daily_quest', false, 'bonus_xp', 0, 'bonus_kopeks', 0);
  end if;

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
    'rewarded', true, 'daily_quest', v_daily, 'bonus_xp', v_bonus_xp, 'bonus_kopeks', v_bonus_kopeks);
end;
$$;

create function public.list_past_daily_quests(p_days integer default 30)
returns table (day date, quest_id uuid, slug text, title text, clan public.clan_type, mastery public.mastery_type, language text, est_minutes integer, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select d::date, q.id, q.slug, q.title, q.clan, q.mastery, q.language, q.est_minutes,
         (select a.status from public.quest_attempts a where a.quest_id = q.id and a.user_id = auth.uid())
    from generate_series(current_date - v_days, current_date - 1, interval '1 day') d
    join public.quests q on q.id = public.daily_quest_for(d::date)
   order by d desc;
end $$;

revoke execute on function public.list_past_daily_quests(integer) from public, anon;
grant execute on function public.list_past_daily_quests(integer) to authenticated;

commit;
