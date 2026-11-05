-- jaajef.tech  -  Migration: Jobs, part 1 (employers and job offers)
--
--   * A member can create one employer profile: a company, or an individual
--     who hires freelancers (name, description, website, logo, place).
--   * A company must be approved once by staff before its offers go out.
--     Changing an approved company's name, website or logo sends it back for
--     review, so a name cannot be borrowed after approval.
--   * An individual's first offer waits for staff approval; approving it also
--     approves the individual, and later offers go out freely.
--   * An offer is a job or a freelance gig: title, description, pay range in
--     FCFA (or negotiable), place, remote option, tags, optional closing day.
--   * Offers start as drafts. Publishing is limited per day and per number of
--     open offers. Anyone, even a visitor, can search the board.
--   * Staff review the queue, and can hide an offer at any time (logged once
--     per real change).
--   * Suspended members cannot create, edit or publish.
--
-- Pay is always in FCFA. Applications, the application file, saved offers and
-- alerts come in the next parts. Reporting an offer from the report button comes
-- with the piece that adds more report types.
--
-- Requires: staff roles, moderation (suspended_until), projects (clean_tags).

begin;

insert into public.game_config (key, value, status, description) values
  ('job_offers_max_per_day', '3', 'defined', 'Most offers one employer can publish for the first time per day'),
  ('job_offers_max_open', '20', 'defined', 'Most drafts, waiting and published offers one employer can have at once');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.employers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('company', 'individual')),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (char_length(description) <= 1000),
  website text check (website ~ '^https://' and char_length(website) <= 300),
  logo_url text check (logo_url ~ '^https://' and char_length(logo_url) <= 500),
  location text check (char_length(location) <= 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Kept only while the profile is rejected, so it never shows on a public row.
  review_note text check (char_length(review_note) <= 500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_note is null or status = 'rejected')
);

create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  posted_by uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  kind text not null check (kind in ('job', 'freelance')),
  description text not null check (char_length(btrim(description)) between 1 and 10000),
  employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  location text check (char_length(location) <= 100),
  remote text not null default 'onsite' check (remote in ('onsite', 'hybrid', 'remote')),
  pay_min_fcfa bigint check (pay_min_fcfa between 0 and 100000000000),
  pay_max_fcfa bigint check (pay_max_fcfa between 0 and 100000000000),
  pay_unit text check (pay_unit in ('hour', 'day', 'month', 'year', 'project')),
  pay_negotiable boolean not null default false,
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'closed', 'rejected')),
  -- Kept only while the offer is rejected.
  review_note text check (char_length(review_note) <= 500),
  staff_hidden boolean not null default false,
  closes_on date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'job' and employment_type is not null) or (kind = 'freelance' and employment_type is null)),
  check (pay_max_fcfa is null or pay_min_fcfa is null or pay_max_fcfa >= pay_min_fcfa),
  check ((pay_min_fcfa is null and pay_max_fcfa is null) or pay_unit is not null),
  check (status <> 'published' or published_at is not null),
  check (review_note is null or status = 'rejected')
);
create index job_offers_board on public.job_offers (published_at desc) where status = 'published' and not staff_hidden;
create index job_offers_employer on public.job_offers (employer_id, created_at desc);
create index job_offers_tags on public.job_offers using gin (tags);
create index job_offers_queue on public.job_offers (created_at) where status = 'pending_review';

-- ---------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------
-- On the public board: published, not hidden, employer approved, not past its closing day.
create function public.job_offer_is_listed(p_offer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.job_offers o
      join public.employers e on e.id = o.employer_id
     where o.id = p_offer and o.status = 'published' and not o.staff_hidden
       and e.status = 'approved'
       and (o.closes_on is null or o.closes_on >= current_date)
  )
$$;

