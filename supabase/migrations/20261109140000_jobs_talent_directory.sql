-- Jobs part 5: the talent directory (opt-in).
--
--   * A member chooses to be listed. Default: not listed. Leaving is one call.
--   * The listing shows the member's application file as it is now (headline, text, place,
--     years, availability, kinds of work, skills, portfolio count). The CV is never shown here.
--   * Only owners of an approved company or hiring profile can browse the directory.
--     Contact goes through the normal direct messages.
--   * Members who say "not looking" are not shown. Suspended members are not shown.
--   * Staff can hide a listing, with a reason (written to the audit log).
--
-- Requires: Jobs parts 1 to 3, moderation (suspended_until).

begin;

insert into public.game_config (key, value, status, description) values
  ('talent_min_completion', '60', 'tbc', 'Least completion percentage of the application file needed to join the talent directory (to decide with Marie)');

create table public.talent_listings (
  user_id uuid primary key references public.application_files (user_id) on delete cascade,
  -- The member's choice. Leaving only switches this off, so a staff hide survives leaving and rejoining.
  active boolean not null default true,
  listed_at timestamptz not null default now(),
  staff_hidden boolean not null default false
);
create index talent_listings_recent on public.talent_listings (listed_at desc) where active and not staff_hidden;

-- ---------------------------------------------------------------------
-- Member
-- ---------------------------------------------------------------------
create function public.join_talent_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_file record;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  select * into v_file from public.my_application_file();
  if v_file.headline is null then raise exception 'Fill in your application file (at least a headline) first'; end if;
  if v_file.availability is null or v_file.availability = 'not_looking' then
    raise exception 'Set your availability (not "not looking") to appear in the directory';
  end if;
  if v_file.completion < public.chat_setting('talent_min_completion') then
    raise exception 'Complete at least % percent of your application file to appear in the directory', public.chat_setting('talent_min_completion');
  end if;
  insert into public.talent_listings (user_id) values (v_me)
  on conflict (user_id) do update set active = true, listed_at = case when talent_listings.active then talent_listings.listed_at else now() end;
end $$;

create function public.leave_talent_directory()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  update public.talent_listings set active = false where user_id = v_me and active;
end $$;

-- Am I listed, and is it visible right now?
create function public.my_talent_listing()
returns table (listed boolean, visible boolean, hidden_by_staff boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query
  select coalesce(t.active, false),
         (coalesce(t.active, false) and not t.staff_hidden and f.availability is distinct from 'not_looking'
          and f.headline is not null),
         coalesce(t.staff_hidden, false)
    from (select 1) x
    left join public.talent_listings t on t.user_id = v_me
    left join public.application_files f on f.user_id = v_me;
end $$;

-- ---------------------------------------------------------------------
-- Employers
-- ---------------------------------------------------------------------
create function public.can_browse_talent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.employers e where e.owner_id = auth.uid() and e.status = 'approved'
  )
$$;

create function public.talent_is_visible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.talent_listings t
      join public.application_files f on f.user_id = t.user_id
     where t.user_id = p_user and t.active and not t.staff_hidden
       and f.headline is not null and f.availability is distinct from 'not_looking'
       and public.suspended_until(t.user_id) is null
  )
$$;

