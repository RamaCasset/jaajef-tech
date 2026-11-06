-- jaajef.tech  -  Migration: quest-of-the-day bonus and streak freezes
--
--   * Daily quest bonus: solving the quest of the day, on its day, can pay an extra XP and Kopek
--     amount, once per day. The amounts are PLACEHOLDERS (0 = no bonus) until Marie decides:
--     settings daily_quest_bonus_xp and daily_quest_bonus_kopeks.
--   * Streak freezes: a member earns a freeze each time their streak reaches a multiple of
--     streak_freeze_every_days (7), keeps at most streak_freeze_max (2), and a freeze is used
--     automatically to cover a missed day so the streak is not lost. If more days were missed
--     than freezes are stored, the streak restarts and no freeze is spent. The frozen days do not
--     count as activity days. These numbers are DEFAULTS to confirm with Marie.
--   * my_streak now also says how many freezes are stored and whether a freeze is protecting the streak.
--   * top_streaks is unchanged: it lists members who were really active today or yesterday.
--
-- Requires: streaks, quest of the day, quests (submit_quest), foundation (grant_reward).

begin;

insert into public.game_config (key, value, status, description) values
  ('daily_quest_bonus_xp', '0', 'tbc', 'PLACEHOLDER: extra XP for solving the quest of the day on its day (0 = none until decided)'),
  ('daily_quest_bonus_kopeks', '0', 'tbc', 'PLACEHOLDER: extra Kopeks for solving the quest of the day on its day (0 = none until decided)'),
  ('streak_freeze_every_days', '7', 'tbc', 'A member earns a streak freeze each time the streak reaches a multiple of this (0 = never). To confirm with Marie'),
  ('streak_freeze_max', '2', 'tbc', 'Most streak freezes a member can keep. To confirm with Marie');

alter table public.profiles add column streak_freezes integer not null default 0 check (streak_freezes >= 0);

create table public.streak_freeze_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('earned', 'used')),
  created_at timestamptz not null default now()
);
create index streak_freeze_log_user on public.streak_freeze_log (user_id, day desc, id desc);

