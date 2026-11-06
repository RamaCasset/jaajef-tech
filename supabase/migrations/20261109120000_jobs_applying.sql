-- jaajef.tech  -  Migration: Jobs, part 3 (applying)
--
--   * A signed-in member applies to an offer on the board, with an optional
--     message. The company gets a copy of the application file as it was at that
--     moment, and the CV if the member includes it. The copy cannot change later.
--   * One application per member per offer; not to your own offers; a limit per
--     day. The file needs at least a headline.
--   * The applicant can withdraw at any time. Withdrawing erases the message,
--     the copy of the file and the CV link from that application.
--   * The company sees the applicants of its offers and marks each as seen,
--     shortlisted or declined. Statuses only move forward; declined is final.
--   * Only the company applied to can open the CV. Its access ends 90 days after
--     the application is declined or the offer is closed, and at once on
--     withdrawal. Erasing the CV or the file also cuts the access.
--   * The company is told about a new application, the applicant about each
--     decision (the notifications piece).
--   * "My applications" shows each application with its status.
--
-- Not here: saved offers and alerts, the email summary, the talent directory.
--
-- Requires: Jobs parts 1 and 2, notifications, moderation (suspended_until).

begin;

insert into public.game_config (key, value, status, description) values
  ('job_applications_max_per_day', '20', 'defined', 'Most applications one member can send per day'),
  ('application_cv_access_days', '90', 'defined', 'Days a company can still open a CV after declining the application or closing the offer'),
  ('application_min_completion', '0', 'tbc', 'Least completion percentage of the application file needed to apply (0 = none; to decide with Marie)');

-- New kinds of notice.
create or replace function public.notification_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'project_starred', 'project_comment', 'project_confirmed', 'project_hidden',
    'collab_request', 'collab_accepted', 'collab_declined',
    'join_request', 'join_approved', 'join_declined',
    'badge_unlocked', 'warning', 'suspension',
    'new_application', 'application_seen', 'application_shortlisted', 'application_declined'
  ]
$$;

-- ---------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------
create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  -- The offer may be deleted later; the applicant keeps the record of what they applied to.
  offer_id uuid references public.job_offers (id) on delete set null,
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  offer_title text not null,
  employer_name text not null,
  message text check (char_length(message) <= 2000),
  -- The application file as it was when the member applied.
  profile_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(profile_snapshot) = 'object'),
  cv_path text,
  cv_name text,
  cv_size integer,
  status text not null default 'submitted' check (status in ('submitted', 'seen', 'shortlisted', 'declined', 'withdrawn')),
  declined_at timestamptz,
  offer_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cv_path is null and cv_name is null and cv_size is null) or (cv_path is not null and cv_name is not null and cv_size is not null)),
  check (declined_at is null or status = 'declined')
);
create unique index job_applications_one_per_offer on public.job_applications (offer_id, applicant_id)
  where status <> 'withdrawn' and offer_id is not null;
