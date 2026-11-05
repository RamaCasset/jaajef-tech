-- jaajef.tech  -  Migration: the quest of the day
--
--   * One quest of the day, the same for everyone, shown with its rewards, its
--     difficulty and the time left until the day ends (Senegal is on UTC).
--   * Staff (admins) can schedule a quest for a day, up to a year ahead.
--   * If nobody scheduled one, the database picks one automatically, the same
--     for everyone all day, so the banner is never empty. Quests scheduled for
--     a later day are kept out of that choice. No background job is needed.
--   * A signed-in member also sees whether they started or solved it.
--   * No extra reward for the daily quest yet: it pays the usual XP and Kopeks.
--
-- Limit: a quest has one daily date. Scheduling it again moves its date, so
-- the earlier day shows an automatic pick if anyone looks back.
--
-- Requires: quests, staff roles.

begin;

-- ---------------------------------------------------------------------
-- Which quest is the daily one for a given day (internal)
-- ---------------------------------------------------------------------
create function public.daily_quest_for(p_day date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select q.id from public.quests q where q.published and q.daily_on = p_day),
    (select q.id
       from public.quests q
      where q.published
        and (q.daily_on is null or q.daily_on < p_day)
      order by md5(q.id::text || p_day::text), q.id
      limit 1)
  )
$$;

-- ---------------------------------------------------------------------
-- Everyone: today's quest
-- ---------------------------------------------------------------------
create function public.quest_of_the_day()
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
  v_id uuid := public.daily_quest_for(current_date);
begin
  if v_id is null then return; end if;
  return query
  select q.id, q.slug, q.title, q.summary, q.clan, q.mastery, q.topic, q.language, q.est_minutes,
         q.xp_reward, q.kopek_reward,
         case when q.daily_on = v_day then 'scheduled' else 'automatic' end,
         v_day,
         greatest(0, extract(epoch from ((v_day + 1)::timestamp at time zone 'UTC') - now())::integer),
         (select a.status from public.quest_attempts a where a.quest_id = q.id and a.user_id = auth.uid())
    from public.quests q
   where q.id = v_id;
end $$;

-- ---------------------------------------------------------------------
-- Staff: schedule, clear, and look ahead
-- ---------------------------------------------------------------------
create function public.schedule_daily_quest(p_quest uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can schedule the quest of the day'; end if;
  if p_day is null or p_day < current_date then raise exception 'Choose today or a later day'; end if;
  if p_day > current_date + 365 then raise exception 'Choose a day within the next year'; end if;
  if not exists (select 1 from public.quests where id = p_quest and published) then
    raise exception 'Quest not found or not published';
  end if;
  if exists (select 1 from public.quests where daily_on = p_day and id <> p_quest) then
    raise exception 'Another quest is already scheduled for this day';
  end if;

  update public.quests set daily_on = p_day where id = p_quest;
  perform public.log_admin_action(auth.uid(), 'daily_quest_scheduled', 'quest', p_quest::text,
                                  jsonb_build_object('day', p_day));
end $$;

create function public.unschedule_daily_quest(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quest uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can change the quest of the day'; end if;
  if p_day is null or p_day < current_date then raise exception 'Choose today or a later day'; end if;

  update public.quests set daily_on = null where daily_on = p_day returning id into v_quest;
  if found then
    perform public.log_admin_action(auth.uid(), 'daily_quest_cleared', 'quest', v_quest::text,
                                    jsonb_build_object('day', p_day));
  end if;
end $$;

create function public.list_daily_quests(p_from date default current_date, p_days integer default 14)
returns table (day date, quest_id uuid, slug text, title text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null then raise exception 'Only staff can see the schedule'; end if;
  return query
  select d::date, q.id, q.slug, q.title,
         case when q.daily_on = d::date then 'scheduled' else 'automatic' end
    from generate_series(coalesce(p_from, current_date),
                         coalesce(p_from, current_date) + (least(greatest(coalesce(p_days, 14), 1), 60) - 1),
                         interval '1 day') d
    left join public.quests q on q.id = public.daily_quest_for(d::date)
   order by d;
end $$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function public.daily_quest_for(date) from public, anon, authenticated;
revoke execute on function public.quest_of_the_day() from public;
revoke execute on function public.schedule_daily_quest(uuid, date) from public, anon;
revoke execute on function public.unschedule_daily_quest(date) from public, anon;
revoke execute on function public.list_daily_quests(date, integer) from public, anon;
grant execute on function public.quest_of_the_day() to anon, authenticated;
grant execute on function public.schedule_daily_quest(uuid, date) to authenticated;
grant execute on function public.unschedule_daily_quest(date) to authenticated;
grant execute on function public.list_daily_quests(date, integer) to authenticated;

commit;