-- ---------------------------------------------------------------------
-- The streak update, now with freezes
-- ---------------------------------------------------------------------
create or replace function public.bump_streak(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.profiles;
  v_streak integer;
  v_used integer := 0;
  v_freezes integer;
  v_first_today boolean;
  v_every integer := public.chat_setting('streak_freeze_every_days');
  v_max integer := greatest(public.chat_setting('streak_freeze_max'), 0);
  v_earned boolean := false;
  v_reward_day bigint;
  v_reward_kopeks bigint;
begin
  select * into v_p from public.profiles where id = p_user for update;
  if not found then return null; end if;

  v_first_today := v_p.last_active_on is distinct from current_date;
  if v_p.last_active_on = current_date then
    v_streak := v_p.streak_days; -- already counted today
  elsif v_p.last_active_on = current_date - 1 then
    v_streak := v_p.streak_days + 1; -- continues the chain
  elsif v_p.last_active_on is not null and v_p.last_active_on < current_date and v_p.streak_days > 0
        and current_date - v_p.last_active_on - 1 <= v_p.streak_freezes then
    v_used := current_date - v_p.last_active_on - 1; -- freezes cover the missed days
    v_streak := v_p.streak_days + 1;
  else
    v_streak := 1; -- new chain
  end if;

  v_freezes := v_p.streak_freezes - v_used;
  if v_first_today and v_every > 0 and v_streak % v_every = 0 and v_freezes < v_max then
    v_freezes := v_freezes + 1;
    v_earned := true;
  end if;

  update public.profiles
     set streak_days = v_streak, last_active_on = current_date, streak_freezes = v_freezes,
         longest_streak = greatest(longest_streak, v_streak)
   where id = p_user;

  if v_used > 0 then
    insert into public.streak_freeze_log (user_id, day, kind)
    select p_user, d::date, 'used' from generate_series(current_date - v_used, current_date - 1, interval '1 day') d;
  end if;
  if v_earned then
    insert into public.streak_freeze_log (user_id, day, kind) values (p_user, current_date, 'earned');
  end if;

  insert into public.member_activity_days (user_id, day) values (p_user, current_date)
  on conflict (user_id, day) do update set quests_solved = public.member_activity_days.quests_solved + 1;

  select (value #>> '{}')::bigint into v_reward_day
    from public.game_config where key = 'streak_reward_day';
  select (value #>> '{}')::bigint into v_reward_kopeks
    from public.game_config where key = 'streak_reward_kopeks';

  -- Chest every N days. The date in the key makes it pay once per day at most.
  if v_reward_day > 0 and v_streak % v_reward_day = 0 then
    perform public.grant_reward(
      p_user, 0, coalesce(v_reward_kopeks, 0), 'streak_chest',
      'streak:' || p_user::text || ':' || current_date::text);
  end if;

  return v_streak;
end;
$$;

-- ---------------------------------------------------------------------
-- The streak as it stands today, with freezes
-- ---------------------------------------------------------------------
drop function public.my_streak();
drop function public.streak_status(uuid);

create function public.streak_status(p_user uuid)
returns table (
  current_streak integer, longest_streak integer, done_today boolean, at_risk boolean,
  chest_every integer, chest_kopeks bigint, next_chest_in integer, last_active_on date,
  freezes integer, freeze_max integer, protected_by_freeze boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_p public.profiles;
  v_s integer;
  v_alive boolean;
  v_protected boolean;
  v_every integer := coalesce((select (value #>> '{}')::integer from public.game_config where key = 'streak_reward_day'), 0);
  v_kopeks bigint := coalesce((select (value #>> '{}')::bigint from public.game_config where key = 'streak_reward_kopeks'), 0);
begin
  select * into v_p from public.profiles where id = p_user;
  if not found then return; end if;
  v_alive := v_p.last_active_on is not null and v_p.last_active_on >= current_date - 1;
  v_protected := not v_alive and v_p.streak_days > 0 and v_p.last_active_on is not null
                 and current_date - v_p.last_active_on - 1 <= v_p.streak_freezes;
  v_s := case when v_alive or v_protected then v_p.streak_days else 0 end;
  return query select
    v_s,
    greatest(v_p.longest_streak, v_s),
    coalesce(v_p.last_active_on = current_date, false),
    v_s > 0 and v_p.last_active_on < current_date,
    v_every,
    v_kopeks,
    case when v_every > 0 then v_every - (v_s % v_every) else null end,
    v_p.last_active_on,
    v_p.streak_freezes,
    greatest(public.chat_setting('streak_freeze_max'), 0),
    v_protected;
end $$;

create function public.my_streak()
returns table (
  current_streak integer, longest_streak integer, done_today boolean, at_risk boolean,
  chest_every integer, chest_kopeks bigint, next_chest_in integer, last_active_on date,
  freezes integer, freeze_max integer, protected_by_freeze boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query select * from public.streak_status(auth.uid());
end $$;

-- My freeze history: when I earned one and which missed days one covered.
create function public.list_my_streak_freezes(p_limit integer default 30)
returns table (day date, kind text, at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select l.day, l.kind, l.created_at
    from public.streak_freeze_log l
   where l.user_id = auth.uid()
   order by l.day desc, l.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;

-- Quest solving: adds the quest-of-the-day bonus.
create or replace function public.submit_quest(
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
  v_user uuid := auth.uid();
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

  -- The report must cover every test of the quest and all of them must pass.
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
-- Security
-- ---------------------------------------------------------------------
alter table public.streak_freeze_log enable row level security;
revoke all on public.streak_freeze_log from public, anon, authenticated;

revoke execute on function public.streak_status(uuid) from public, anon, authenticated;
revoke execute on function public.my_streak() from public, anon;
revoke execute on function public.list_my_streak_freezes(integer) from public, anon;
grant execute on function public.streak_status(uuid) to service_role;
grant execute on function public.my_streak() to authenticated;
grant execute on function public.list_my_streak_freezes(integer) to authenticated;

grant all on public.streak_freeze_log to service_role;

commit;
