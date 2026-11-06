-- jaajef.tech  -  Migration: Jobs, part 2 (the application file)
--
--   * Each member has one private application file: headline, about me, place,
--     years of experience, availability, the kind of work wanted, up to 20
--     skills, website and LinkedIn links.
--   * A portfolio of up to 10 items: a title, a short description and a link, or
--     a link to one of the member's own projects on the platform.
--   * A CV (one PDF, 5 MB at most) kept in the private bucket "cv-files". Only
--     the member can open or delete it for now; applying (next part) will let the
--     one company applied to open it.
--   * A completion percentage that adds up from 8 parts, with the list of what
--     is still missing.
--   * Only the member can read the file. Nobody else, not even staff.
--   * The member can delete everything at any time.
--
-- Completion weights (total 100): headline 10, about me 15, place 5, experience
-- 5, availability 5, three or more skills 20, one or more portfolio items 20, CV 20.
--
-- Limit: the function that stores the CV checks the file really is in the
-- bucket, but cannot read what is inside it. Files are PDFs of 5 MB at most
-- by bucket rule; whether a file is a real, readable PDF is not checked.
--
-- Requires: chat (chat_setting), projects, Supabase Storage.

begin;

insert into public.game_config (key, value, status, description) values
  ('portfolio_max_items', '10', 'defined', 'Most portfolio items one member can have in the application file'),
  ('cv_max_mb', '5', 'defined', 'Largest CV (PDF) a member can upload, in megabytes');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.application_files (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  headline text check (char_length(headline) <= 100),
  summary text check (char_length(summary) <= 1000),
  location text check (char_length(location) <= 100),
  experience_years smallint check (experience_years between 0 and 60),
  availability text check (availability in ('immediate', 'within_month', 'within_3_months', 'not_looking')),
  work_kinds text[] not null default '{}' check (work_kinds <@ array['job', 'freelance']),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  website text check (website ~ '^https://' and char_length(website) <= 300),
  linkedin_url text check (linkedin_url ~ '^https://' and char_length(linkedin_url) <= 300),
  cv_path text,
  cv_name text check (char_length(cv_name) <= 120),
  cv_size integer check (cv_size > 0),
  cv_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cv_path is null and cv_name is null and cv_size is null and cv_uploaded_at is null)
         or (cv_path is not null and cv_name is not null and cv_size is not null and cv_uploaded_at is not null))
);

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 100),
  description text check (char_length(description) <= 500),
  url text check (url ~ '^https://' and char_length(url) <= 300),
  -- If the project is deleted, the item that points to it goes with it.
  project_id uuid references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- a link or a project of the member, so an item always points somewhere
  check (url is not null or project_id is not null)
);
create index portfolio_items_user on public.portfolio_items (user_id, created_at);

-- ---------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------
create function public.application_clean_skills(p_skills text[])
returns text[]
language plpgsql
immutable
as $$
declare
  v_skill text;
  v_out text[] := '{}';
begin
  foreach v_skill in array coalesce(p_skills, '{}') loop
    v_skill := lower(btrim(v_skill));
    if v_skill is null or v_skill !~ '^[a-z0-9+#.-]{2,24}$' then
      raise exception 'Skills use letters, digits and + # . - only (2 to 24 characters)';
    end if;
    if not v_skill = any (v_out) then v_out := v_out || v_skill; end if;
  end loop;
  if cardinality(v_out) > 20 then raise exception 'At most 20 skills'; end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- The file
