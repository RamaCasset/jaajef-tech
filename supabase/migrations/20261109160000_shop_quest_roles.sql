-- jaajef.tech  -  Migration: quest writer, shop manager and shop owner roles
--
--   * Three back-office roles, kept in their OWN table, separate from admin and moderator:
--       quest_writer  - works on quests (schedules the quest of the day; quest writing tools come next)
--       shop_manager  - works on the shop (chooses the featured item; reviewing creator submissions comes next)
--       shop_owner    - everything a shop manager does, plus (later) the creator share and earnings
--     Admins can do everything these roles do.
--   * Why a separate table: many moderation tools treat "has any staff role" as moderation staff.
--     Putting these roles in the staff table would let a quest writer hide job offers or read reports.
--   * Only admins grant or remove these roles. Every change is written to the audit log.
--   * A member can hold several of these roles, and can also be a moderator.
--
-- Requires: staff roles, quest of the day, Souk extras.

begin;

create table public.back_office_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('quest_writer', 'shop_manager', 'shop_owner')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create function public.can_write_quests()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.back_office_roles where user_id = auth.uid() and role = 'quest_writer')
  )
$$;

-- A shop owner can do everything a shop manager can.
create function public.can_manage_shop()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.back_office_roles where user_id = auth.uid() and role in ('shop_manager', 'shop_owner'))
  )
$$;

create function public.is_shop_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (select 1 from public.back_office_roles where user_id = auth.uid() and role = 'shop_owner')
  )
$$;

-- ---------------------------------------------------------------------
-- Admins grant and remove
-- ---------------------------------------------------------------------
create function public.set_back_office_role(p_user uuid, p_role text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;
  if p_role is null or p_role not in ('quest_writer', 'shop_manager', 'shop_owner') then
    raise exception 'Unknown role (quest_writer, shop_manager or shop_owner)';
  end if;
  if p_on is null then raise exception 'Say whether to give or remove the role'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found'; end if;

  if p_on then
    insert into public.back_office_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid())
    on conflict do nothing;
    if found then
      perform public.log_admin_action(auth.uid(), 'back_office_role_granted', 'member', p_user::text,
                                      jsonb_build_object('role', p_role));
    end if;
  else
    delete from public.back_office_roles where user_id = p_user and role = p_role;
    if found then
      perform public.log_admin_action(auth.uid(), 'back_office_role_revoked', 'member', p_user::text,
                                      jsonb_build_object('role', p_role));
    end if;
  end if;
end $$;