create function public.employer_check_fields(p_name text, p_description text, p_website text, p_logo text, p_location text)
returns void
language plpgsql
immutable
as $$
begin
  if p_name is null or char_length(btrim(p_name)) < 2 then raise exception 'The name needs at least 2 characters'; end if;
  if char_length(btrim(p_name)) > 100 then raise exception 'The name is too long (100 characters at most)'; end if;
  if p_description is not null and char_length(btrim(p_description)) > 1000 then raise exception 'The description is too long (1000 characters at most)'; end if;
  if p_website is not null and btrim(p_website) <> '' and (btrim(p_website) !~ '^https://' or char_length(btrim(p_website)) > 300) then
    raise exception 'The website must be a secure (https) address';
  end if;
  if p_logo is not null and btrim(p_logo) <> '' and (btrim(p_logo) !~ '^https://' or char_length(btrim(p_logo)) > 500) then
    raise exception 'The logo must be a secure (https) address';
  end if;
  if p_location is not null and char_length(btrim(p_location)) > 100 then raise exception 'The place is too long (100 characters at most)'; end if;
end $$;

create function public.job_offer_check_fields(
  p_title text, p_kind text, p_description text, p_employment_type text, p_location text, p_remote text,
  p_pay_min bigint, p_pay_max bigint, p_pay_unit text, p_closes_on date
)
returns void
language plpgsql
stable
as $$
begin
  if p_title is null or char_length(btrim(p_title)) < 3 then raise exception 'The title needs at least 3 characters'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'The title is too long (120 characters at most)'; end if;
  if p_kind is null or p_kind not in ('job', 'freelance') then raise exception 'Choose job or freelance'; end if;
  if p_description is null or char_length(btrim(p_description)) = 0 then raise exception 'Write a description first'; end if;
  if char_length(btrim(p_description)) > 10000 then raise exception 'The description is too long (10000 characters at most)'; end if;
  if p_kind = 'job' and (p_employment_type is null or p_employment_type not in ('full_time', 'part_time', 'contract', 'internship')) then
    raise exception 'Choose the type of job: full_time, part_time, contract or internship';
  end if;
  if p_kind = 'freelance' and p_employment_type is not null then raise exception 'A freelance gig has no job type'; end if;
  if p_remote is null or p_remote not in ('onsite', 'hybrid', 'remote') then raise exception 'Choose onsite, hybrid or remote'; end if;
  if p_location is not null and char_length(btrim(p_location)) > 100 then raise exception 'The place is too long (100 characters at most)'; end if;
  if p_pay_min is not null and (p_pay_min < 0 or p_pay_min > 100000000000) then raise exception 'The pay is out of range'; end if;
  if p_pay_max is not null and (p_pay_max < 0 or p_pay_max > 100000000000) then raise exception 'The pay is out of range'; end if;
  if p_pay_min is not null and p_pay_max is not null and p_pay_max < p_pay_min then raise exception 'The highest pay cannot be below the lowest'; end if;
  if (p_pay_min is not null or p_pay_max is not null) and (p_pay_unit is null or p_pay_unit not in ('hour', 'day', 'month', 'year', 'project')) then
    raise exception 'Say what the pay is for: hour, day, month, year or project';
  end if;
  if p_closes_on is not null and (p_closes_on < current_date or p_closes_on > current_date + 365) then
    raise exception 'The closing day must be within the next year';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Employer profile
