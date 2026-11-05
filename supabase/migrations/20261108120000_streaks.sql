-- jaajef.tech  -  Migration: streak and activity extras
--
-- Until now a streak was only a number that moved when a quest was solved. A
-- member who stopped playing still showed the old number. This piece adds:
--
--   * my_streak(): the streak as it really stands today (0 once a day was
--     missed), the longest streak ever, whether today is done, whether the
--     streak is at risk, and how many days are left to the next chest.
--   * longest_streak on every profile (public, like the rest of the profile).
--   * An activity calendar: one row per day a member solved at least one
--     quest, with how many. Public, like the profile.
--   * top_streaks(): the members with the longest streaks right now.
--
-- Senegal is on UTC, so current_date matches the members' day.
--
-- Not here: a bonus reward for the quest of the day, streak freezes or
-- reminders (still to decide).
--
-- Requires: quests (bump_streak), foundation (profiles, game_config).

begin;

alter table public.profiles add column longest_streak integer not null default 0 check (longest_streak >= 0);
update public.profiles set longest_streak = streak_days;

create table public.member_activity_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  quests_solved integer not null default 1 check (quests_solved >= 1),
  primary key (user_id, day)
);

-- Days before this migration, from the quests already solved.
insert into public.member_activity_days (user_id, day, quests_solved)
select a.user_id, (a.solved_at at time zone 'UTC')::date, count(*)
  from public.quest_attempts a
 where a.status = 'solved' and a.solved_at is not null
 group by a.user_id, (a.solved_at at time zone 'UTC')::date
on conflict do nothing;

-- ---------------------------------------------------------------------
-- The streak update now also keeps the longest streak and the calendar
-- ---------------------------------------------------------------------
create or replace function public.bump_streak(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
  v_reward_day bigint;
  v_reward_kopeks bigint;
begin
  update public.profiles
     set streak_days = case
           when last_active_on = current_date then streak_days -- already counted today
           when last_active_on = current_date - 1 then streak_days + 1 -- continues the chain
           else 1 -- new chain
         end,
         last_active_on = current_date
   where id = p_user
  returning streak_days into v_streak;

  update public.profiles set longest_streak = greatest(longest_streak, v_streak)
   where id = p_user and longest_streak < v_streak;

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
-- The streak as it stands today
-- ---------------------------------------------------------------------
-- A streak is alive if the member was active today or yesterday.
-- next_chest_in counts the days with a solved quest still needed, counting
-- today when today is not done yet.
create function public.streak_status(p_user uuid)
returns table (
  current_streak integer, longest_streak integer, done_today boolean, at_risk boolean,
  chest_every integer, chest_kopeks bigint, next_chest_in integer, last_active_on date
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
  v_every integer := coalesce((select (value #>> '{}')::integer from public.game_config where key = 'streak_reward_day'), 0);
  v_kopeks bigint := coalesce((select (value #>> '{}')::bigint from public.game_config where key = 'streak_reward_kopeks'), 0);
begin
  select * into v_p from public.profiles where id = p_user;
  if not found then return; end if;
  v_s := case when v_p.last_active_on is not null and v_p.last_active_on >= current_date - 1 then v_p.streak_days else 0 end;
  return query select
    v_s,
    greatest(v_p.longest_streak, v_s),
    coalesce(v_p.last_active_on = current_date, false),
    v_s > 0 and v_p.last_active_on = current_date - 1,
    v_every,
    v_kopeks,
    case when v_every > 0 then v_every - (v_s % v_every) else null end,
    v_p.last_active_on;
end $$;

-- The signed-in member's own streak.
create function public.my_streak()
returns table (
  current_streak integer, longest_streak integer, done_today boolean, at_risk boolean,
  chest_every integer, chest_kopeks bigint, next_chest_in integer, last_active_on date
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

-- ---------------------------------------------------------------------
-- Public: activity calendar and top streaks
-- ---------------------------------------------------------------------
create function public.activity_calendar(p_user uuid, p_days integer default 90)
returns table (day date, quests_solved integer)
language sql
stable
security definer
set search_path = public
as $$
  select a.day, a.quests_solved
    from public.member_activity_days a
   where a.user_id = p_user
     and a.day > current_date - least(greatest(coalesce(p_days, 90), 1), 366)
     and a.day <= current_date
   order by a.day
$$;

create function public.top_streaks(p_limit integer default 20)
returns table (user_id uuid, username text, current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.streak_days, p.longest_streak
    from public.profiles p
   where p.streak_days > 0 and p.last_active_on >= current_date - 1
   order by p.streak_days desc, p.longest_streak desc, p.username
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.member_activity_days enable row level security;
revoke all on public.member_activity_days from public, anon, authenticated;
grant select on public.member_activity_days to anon, authenticated;
create policy "activity days are public" on public.member_activity_days for select to anon, authenticated using (true);

revoke execute on function public.streak_status(uuid) from public, anon, authenticated;
revoke execute on function public.my_streak() from public, anon;
revoke execute on function public.activity_calendar(uuid, integer) from public;
revoke execute on function public.top_streaks(integer) from public;
grant execute on function public.streak_status(uuid) to service_role;
grant execute on function public.my_streak() to authenticated;
grant execute on function public.activity_calendar(uuid, integer) to anon, authenticated;
grant execute on function public.top_streaks(integer) to anon, authenticated;

grant all on public.member_activity_days to service_role;

commit;