create function public.list_back_office_team()
returns table (user_id uuid, username text, role text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;
  return query
    select r.user_id, p.username, r.role, r.granted_at
      from public.back_office_roles r
      join public.profiles p on p.id = r.user_id
     order by r.role, p.username;
end $$;

-- What the app should show me: my roles, with admin counting for all.
create function public.my_back_office_access()
returns table (quest_writer boolean, shop_manager boolean, shop_owner boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query select public.can_write_quests(), public.can_manage_shop(), public.is_shop_owner();
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.back_office_roles enable row level security;
revoke all on public.back_office_roles from public, anon, authenticated;
grant select on public.back_office_roles to authenticated;
create policy "you see your own back-office roles, admins see everyone's"
  on public.back_office_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke execute on function public.can_write_quests() from public, anon;
revoke execute on function public.can_manage_shop() from public, anon;
revoke execute on function public.is_shop_owner() from public, anon;
revoke execute on function public.set_back_office_role(uuid, text, boolean) from public, anon;
revoke execute on function public.list_back_office_team() from public, anon;
revoke execute on function public.my_back_office_access() from public, anon;
grant execute on function public.can_write_quests() to authenticated, service_role;
grant execute on function public.can_manage_shop() to authenticated, service_role;
grant execute on function public.is_shop_owner() to authenticated, service_role;
grant execute on function public.set_back_office_role(uuid, text, boolean) to authenticated;
grant execute on function public.list_back_office_team() to authenticated;
grant execute on function public.my_back_office_access() to authenticated;

grant all on public.back_office_roles to service_role;

-- Existing admin-only tools, now open to the matching role (admins still can).
create or replace function public.set_featured_item(p_item uuid, p_day date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
  v_previous uuid;
begin
  if not public.can_manage_shop() then raise exception 'Only an admin or a shop manager can choose the featured item'; end if;
  if p_day is null then p_day := current_date; end if;
  v_week := date_trunc('week', p_day)::date;
  if v_week < date_trunc('week', current_date)::date then raise exception 'Choose this week or a later one'; end if;
  if p_day > current_date + 365 then raise exception 'Choose a day within the next year'; end if;
  if not exists (select 1 from public.souk_items where id = p_item and is_active) then
    raise exception 'Item not found or not for sale';
  end if;

  select item_id into v_previous from public.souk_featured where week_start = v_week;
  if v_previous is not distinct from p_item then return; end if;

  insert into public.souk_featured (week_start, item_id, set_by) values (v_week, p_item, auth.uid())
  on conflict (week_start) do update set item_id = excluded.item_id, set_by = excluded.set_by, created_at = now();

  perform public.log_admin_action(auth.uid(), 'souk_featured_set', 'souk_item', p_item::text,
                                  jsonb_build_object('week', v_week, 'previous', v_previous));
end $$;

create or replace function public.clear_featured_item(p_day date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
  v_item uuid;
begin
  if not public.can_manage_shop() then raise exception 'Only an admin or a shop manager can change the featured item'; end if;
  if p_day is null then p_day := current_date; end if;
  v_week := date_trunc('week', p_day)::date;
  if v_week < date_trunc('week', current_date)::date then raise exception 'Choose this week or a later one'; end if;

  delete from public.souk_featured where week_start = v_week returning item_id into v_item;
  if found then
    perform public.log_admin_action(auth.uid(), 'souk_featured_cleared', 'souk_item', v_item::text,
                                    jsonb_build_object('week', v_week));
  end if;
end $$;

create or replace function public.list_featured_schedule(p_weeks integer default 8)
returns table (week_start date, item_id uuid, slug text, name text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null and not public.can_manage_shop() then raise exception 'Only staff can see the schedule'; end if;
  return query
  select w::date, i.id, i.slug, i.name,
         case when f.item_id is not null then 'chosen' else 'automatic' end
    from generate_series(date_trunc('week', current_date)::date,
                         date_trunc('week', current_date)::date + (least(greatest(coalesce(p_weeks, 8), 1), 52) - 1) * 7,
                         interval '7 days') w
    left join public.souk_featured f on f.week_start = w::date
    left join public.souk_items i on i.id = coalesce(
           (select f2.item_id from public.souk_featured f2
              join public.souk_items a on a.id = f2.item_id and a.is_active
             where f2.week_start = w::date),
           (select a.id from public.souk_items a where a.is_active order by a.created_at desc, a.id limit 1))
   order by w;
end $$;

create or replace function public.schedule_daily_quest(p_quest uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_write_quests() then raise exception 'Only an admin or a quest writer can schedule the quest of the day'; end if;
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

create or replace function public.unschedule_daily_quest(p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quest uuid;
begin
  if not public.can_write_quests() then raise exception 'Only an admin or a quest writer can change the quest of the day'; end if;
  if p_day is null or p_day < current_date then raise exception 'Choose today or a later day'; end if;

  update public.quests set daily_on = null where daily_on = p_day returning id into v_quest;
  if found then
    perform public.log_admin_action(auth.uid(), 'daily_quest_cleared', 'quest', v_quest::text,
                                    jsonb_build_object('day', p_day));
  end if;
end $$;

create or replace function public.list_daily_quests(p_from date default current_date, p_days integer default 14)
returns table (day date, quest_id uuid, slug text, title text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null and not public.can_write_quests() then raise exception 'Only staff can see the schedule'; end if;
  return query
  select d::date, q.id, q.slug, q.title,
         case when q.daily_on = d::date then 'scheduled' else 'automatic' end
    from generate_series(coalesce(p_from, current_date),
                         coalesce(p_from, current_date) + (least(greatest(coalesce(p_days, 14), 1), 60) - 1),
                         interval '1 day') d
    left join public.quests q on q.id = public.daily_quest_for(d::date)
   order by d;
end $$;

commit;
