-- jaajef.tech  -  Migration: one new quest a day
--
--   * Each quest can have a drip_day (1, 2, 3 ...). A member sees quest 1 on the day they join,
--     quest 2 the next day, and so on. The clock is the member's own join date (Senegal is on UTC).
--   * A quest stays open when it belongs to a published learning path, so a lesson never waits for a quest.
--   * A member's quest of the day is the quest of their current drip day. After the last drip day
--     the daily quest starts again from quest 1; every quest stays open.
--   * Staff see every quest. Someone not signed in sees quest 1 only.
--   * Nothing changes while no quest has a drip_day: the shared quest of the day is used as before.
--   * The reward rules do not change. The daily bonus and the arena switch now look at the member's own quest of the day.
--
-- Requires: quests, quest of the day, server grading, quest arena, learning paths, quest practice.

begin;

alter table public.quests add column drip_day integer check (drip_day >= 1);
create unique index quests_drip_day_unique on public.quests (drip_day) where drip_day is not null;

-- ---------------------------------------------------------------------
-- The drip clock (internal)
-- ---------------------------------------------------------------------
create function public.drip_total()
returns integer
language sql
stable
security definer
set search_path = public
as $$ select max(drip_day) from public.quests where published and drip_day is not null $$;

-- Day 1 is the join day. Someone who is not signed in is on day 1.
create function public.member_drip_day(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select greatest(1, current_date - p.created_at::date + 1) from public.profiles p where p.id = p_user),
    1)
$$;

-- The quest that belongs to a drip day. Past the last day it starts again from the first.
create function public.drip_quest_for(p_day integer)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.id from public.quests q
   where q.published and q.drip_day = ((greatest(p_day, 1) - 1) % public.drip_total()) + 1
$$;

-- A member's quest of the day. Without any drip quest, the shared quest of the day.
create function public.member_daily_quest(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when public.drip_total() is null
              then public.daily_quest_for(current_date)
              else public.drip_quest_for(public.member_drip_day(p_user)) end
$$;

-- Can this member open this quest?
create function public.quest_open_for(p_user uuid, p_quest uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.quests q
     where q.id = p_quest and q.published
       and (
         public.drip_total() is null
         or q.drip_day is null
         or q.drip_day <= public.member_drip_day(p_user)
         or exists (select 1 from public.learning_steps s
                      join public.learning_paths lp on lp.id = s.path_id and lp.published
                     where s.quest_id = q.id)
       ))
$$;

-- Used by the row policy: staff see everything.
create function public.quest_open(p_quest uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.staff_role() is not null or public.quest_open_for(auth.uid(), p_quest)
$$;

drop policy "published quests are public" on public.quests;
create policy "open quests are public" on public.quests
  for select to anon, authenticated using (published and public.quest_open(id));

-- ---------------------------------------------------------------------
-- A closed quest cannot be started or run
-- ---------------------------------------------------------------------
create or replace function public.start_quest(p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.quest_attempts;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not public.quest_open(p_quest_id) then
    raise exception 'quest not available';
  end if;

  insert into public.quest_attempts (user_id, quest_id)
  values (v_user, p_quest_id)
  on conflict (user_id, quest_id) do nothing;

  select * into v_attempt from public.quest_attempts
   where user_id = v_user and quest_id = p_quest_id;

  return jsonb_build_object(
    'status', v_attempt.status,
    'code', v_attempt.code,
    'tests_passed', v_attempt.tests_passed,
    'tests_total', v_attempt.tests_total,
    'started_at', v_attempt.started_at);
end;
$$;

create or replace function public.begin_quest_run(p_user uuid, p_quest_id uuid)
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
  if not found or not public.quest_open_for(p_user, p_quest_id) then raise exception 'quest not available'; end if;

  select status into v_status from public.quest_attempts where user_id = p_user and quest_id = p_quest_id;
  if not found then raise exception 'start the quest first'; end if;
  if v_quest.entry_point is null then raise exception 'quest has no entry point yet'; end if;

  delete from public.quest_runs where ran_at < now() - interval '1 day';
  select count(*) filter (where ran_at > now() - interval '1 minute'), count(*)
    into v_minute, v_day from public.quest_runs where user_id = p_user;
  if v_minute >= 6 or v_day >= 150 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_runs');
  end if;
  insert into public.quest_runs (user_id, quest_id) values (p_user, p_quest_id);

  return jsonb_build_object(
    'allowed', true,
    'practice', v_status = 'solved',
    'language', v_quest.language,
    'entry_point', v_quest.entry_point,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'input', t.input, 'expected', t.expected) order by t.position, t.id)
        from public.quest_tests t where t.quest_id = p_quest_id), '[]'::jsonb));