-- ---------------------------------------------------------------------
create function public.create_employer(
  p_kind text, p_name text, p_description text default null, p_website text default null,
  p_logo_url text default null, p_location text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  if p_kind is null or p_kind not in ('company', 'individual') then raise exception 'Choose company or individual'; end if;
  perform public.employer_check_fields(p_name, p_description, p_website, p_logo_url, p_location);
  if exists (select 1 from public.employers where owner_id = v_me) then raise exception 'You already have an employer profile'; end if;

  insert into public.employers (owner_id, kind, name, description, website, logo_url, location)
  values (v_me, p_kind, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_website, '')), ''), nullif(btrim(coalesce(p_logo_url, '')), ''),
          nullif(btrim(coalesce(p_location, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Edits the caller's own employer profile. Returns the status afterwards.
create function public.update_employer(
  p_name text, p_description text default null, p_website text default null,
  p_logo_url text default null, p_location text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_e public.employers;
  v_name text := btrim(coalesce(p_name, ''));
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_logo text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_identity_changed boolean;
  v_status text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  select * into v_e from public.employers where owner_id = v_me for update;
  if not found then raise exception 'You have no employer profile'; end if;
  perform public.employer_check_fields(p_name, p_description, p_website, p_logo_url, p_location);

  v_identity_changed := v_name is distinct from v_e.name or v_website is distinct from v_e.website or v_logo is distinct from v_e.logo_url;
  v_status := v_e.status;
  -- A rejected profile that is edited goes back for review; so does an approved
  -- company whose name, website or logo changed.
  if v_e.status = 'rejected' then
    v_status := 'pending';
  elsif v_e.status = 'approved' and v_e.kind = 'company' and v_identity_changed then
    v_status := 'pending';
  end if;

  update public.employers
     set name = v_name, description = nullif(btrim(coalesce(p_description, '')), ''),
         website = v_website, logo_url = v_logo, location = nullif(btrim(coalesce(p_location, '')), ''),
         status = v_status,
         review_note = case when v_status = 'rejected' then review_note else null end,
         reviewed_at = case when v_status = v_e.status then reviewed_at else null end,
         updated_at = now()
   where id = v_e.id;
  return v_status;
end $$;

create function public.delete_employer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.employers where owner_id = auth.uid();
  if not found then raise exception 'You have no employer profile'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Offers: write
-- ---------------------------------------------------------------------
create function public.create_job_offer(
  p_title text, p_kind text, p_description text, p_employment_type text default null,
  p_location text default null, p_remote text default 'onsite',
  p_pay_min bigint default null, p_pay_max bigint default null, p_pay_unit text default null,
  p_pay_negotiable boolean default false, p_tags text[] default '{}', p_closes_on date default null,
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_e public.employers;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  select * into v_e from public.employers where owner_id = v_me for update;
  if not found then raise exception 'Create your employer profile first'; end if;
  if v_e.status = 'rejected' then raise exception 'Your employer profile was rejected: edit it to send it for review again'; end if;
  perform public.job_offer_check_fields(p_title, p_kind, p_description, p_employment_type, p_location,
                                        p_remote, p_pay_min, p_pay_max, p_pay_unit, p_closes_on);

  if (select count(*) from public.job_offers where employer_id = v_e.id and status in ('draft', 'pending_review', 'published'))
       >= public.chat_setting('job_offers_max_open') then
    raise exception 'You have too many open offers: close or delete some first';
  end if;

  insert into public.job_offers (employer_id, posted_by, title, kind, description, employment_type, location, remote,
                                 pay_min_fcfa, pay_max_fcfa, pay_unit, pay_negotiable, tags, closes_on)
  values (v_e.id, v_me, btrim(p_title), p_kind, btrim(p_description), p_employment_type,
          nullif(btrim(coalesce(p_location, '')), ''), p_remote, p_pay_min, p_pay_max,
          case when p_pay_min is null and p_pay_max is null then null else p_pay_unit end,
          coalesce(p_pay_negotiable, false), public.clean_tags(p_tags), p_closes_on)
  returning id into v_id;

  if p_publish then perform public.publish_job_offer(v_id); end if;
  return v_id;
end $$;

create function public.update_job_offer(
  p_offer uuid, p_title text, p_kind text, p_description text, p_employment_type text default null,
  p_location text default null, p_remote text default 'onsite',
  p_pay_min bigint default null, p_pay_max bigint default null, p_pay_unit text default null,
  p_pay_negotiable boolean default false, p_tags text[] default '{}', p_closes_on date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_o public.job_offers;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  select * into v_o from public.job_offers where id = p_offer and posted_by = v_me for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_o.staff_hidden then raise exception 'This offer was hidden by staff'; end if;
  perform public.job_offer_check_fields(p_title, p_kind, p_description, p_employment_type, p_location,
                                        p_remote, p_pay_min, p_pay_max, p_pay_unit, p_closes_on);

  update public.job_offers
     set title = btrim(p_title), kind = p_kind, description = btrim(p_description), employment_type = p_employment_type,
         location = nullif(btrim(coalesce(p_location, '')), ''), remote = p_remote,
         pay_min_fcfa = p_pay_min, pay_max_fcfa = p_pay_max,
         pay_unit = case when p_pay_min is null and p_pay_max is null then null else p_pay_unit end,
         pay_negotiable = coalesce(p_pay_negotiable, false), tags = public.clean_tags(p_tags), closes_on = p_closes_on,
         -- A rejected offer that is edited goes back to a draft to be sent again.
         status = case when status = 'rejected' then 'draft' else status end,
         review_note = null, updated_at = now()
   where id = p_offer;
end $$;

-- Publishes an offer. Returns 'published', or 'pending_review' when an individual's
-- first offer has to wait for staff.
create function public.publish_job_offer(p_offer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_o public.job_offers;
  v_e public.employers;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  -- Lock the employer so two quick publications cannot both slip under the limit.
  select e.* into v_e from public.employers e where e.owner_id = v_me for update;
  if not found then raise exception 'Create your employer profile first'; end if;
  select * into v_o from public.job_offers where id = p_offer and posted_by = v_me for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_o.staff_hidden then raise exception 'This offer was hidden by staff'; end if;
  if v_e.status = 'rejected' then raise exception 'Your employer profile was rejected: edit it to send it for review again'; end if;
  if v_o.status = 'published' then return 'published'; end if;
  if v_o.status = 'pending_review' then return 'pending_review'; end if;
  if v_o.closes_on is not null and v_o.closes_on < current_date then raise exception 'The closing day has passed: change it first'; end if;

  if v_e.kind = 'company' and v_e.status <> 'approved' then
    raise exception 'Your company is waiting for approval';
  end if;

  if v_e.status <> 'approved' then
    -- An individual's first offer: staff look at it before it goes out.
    update public.job_offers set status = 'pending_review', review_note = null, updated_at = now() where id = p_offer;
    return 'pending_review';
  end if;

  if v_o.published_at is null then
    if (select count(*) from public.job_offers
         where employer_id = v_e.id and published_at > now() - interval '1 day')
         >= public.chat_setting('job_offers_max_per_day') then
      raise exception 'You are publishing too fast, try again later';
    end if;
  end if;

  update public.job_offers
     set status = 'published', published_at = coalesce(published_at, now()), review_note = null, updated_at = now()
   where id = p_offer;
  return 'published';
end $$;

-- Takes a published offer off the board but keeps it.
create function public.close_job_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.job_offers set status = 'closed', updated_at = now()
   where id = p_offer and posted_by = auth.uid() and status = 'published';
  if not found then raise exception 'Only your own published offer can be closed'; end if;
end $$;

-- Back to a private draft (also withdraws an offer waiting for review).
create function public.unpublish_job_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.job_offers set status = 'draft', updated_at = now()
   where id = p_offer and posted_by = auth.uid();
  if not found then raise exception 'Offer not found'; end if;
end $$;

create function public.delete_job_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.job_offers where id = p_offer and posted_by = auth.uid();
  if not found then raise exception 'Offer not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Staff: review queue, decisions, hiding
-- ---------------------------------------------------------------------
create function public.list_review_queue()
returns table (kind text, id uuid, title text, owner_username text, employer_kind text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null then raise exception 'Only staff can see the review queue'; end if;
  return query
  select 'employer'::text, e.id, e.name, p.username, e.kind, e.created_at
    from public.employers e join public.profiles p on p.id = e.owner_id
   where e.status = 'pending' and e.kind = 'company'
  union all
  select 'offer'::text, o.id, o.title, p.username, e.kind, o.created_at
    from public.job_offers o
    join public.employers e on e.id = o.employer_id
    join public.profiles p on p.id = o.posted_by
   where o.status = 'pending_review'
  order by 6, 2;
end $$;

create function public.review_employer(p_employer uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.employers;
  v_new text := case when p_approve then 'approved' else 'rejected' end;
begin
  if public.staff_role() is null then raise exception 'Only staff can review employers'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and (p_note is null or char_length(btrim(p_note)) = 0) then raise exception 'Give a reason for the rejection'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'The note is too long (500 characters at most)'; end if;

  select * into v_e from public.employers where id = p_employer for update;
  if not found then raise exception 'Employer not found'; end if;
  if v_e.status = v_new then return; end if;

  update public.employers
     set status = v_new, review_note = case when p_approve then null else btrim(p_note) end,
         reviewed_at = now(), updated_at = now()
   where id = p_employer;
  perform public.log_admin_action(auth.uid(), case when p_approve then 'employer_approved' else 'employer_rejected' end,
                                  'employer', p_employer::text,
                                  jsonb_build_object('previous', v_e.status, 'note', case when p_approve then null else btrim(p_note) end));
end $$;

-- Decides on an offer waiting for review. Approving also approves its employer.
create function public.review_job_offer(p_offer uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.job_offers;
  v_e public.employers;
begin
  if public.staff_role() is null then raise exception 'Only staff can review offers'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if not p_approve and (p_note is null or char_length(btrim(p_note)) = 0) then raise exception 'Give a reason for the rejection'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'The note is too long (500 characters at most)'; end if;

  select * into v_o from public.job_offers where id = p_offer for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_o.status <> 'pending_review' then raise exception 'This offer is not waiting for review'; end if;
  select * into v_e from public.employers where id = v_o.employer_id for update;

  if p_approve then
    if v_e.status <> 'approved' then
      update public.employers set status = 'approved', review_note = null, reviewed_at = now(), updated_at = now() where id = v_e.id;
    end if;
    update public.job_offers
       set status = 'published', published_at = coalesce(published_at, now()), review_note = null, updated_at = now()
     where id = p_offer;
  else
    update public.job_offers set status = 'rejected', review_note = btrim(p_note), updated_at = now() where id = p_offer;
  end if;
  perform public.log_admin_action(auth.uid(), case when p_approve then 'job_offer_approved' else 'job_offer_rejected' end,
                                  'job_offer', p_offer::text,
                                  jsonb_build_object('employer_approved', p_approve and v_e.status <> 'approved',
                                                     'note', case when p_approve then null else btrim(p_note) end));
end $$;

create function public.set_job_offer_hidden(p_offer uuid, p_hidden boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.staff_role() is null then raise exception 'Only staff can hide offers'; end if;
  if p_hidden is null then raise exception 'Choose hide or show'; end if;
  if p_hidden and (p_reason is null or char_length(btrim(p_reason)) = 0) then raise exception 'Give a reason for hiding the offer'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'The reason is too long (500 characters at most)'; end if;

  update public.job_offers set staff_hidden = p_hidden, updated_at = now()
   where id = p_offer and staff_hidden is distinct from p_hidden;
  if found then
    perform public.log_admin_action(auth.uid(), case when p_hidden then 'job_offer_hidden' else 'job_offer_unhidden' end,
                                    'job_offer', p_offer::text,
                                    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
  elsif not exists (select 1 from public.job_offers where id = p_offer) then
    raise exception 'Offer not found';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Everyone: search the board
-- ---------------------------------------------------------------------
-- A pay filter needs a pay unit, since "300000 per month" and "300000 per year" are not comparable.
create function public.search_job_offers(
  p_query text default null, p_kind text default null, p_employment_type text default null,
  p_remote text default null, p_location text default null, p_tag text default null,
  p_min_pay bigint default null, p_pay_unit text default null, p_sort text default 'recent',
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, title text, kind text, employment_type text, location text, remote text,
  pay_min_fcfa bigint, pay_max_fcfa bigint, pay_unit text, pay_negotiable boolean, tags text[],
  closes_on date, published_at timestamptz,
  employer_id uuid, employer_name text, employer_kind text, employer_logo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_sort text := coalesce(p_sort, 'recent');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_place text := nullif(btrim(coalesce(p_location, '')), '');
  v_pattern text;
  v_place_pattern text;
begin
  if v_sort not in ('recent', 'pay') then raise exception 'Unknown sort'; end if;
  if p_min_pay is not null and p_pay_unit is null then raise exception 'Say what the pay is for (hour, day, month, year or project)'; end if;
  if v_query is not null then
    v_pattern := '%' || replace(replace(replace(left(v_query, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if v_place is not null then
    v_place_pattern := '%' || replace(replace(replace(left(v_place, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select o.id, o.title, o.kind, o.employment_type, o.location, o.remote,
         o.pay_min_fcfa, o.pay_max_fcfa, o.pay_unit, o.pay_negotiable, o.tags, o.closes_on, o.published_at,
         e.id, e.name, e.kind, e.logo_url
    from public.job_offers o
    join public.employers e on e.id = o.employer_id
   where o.status = 'published' and not o.staff_hidden and e.status = 'approved'
     and (o.closes_on is null or o.closes_on >= current_date)
     and (v_query is null or o.title ilike v_pattern or e.name ilike v_pattern
          or exists (select 1 from unnest(o.tags) t where t ilike v_pattern))
     and (p_kind is null or o.kind = p_kind)
     and (p_employment_type is null or o.employment_type = p_employment_type)
     and (p_remote is null or o.remote = p_remote)
     and (v_place is null or o.location ilike v_place_pattern)
     and (p_tag is null or lower(btrim(p_tag)) = any (o.tags))
     and (p_min_pay is null or (o.pay_unit = p_pay_unit and coalesce(o.pay_max_fcfa, o.pay_min_fcfa) >= p_min_pay))
   order by
     case when v_sort = 'pay' then coalesce(o.pay_max_fcfa, o.pay_min_fcfa) end desc nulls last,
     o.published_at desc, o.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.employers enable row level security;
alter table public.job_offers enable row level security;
revoke all on public.employers, public.job_offers from public, anon, authenticated;

grant select on public.employers, public.job_offers to anon, authenticated;
create policy "approved employers are public" on public.employers for select to anon, authenticated
  using (status = 'approved');
create policy "owners see their own employer profile" on public.employers for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "staff see every employer profile" on public.employers for select to authenticated
  using (public.staff_role() is not null);

create policy "offers on the board are public" on public.job_offers for select to anon, authenticated
  using (public.job_offer_is_listed(id));
create policy "owners see their own offers" on public.job_offers for select to authenticated
  using (posted_by = (select auth.uid()));
create policy "staff see every offer" on public.job_offers for select to authenticated
  using (public.staff_role() is not null);

revoke execute on function public.job_offer_is_listed(uuid) from public;
revoke execute on function public.employer_check_fields(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.job_offer_check_fields(text, text, text, text, text, text, bigint, bigint, text, date) from public, anon, authenticated;
grant execute on function public.job_offer_is_listed(uuid) to anon, authenticated, service_role;

revoke execute on function public.create_employer(text, text, text, text, text, text) from public, anon;
revoke execute on function public.update_employer(text, text, text, text, text) from public, anon;
revoke execute on function public.delete_employer() from public, anon;
revoke execute on function public.create_job_offer(text, text, text, text, text, text, bigint, bigint, text, boolean, text[], date, boolean) from public, anon;
revoke execute on function public.update_job_offer(uuid, text, text, text, text, text, text, bigint, bigint, text, boolean, text[], date) from public, anon;
revoke execute on function public.publish_job_offer(uuid) from public, anon;
revoke execute on function public.close_job_offer(uuid) from public, anon;
revoke execute on function public.unpublish_job_offer(uuid) from public, anon;
revoke execute on function public.delete_job_offer(uuid) from public, anon;
revoke execute on function public.list_review_queue() from public, anon;
revoke execute on function public.review_employer(uuid, boolean, text) from public, anon;
revoke execute on function public.review_job_offer(uuid, boolean, text) from public, anon;
revoke execute on function public.set_job_offer_hidden(uuid, boolean, text) from public, anon;
revoke execute on function public.search_job_offers(text, text, text, text, text, text, bigint, text, text, integer, integer) from public;

grant execute on function public.create_employer(text, text, text, text, text, text) to authenticated;
grant execute on function public.update_employer(text, text, text, text, text) to authenticated;
grant execute on function public.delete_employer() to authenticated;
grant execute on function public.create_job_offer(text, text, text, text, text, text, bigint, bigint, text, boolean, text[], date, boolean) to authenticated;
grant execute on function public.update_job_offer(uuid, text, text, text, text, text, text, bigint, bigint, text, boolean, text[], date) to authenticated;
grant execute on function public.publish_job_offer(uuid) to authenticated;
grant execute on function public.close_job_offer(uuid) to authenticated;
grant execute on function public.unpublish_job_offer(uuid) to authenticated;
grant execute on function public.delete_job_offer(uuid) to authenticated;
grant execute on function public.list_review_queue() to authenticated;
grant execute on function public.review_employer(uuid, boolean, text) to authenticated;
grant execute on function public.review_job_offer(uuid, boolean, text) to authenticated;
grant execute on function public.set_job_offer_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.search_job_offers(text, text, text, text, text, text, bigint, text, text, integer, integer) to anon, authenticated;

grant all on public.employers, public.job_offers to service_role;

commit;