create index job_applications_applicant on public.job_applications (applicant_id, created_at desc);
create index job_applications_offer on public.job_applications (offer_id, status, created_at desc);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Can the company still see this application (and open its CV)?
create function public.application_is_open(p_status text, p_declined_at timestamptz, p_closed_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_status <> 'withdrawn'
     and (p_declined_at is null or p_declined_at + make_interval(days => public.chat_setting('application_cv_access_days')) > now())
     and (p_closed_at is null or p_closed_at + make_interval(days => public.chat_setting('application_cv_access_days')) > now())
$$;

-- Is the caller the one who posted this offer?
create function public.owns_offer(p_offer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.job_offers where id = p_offer and posted_by = auth.uid())
$$;

-- May the caller open this CV file as the company the member applied to?
create function public.can_read_application_cv(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.job_applications a
      join public.job_offers o on o.id = a.offer_id
     where a.cv_path = p_path and o.posted_by = auth.uid()
       and public.application_is_open(a.status, a.declined_at, a.offer_closed_at)
  )
$$;

-- When an offer is closed or reopened, the clock on the CV access starts or stops.
create function public.track_offer_closing() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    update public.job_applications set offer_closed_at = now()
     where offer_id = new.id and status <> 'withdrawn' and offer_closed_at is null;
  elsif old.status = 'closed' and new.status <> 'closed' then
    update public.job_applications set offer_closed_at = null where offer_id = new.id;
  end if;
  return null;
end $$;

create trigger job_offers_closing after update of status on public.job_offers
  for each row execute function public.track_offer_closing();

-- ---------------------------------------------------------------------
-- Applying
-- ---------------------------------------------------------------------
create function public.apply_to_offer(p_offer uuid, p_message text default null, p_include_cv boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_offer public.job_offers;
  v_employer_name text;
  v_file public.application_files;
  v_pr public.profiles;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_snapshot jsonb;
  v_id uuid;
  v_min integer := public.chat_setting('application_min_completion');
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  if char_length(coalesce(v_message, '')) > 2000 then raise exception 'Your message is too long (2000 characters at most)'; end if;
  if not public.job_offer_is_listed(p_offer) then raise exception 'Offer not found'; end if;
  select * into v_offer from public.job_offers where id = p_offer;
  if v_offer.posted_by = v_me then raise exception 'You cannot apply to your own offer'; end if;

  -- Lock the member so two quick applications cannot both slip under the limit.
  select * into v_pr from public.profiles where id = v_me for update;
  if exists (select 1 from public.job_applications where offer_id = p_offer and applicant_id = v_me and status <> 'withdrawn') then
    raise exception 'You already applied to this offer';
  end if;
  if (select count(*) from public.job_applications where applicant_id = v_me and created_at > now() - interval '1 day')
       >= public.chat_setting('job_applications_max_per_day') then
    raise exception 'You are applying too fast, try again later';
  end if;

  select * into v_file from public.application_files where user_id = v_me;
  if not found or v_file.headline is null then raise exception 'Add a headline to your application file first'; end if;
  if v_min > 0 and (select completion from public.my_application_file()) < v_min then
    raise exception 'Complete your application file first (at least % percent)', v_min;
  end if;

  select name into v_employer_name from public.employers where id = v_offer.employer_id;
  v_snapshot := jsonb_build_object(
    'username', v_pr.username, 'display_name', v_pr.display_name, 'avatar_url', v_pr.avatar_url,
    'github_username', v_pr.github_username, 'clan', v_pr.clan,
    'headline', v_file.headline, 'summary', v_file.summary, 'location', v_file.location,
    'experience_years', v_file.experience_years, 'availability', v_file.availability,
    'work_kinds', to_jsonb(v_file.work_kinds), 'skills', to_jsonb(v_file.skills),
    'website', v_file.website, 'linkedin_url', v_file.linkedin_url,
    'portfolio', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', i.title, 'description', i.description, 'url', i.url,
               'project_title', p.title, 'project_repo', p.github_owner || '/' || p.github_repo)
             order by i.created_at)
        from public.portfolio_items i left join public.projects p on p.id = i.project_id
       where i.user_id = v_me), '[]'::jsonb)
  );

  insert into public.job_applications (offer_id, applicant_id, offer_title, employer_name, message, profile_snapshot, cv_path, cv_name, cv_size)
  values (p_offer, v_me, v_offer.title, v_employer_name, v_message, v_snapshot,
          case when p_include_cv then v_file.cv_path end,
          case when p_include_cv then v_file.cv_name end,
          case when p_include_cv then v_file.cv_size end)
  returning id into v_id;

  perform public.notify(v_offer.posted_by, 'new_application',
    jsonb_build_object('application_id', v_id, 'offer_id', p_offer, 'offer_title', v_offer.title, 'applicant', v_pr.username),
    'application:' || v_id);
  return v_id;
end $$;