end $$;

revoke execute on function public.begin_quest_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_quest_run(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Each member's own quest of the day
-- ---------------------------------------------------------------------
create or replace function public.quest_of_the_day()
returns table (
  quest_id uuid,
  slug text,
  title text,
  summary text,
  clan public.clan_type,
  mastery public.mastery_type,
  topic text,
  language text,
  est_minutes integer,
  xp_reward integer,
  kopek_reward bigint,
  source text,
  day date,
  seconds_left integer,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_day date := current_date;
  v_id uuid := public.member_daily_quest(auth.uid());
begin
  if v_id is null then return; end if;
  return query
  select q.id, q.slug, q.title, q.summary, q.clan, q.mastery, q.topic, q.language, q.est_minutes,
         q.xp_reward, q.kopek_reward,
         case when public.drip_total() is not null then 'drip'
              when q.daily_on = v_day then 'scheduled' else 'automatic' end,
         v_day,
         greatest(0, extract(epoch from ((v_day + 1)::timestamp at time zone 'UTC') - now())::integer),
         (select a.status from public.quest_attempts a where a.quest_id = q.id and a.user_id = auth.uid())
    from public.quests q
   where q.id = v_id;
end $$;

-- The member's earlier days, from their own clock.
create or replace function public.list_past_daily_quests(p_days integer default 30)
returns table (day date, quest_id uuid, slug text, title text, clan public.clan_type, mastery public.mastery_type, language text, est_minutes integer, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_today integer := public.member_drip_day(auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if public.drip_total() is null then
    return query
    select d::date, q.id, q.slug, q.title, q.clan, q.mastery, q.language, q.est_minutes,
           (select a.status from public.quest_attempts a where a.quest_id = q.id and a.user_id = auth.uid())
      from generate_series(current_date - v_days, current_date - 1, interval '1 day') d
      join public.quests q on q.id = public.daily_quest_for(d::date)
     order by d desc;
    return;
  end if;
  return query
  select (current_date - k)::date, q.id, q.slug, q.title, q.clan, q.mastery, q.language, q.est_minutes,
         (select a.status from public.quest_attempts a where a.quest_id = q.id and a.user_id = auth.uid())
    from generate_series(1, least(v_days, v_today - 1)) k
    join public.quests q on q.id = public.drip_quest_for(v_today - k)
   order by k;
end $$;

-- How far along the member is.
create function public.my_quest_drip()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.drip_total() is null then null
         else jsonb_build_object('day', public.member_drip_day(auth.uid()), 'total', public.drip_total()) end
$$;

-- ---------------------------------------------------------------------
-- The daily bonus and the arena rule use the member's own quest of the day
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.record_graded_attempt(uuid, uuid, text, integer, integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'public.daily_quest_for(current_date)', 'public.member_daily_quest(v_user)');
  if v_def not like '%member_daily_quest(v_user)%' then raise exception 'record_graded_attempt was not updated'; end if;
  execute v_def;
end $$;

revoke execute on function public.drip_total() from public, anon, authenticated;
revoke execute on function public.member_drip_day(uuid) from public, anon, authenticated;
revoke execute on function public.drip_quest_for(integer) from public, anon, authenticated;
revoke execute on function public.member_daily_quest(uuid) from public, anon, authenticated;
revoke execute on function public.quest_open_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.quest_open(uuid) from public;
revoke execute on function public.my_quest_drip() from public, anon;
grant execute on function public.quest_open(uuid) to anon, authenticated;
grant execute on function public.my_quest_drip() to authenticated;
grant execute on function public.quest_open_for(uuid, uuid) to service_role;

commit;