-- ---------------------------------------------------------------------
-- Replaces the written parts of the file (the form is sent whole).
create function public.save_application_file(
  p_headline text, p_summary text, p_location text, p_experience_years integer, p_availability text,
  p_work_kinds text[], p_skills text[], p_website text default null, p_linkedin_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_headline text := nullif(btrim(coalesce(p_headline, '')), '');
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_linkedin text := nullif(btrim(coalesce(p_linkedin_url, '')), '');
  v_kinds text[] := '{}';
  v_kind text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if char_length(coalesce(v_headline, '')) > 100 then raise exception 'The headline is too long (100 characters at most)'; end if;
  if char_length(coalesce(v_summary, '')) > 1000 then raise exception 'The text about you is too long (1000 characters at most)'; end if;
  if char_length(coalesce(v_location, '')) > 100 then raise exception 'The place is too long (100 characters at most)'; end if;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 60) then raise exception 'Years of experience must be between 0 and 60'; end if;
  if p_availability is not null and p_availability not in ('immediate', 'within_month', 'within_3_months', 'not_looking') then
    raise exception 'Choose immediate, within_month, within_3_months or not_looking';
  end if;
  foreach v_kind in array coalesce(p_work_kinds, '{}') loop
    if v_kind not in ('job', 'freelance') then raise exception 'The kind of work is job or freelance'; end if;
    if not v_kind = any (v_kinds) then v_kinds := v_kinds || v_kind; end if;
  end loop;
  if v_website is not null and (v_website !~ '^https://' or char_length(v_website) > 300) then raise exception 'The website must be a secure (https) address'; end if;
  if v_linkedin is not null and (v_linkedin !~ '^https://' or char_length(v_linkedin) > 300) then raise exception 'The LinkedIn link must be a secure (https) address'; end if;

  insert into public.application_files (user_id, headline, summary, location, experience_years, availability, work_kinds, skills, website, linkedin_url)
  values (v_me, v_headline, v_summary, v_location, p_experience_years, p_availability, v_kinds,
          public.application_clean_skills(p_skills), v_website, v_linkedin)
  on conflict (user_id) do update
    set headline = excluded.headline, summary = excluded.summary, location = excluded.location,
        experience_years = excluded.experience_years, availability = excluded.availability,
        work_kinds = excluded.work_kinds, skills = excluded.skills, website = excluded.website,
        linkedin_url = excluded.linkedin_url, updated_at = now();
end $$;

-- The caller's file with its completion percentage and what is missing.
-- Returns one row even before anything is saved.
create function public.my_application_file()
returns table (
  headline text, summary text, location text, experience_years integer, availability text,
  work_kinds text[], skills text[], website text, linkedin_url text,
  cv_name text, cv_size integer, cv_uploaded_at timestamptz,
  portfolio_count integer, completion integer, missing text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  f public.application_files;
  v_portfolio integer;
  v_score integer := 0;
  v_missing text[] := '{}';
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into f from public.application_files where user_id = v_me;
  select count(*)::integer into v_portfolio from public.portfolio_items where user_id = v_me;

  if f.headline is not null then v_score := v_score + 10; else v_missing := array_append(v_missing, 'headline'); end if;
  if f.summary is not null then v_score := v_score + 15; else v_missing := array_append(v_missing, 'summary'); end if;
  if f.location is not null then v_score := v_score + 5; else v_missing := array_append(v_missing, 'location'); end if;
  if f.experience_years is not null then v_score := v_score + 5; else v_missing := array_append(v_missing, 'experience_years'); end if;
  if f.availability is not null then v_score := v_score + 5; else v_missing := array_append(v_missing, 'availability'); end if;
  if coalesce(cardinality(f.skills), 0) >= 3 then v_score := v_score + 20; else v_missing := array_append(v_missing, 'skills'); end if;
  if v_portfolio >= 1 then v_score := v_score + 20; else v_missing := array_append(v_missing, 'portfolio'); end if;
  if f.cv_path is not null then v_score := v_score + 20; else v_missing := array_append(v_missing, 'cv'); end if;

  return query select f.headline, f.summary, f.location, f.experience_years::integer, f.availability,
                      coalesce(f.work_kinds, '{}'), coalesce(f.skills, '{}'), f.website, f.linkedin_url,
                      f.cv_name, f.cv_size, f.cv_uploaded_at, v_portfolio, v_score, v_missing;
end $$;

-- Erases the whole file: the written parts, the portfolio and the CV record.
-- Returns the CV's path so the app can delete the file from storage too.
create function public.delete_application_file()
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
  return v_path;
end $$;

-- ---------------------------------------------------------------------
-- Portfolio
-- ---------------------------------------------------------------------
create function public.portfolio_check(p_title text, p_description text, p_url text, p_project uuid, p_me uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_title is null or char_length(btrim(p_title)) < 2 then raise exception 'The title needs at least 2 characters'; end if;
  if char_length(btrim(p_title)) > 100 then raise exception 'The title is too long (100 characters at most)'; end if;
  if p_description is not null and char_length(btrim(p_description)) > 500 then raise exception 'The description is too long (500 characters at most)'; end if;
  if p_url is not null and btrim(p_url) <> '' and (btrim(p_url) !~ '^https://' or char_length(btrim(p_url)) > 300) then
    raise exception 'The link must be a secure (https) address';
  end if;
  if (p_url is null or btrim(p_url) = '') and p_project is null then raise exception 'Add a link or choose one of your projects'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and owner_id = p_me) then
    raise exception 'You can only add your own projects';
  end if;
end $$;

create function public.add_portfolio_item(p_title text, p_description text default null, p_url text default null, p_project uuid default null)
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
  perform public.portfolio_check(p_title, p_description, p_url, p_project, v_me);
  -- Lock the member so two quick additions cannot both slip under the limit.
  perform 1 from public.profiles where id = v_me for update;
  if (select count(*) from public.portfolio_items where user_id = v_me) >= public.chat_setting('portfolio_max_items') then
    raise exception 'Your portfolio is full: remove an item first';
  end if;
  insert into public.portfolio_items (user_id, title, description, url, project_id)
  values (v_me, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_url, '')), ''), p_project)
  returning id into v_id;
  return v_id;