create function public.search_talent(
  p_query text default null, p_skill text default null, p_location text default null,
  p_work_kind text default null, p_availability text default null, p_min_years integer default null,
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  user_id uuid, username text, display_name text, avatar_url text, headline text, summary text,
  location text, experience_years integer, availability text, work_kinds text[], skills text[],
  portfolio_count integer, listed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_place text := nullif(btrim(coalesce(p_location, '')), '');
  v_skill text := nullif(lower(btrim(coalesce(p_skill, ''))), '');
  v_pattern text;
  v_place_pattern text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not public.can_browse_talent() then raise exception 'Only approved companies and people hiring can browse the talent directory'; end if;
  if p_work_kind is not null and p_work_kind not in ('job', 'freelance') then raise exception 'Unknown kind of work'; end if;
  if p_availability is not null and p_availability not in ('immediate', 'within_month', 'within_3_months') then
    raise exception 'Unknown availability';
  end if;
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(left(v_query, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if v_place is not null then
    v_place_pattern := '%' || replace(replace(replace(left(v_place, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select f.user_id, p.username, p.display_name, p.avatar_url, f.headline, f.summary, f.location,
         f.experience_years::integer, f.availability, f.work_kinds, f.skills,
         (select count(*)::integer from public.portfolio_items i where i.user_id = f.user_id), t.listed_at
    from public.talent_listings t
    join public.application_files f on f.user_id = t.user_id
    join public.profiles p on p.id = t.user_id
   where public.talent_is_visible(t.user_id)
     and (v_query is null or f.headline ilike v_pattern or f.summary ilike v_pattern
          or exists (select 1 from unnest(f.skills) k where k ilike v_pattern))
     and (v_skill is null or v_skill = any (f.skills))
     and (v_place is null or f.location ilike v_place_pattern)
     and (p_work_kind is null or p_work_kind = any (f.work_kinds))
     and (p_availability is null or f.availability = p_availability)
     and (p_min_years is null or f.experience_years >= p_min_years)
   order by t.listed_at desc, t.user_id
   limit least(greatest(coalesce(p_limit, 20), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- One person's listing with their portfolio and links (still no CV).
create function public.get_talent(p_user uuid)
returns table (
  user_id uuid, username text, display_name text, avatar_url text, headline text, summary text,
  location text, experience_years integer, availability text, work_kinds text[], skills text[],
  website text, linkedin_url text, portfolio jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not public.can_browse_talent() then raise exception 'Only approved companies and people hiring can browse the talent directory'; end if;
  if not public.talent_is_visible(p_user) then raise exception 'Profile not found'; end if;
  return query
  select f.user_id, p.username, p.display_name, p.avatar_url, f.headline, f.summary, f.location,
         f.experience_years::integer, f.availability, f.work_kinds, f.skills, f.website, f.linkedin_url,
         coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'description', i.description, 'url', i.url)
                                    order by i.created_at, i.id)
                     from public.portfolio_items i where i.user_id = f.user_id), '[]'::jsonb)
    from public.application_files f
    join public.profiles p on p.id = f.user_id
   where f.user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------
create function public.set_talent_hidden(p_user uuid, p_hidden boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.staff_role() is null then raise exception 'Only staff can hide a listing'; end if;
  if p_hidden is null then raise exception 'Choose hide or show'; end if;
  if p_hidden and (p_reason is null or char_length(btrim(p_reason)) = 0) then raise exception 'Give a reason for hiding the listing'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'The reason is too long (500 characters at most)'; end if;

  update public.talent_listings set staff_hidden = p_hidden
   where user_id = p_user and staff_hidden is distinct from p_hidden;
  if found then
    perform public.log_admin_action(auth.uid(), case when p_hidden then 'talent_hidden' else 'talent_unhidden' end,
                                    'member', p_user::text,
                                    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
  elsif not exists (select 1 from public.talent_listings where user_id = p_user) then
    raise exception 'Listing not found';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.talent_listings enable row level security;
revoke all on public.talent_listings from public, anon, authenticated;
grant select on public.talent_listings to authenticated;
create policy "members see their own listing" on public.talent_listings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "staff see every listing" on public.talent_listings for select to authenticated
  using (public.staff_role() is not null);

revoke execute on function public.join_talent_directory() from public, anon;
revoke execute on function public.leave_talent_directory() from public, anon;
revoke execute on function public.my_talent_listing() from public, anon;
revoke execute on function public.can_browse_talent() from public, anon;
revoke execute on function public.talent_is_visible(uuid) from public, anon, authenticated;
revoke execute on function public.search_talent(text, text, text, text, text, integer, integer, integer) from public, anon;
revoke execute on function public.get_talent(uuid) from public, anon;
revoke execute on function public.set_talent_hidden(uuid, boolean, text) from public, anon;

grant execute on function public.join_talent_directory() to authenticated;
grant execute on function public.leave_talent_directory() to authenticated;
grant execute on function public.my_talent_listing() to authenticated;
grant execute on function public.can_browse_talent() to authenticated;
grant execute on function public.search_talent(text, text, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.get_talent(uuid) to authenticated;
grant execute on function public.set_talent_hidden(uuid, boolean, text) to authenticated;

grant all on public.talent_listings to service_role;

commit;