-- Takes the application back and erases what it carried.
create function public.withdraw_application(p_application uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.job_applications
     set status = 'withdrawn', message = null, profile_snapshot = '{}'::jsonb,
         cv_path = null, cv_name = null, cv_size = null, declined_at = null, updated_at = now()
   where id = p_application and applicant_id = auth.uid() and status <> 'withdrawn';
  if not found and not exists (select 1 from public.job_applications where id = p_application and applicant_id = auth.uid()) then
    raise exception 'Application not found';
  end if;
end $$;

-- The company moves an application forward: seen, then shortlisted, or declined at any point.
create function public.set_application_status(p_application uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.job_applications;
  v_rank_old integer;
  v_rank_new integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_status is null or p_status not in ('seen', 'shortlisted', 'declined') then raise exception 'Choose seen, shortlisted or declined'; end if;
  select a.* into v_a from public.job_applications a
   where a.id = p_application and public.owns_offer(a.offer_id)
     and public.application_is_open(a.status, a.declined_at, a.offer_closed_at)
   for update;
  if not found then raise exception 'Application not found'; end if;
  if v_a.status = p_status then return; end if;
  if v_a.status = 'declined' then raise exception 'A declined application cannot be changed'; end if;

  if p_status <> 'declined' then
    v_rank_old := case v_a.status when 'submitted' then 0 when 'seen' then 1 else 2 end;
    v_rank_new := case p_status when 'seen' then 1 else 2 end;
    if v_rank_new < v_rank_old then raise exception 'A status cannot go back'; end if;
  end if;

  update public.job_applications
     set status = p_status, declined_at = case when p_status = 'declined' then now() end, updated_at = now()
   where id = p_application;

  perform public.notify(v_a.applicant_id, 'application_' || p_status,
    jsonb_build_object('application_id', v_a.id, 'offer_title', v_a.offer_title, 'employer', v_a.employer_name),
    'application:' || v_a.id || ':' || p_status);
end $$;

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------
create function public.list_my_applications()
returns table (
  id uuid, offer_id uuid, offer_title text, employer_name text, status text,
  applied_at timestamptz, updated_at timestamptz, offer_open boolean, has_cv boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select a.id, a.offer_id, a.offer_title, a.employer_name, a.status, a.created_at, a.updated_at,
         coalesce(public.job_offer_is_listed(a.offer_id), false), a.cv_path is not null
    from public.job_applications a
   where a.applicant_id = auth.uid()
   order by a.created_at desc, a.id;
end $$;

create function public.list_offer_applicants(p_offer uuid, p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, applicant_id uuid, username text, display_name text, avatar_url text, headline text,
  skills text[], status text, applied_at timestamptz, has_cv boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not public.owns_offer(p_offer) then raise exception 'Offer not found'; end if;
  if p_status is not null and p_status not in ('submitted', 'seen', 'shortlisted', 'declined') then raise exception 'Unknown status'; end if;
  return query
  select a.id, a.applicant_id, a.profile_snapshot ->> 'username', a.profile_snapshot ->> 'display_name',
         a.profile_snapshot ->> 'avatar_url', a.profile_snapshot ->> 'headline',
         coalesce(array(select jsonb_array_elements_text(a.profile_snapshot -> 'skills')), '{}'),
         a.status, a.created_at, a.cv_path is not null
    from public.job_applications a
   where a.offer_id = p_offer and public.application_is_open(a.status, a.declined_at, a.offer_closed_at)
     and (p_status is null or a.status = p_status)
   order by a.created_at desc, a.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- The caller's own CV files that nothing uses any more: the app deletes them from storage.
create function public.list_unused_cv_files()
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select o.name
    from storage.objects o
   where o.bucket_id = 'cv-files' and (storage.foldername(o.name))[1] = auth.uid()::text
     and o.name is distinct from (select f.cv_path from public.application_files f where f.user_id = auth.uid())
     and not exists (select 1 from public.job_applications a where a.applicant_id = auth.uid() and a.cv_path = o.name);
end $$;

-- ---------------------------------------------------------------------
-- The CV functions from part 2, now aware of applications
-- ---------------------------------------------------------------------

create or replace function public.set_cv(p_path text, p_name text, p_size integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_old text;
  v_max bigint := public.chat_setting('cv_max_mb')::bigint * 1024 * 1024;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_path is null or p_path !~ ('^' || v_me::text || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'The CV must be a PDF in your own folder';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 or lower(btrim(p_name)) !~ '\.pdf$' then
    raise exception 'The CV must be a PDF file';
  end if;
  if char_length(btrim(p_name)) > 120 then raise exception 'The file name is too long (120 characters at most)'; end if;
  if p_size is null or p_size <= 0 or p_size > v_max then
    raise exception 'The CV is too large (% MB at most)', public.chat_setting('cv_max_mb');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'cv-files' and name = p_path) then
    raise exception 'The file was not uploaded';
  end if;

  select cv_path into v_old from public.application_files where user_id = v_me;
  insert into public.application_files (user_id, cv_path, cv_name, cv_size, cv_uploaded_at)
  values (v_me, p_path, btrim(p_name), p_size, now())
  on conflict (user_id) do update
    set cv_path = excluded.cv_path, cv_name = excluded.cv_name, cv_size = excluded.cv_size,
        cv_uploaded_at = excluded.cv_uploaded_at, updated_at = now();
  -- An application that already went out keeps the CV it was sent with.
  return case when v_old is distinct from p_path
               and not exists (select 1 from public.job_applications where cv_path = v_old)
              then v_old end;
end $$;

create or replace function public.remove_cv()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select cv_path into v_old from public.application_files where user_id = auth.uid();
  update public.application_files
     set cv_path = null, cv_name = null, cv_size = null, cv_uploaded_at = null, updated_at = now()
   where user_id = auth.uid();
  -- Companies can no longer open it.
  update public.job_applications set cv_path = null, cv_name = null, cv_size = null where applicant_id = auth.uid();
  return v_old;
end $$;

create or replace function public.delete_application_file()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_path text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select cv_path into v_path from public.application_files where user_id = v_me;
  delete from public.portfolio_items where user_id = v_me;
  delete from public.application_files where user_id = v_me;
  -- Companies can no longer open the CV (what they were already sent stays with them).
  update public.job_applications set cv_path = null, cv_name = null, cv_size = null where applicant_id = v_me;
  return v_path;
end $$;


-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.job_applications enable row level security;
revoke all on public.job_applications from public, anon, authenticated;
grant select on public.job_applications to authenticated;

create policy "applicants see their own applications" on public.job_applications for select to authenticated
  using (applicant_id = (select auth.uid()));
create policy "companies see applications to their offers" on public.job_applications for select to authenticated
  using (public.owns_offer(offer_id) and public.application_is_open(status, declined_at, offer_closed_at));

revoke execute on function public.application_is_open(text, timestamptz, timestamptz) from public, anon;
revoke execute on function public.owns_offer(uuid) from public, anon;
revoke execute on function public.can_read_application_cv(text) from public, anon;
revoke execute on function public.track_offer_closing() from public, anon, authenticated;
grant execute on function public.application_is_open(text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.owns_offer(uuid) to authenticated, service_role;
grant execute on function public.can_read_application_cv(text) to authenticated, service_role;

revoke execute on function public.apply_to_offer(uuid, text, boolean) from public, anon;
revoke execute on function public.withdraw_application(uuid) from public, anon;
revoke execute on function public.set_application_status(uuid, text) from public, anon;
revoke execute on function public.list_my_applications() from public, anon;
revoke execute on function public.list_offer_applicants(uuid, text, integer, integer) from public, anon;
revoke execute on function public.list_unused_cv_files() from public, anon;
grant execute on function public.apply_to_offer(uuid, text, boolean) to authenticated;
grant execute on function public.withdraw_application(uuid) to authenticated;
grant execute on function public.set_application_status(uuid, text) to authenticated;
grant execute on function public.list_my_applications() to authenticated;
grant execute on function public.list_offer_applicants(uuid, text, integer, integer) to authenticated;
grant execute on function public.list_unused_cv_files() to authenticated;

grant all on public.job_applications to service_role;

-- The company applied to can open the CV it was sent (the member's own rule from part 2 stays).
create policy "companies open the CVs of their applicants"
  on storage.objects for select to authenticated
  using (bucket_id = 'cv-files' and public.can_read_application_cv(name));

commit;