end $$;

create function public.update_portfolio_item(p_item uuid, p_title text, p_description text default null, p_url text default null, p_project uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  perform public.portfolio_check(p_title, p_description, p_url, p_project, v_me);
  update public.portfolio_items
     set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''),
         url = nullif(btrim(coalesce(p_url, '')), ''), project_id = p_project
   where id = p_item and user_id = v_me;
  if not found then raise exception 'Portfolio item not found'; end if;
end $$;

create function public.delete_portfolio_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.portfolio_items where id = p_item and user_id = auth.uid();
  if not found then raise exception 'Portfolio item not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- The CV
-- ---------------------------------------------------------------------
-- Records an uploaded CV. The app uploads the PDF to the bucket first, into the
-- member's own folder, as <member id>/<new id>.pdf. Returns the path of the CV
-- this one replaces (or null), so the app can delete that old file.
create function public.set_cv(p_path text, p_name text, p_size integer)
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
  return case when v_old is distinct from p_path then v_old end;
end $$;

-- Removes the CV record. Returns the path so the app can delete the file.
create function public.remove_cv()
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
  return v_old;
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.application_files enable row level security;
alter table public.portfolio_items enable row level security;
revoke all on public.application_files, public.portfolio_items from public, anon, authenticated;

-- Private: only the member reads their own file.
grant select on public.application_files, public.portfolio_items to authenticated;
create policy "own application file" on public.application_files for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own portfolio" on public.portfolio_items for select to authenticated
  using (user_id = (select auth.uid()));

revoke execute on function public.application_clean_skills(text[]) from public, anon, authenticated;
revoke execute on function public.portfolio_check(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_application_file(text, text, text, integer, text, text[], text[], text, text) from public, anon;
revoke execute on function public.my_application_file() from public, anon;
revoke execute on function public.delete_application_file() from public, anon;
revoke execute on function public.add_portfolio_item(text, text, text, uuid) from public, anon;
revoke execute on function public.update_portfolio_item(uuid, text, text, text, uuid) from public, anon;
revoke execute on function public.delete_portfolio_item(uuid) from public, anon;
revoke execute on function public.set_cv(text, text, integer) from public, anon;
revoke execute on function public.remove_cv() from public, anon;

grant execute on function public.save_application_file(text, text, text, integer, text, text[], text[], text, text) to authenticated;
grant execute on function public.my_application_file() to authenticated;
grant execute on function public.delete_application_file() to authenticated;
grant execute on function public.add_portfolio_item(text, text, text, uuid) to authenticated;
grant execute on function public.update_portfolio_item(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.delete_portfolio_item(uuid) to authenticated;
grant execute on function public.set_cv(text, text, integer) to authenticated;
grant execute on function public.remove_cv() to authenticated;

grant all on public.application_files, public.portfolio_items to service_role;

-- ---------------------------------------------------------------------
-- CV storage: a private bucket and its rules.
--   * Upload: only into your own folder (a folder named after your member id).
--   * Open and delete: only your own files.
--   * No overwrite from the browser: each upload gets a new name.
-- Applying (a later part) adds one more rule: the company applied to can open
-- the CV of its applicants.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv-files', 'cv-files', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

create policy "members upload a CV into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cv-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members open their own CV files"
  on storage.objects for select to authenticated
  using (bucket_id = 'cv-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members delete their own CV files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cv-files' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
