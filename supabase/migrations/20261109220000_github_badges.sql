-- jaajef.tech  -  Migration: "Build passing" and "Good first issues"
--
--   * Each listed project can show a build status (passing, failing, running or none), read by the
--     GitHub checker from the project's GitHub Actions on its main branch.
--   * Each listed project keeps up to 10 of its open GitHub issues labelled "good first issue".
--     They are shown on the project and in a public list that can be filtered by language and by
--     the owner's clan. A project owner can switch their project out of that list.
--   * The checker (service role only) writes both. Nothing here is typed by members, and the
--     database re-checks every issue link: it must point at an issue of that same repository.
--   * If GitHub cannot be reached, the last known values stay (nothing disappears on an error).
--   * Refreshed about every 6 hours per project.
--
-- Only the standard GitHub label "good first issue" is read. Other label names are not.
-- The build status comes from GitHub Actions only (other build services are not read).
--
-- Requires: projects, project social (project_is_listed), project discovery.

begin;

alter table public.projects
  add column build_status text check (build_status in ('passing', 'failing', 'running', 'none')),
  add column build_checked_at timestamptz,
  add column extras_synced_at timestamptz,
  add column newcomer_friendly boolean not null default true;

create table public.project_issues (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_number integer not null check (issue_number > 0),
  title text not null check (char_length(title) between 1 and 200),
  url text not null check (char_length(url) <= 300),
  comments integer not null default 0 check (comments >= 0),
  created_on timestamptz not null,
  unique (project_id, issue_number)
);
create index project_issues_recent on public.project_issues (created_on desc, id);

-- ---------------------------------------------------------------------
-- For the checker (service role only)
-- ---------------------------------------------------------------------
create function public.projects_for_extras(p_limit integer default 30)
returns table (project_id uuid, github_owner text, github_repo text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.github_owner, p.github_repo
    from public.projects p
   where public.project_is_listed(p.id)
     and (p.extras_synced_at is null or p.extras_synced_at < now() - interval '6 hours')
   order by p.extras_synced_at nulls first, p.id
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- p_build_status null = leave the build status as it is. p_issues null = leave the issues as they are.
-- Always marks the project as looked at, so one stubborn project cannot block the others.
create function public.record_github_extras(p_project uuid, p_build_status text default null, p_issues jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj public.projects;
  v_item jsonb;
  v_number integer;
  v_title text;
  v_comments integer;
  v_created timestamptz;
  v_kept integer := 0;
  v_seen integer[] := '{}';
begin
  select * into v_proj from public.projects where id = p_project for update;
  if not found or not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;
  if p_build_status is not null and p_build_status not in ('passing', 'failing', 'running', 'none') then
    raise exception 'Unknown build status';
  end if;
  -- A JSON null arriving from the web interface means "no answer", like an empty value.
  if p_issues is not null and jsonb_typeof(p_issues) = 'null' then p_issues := null; end if;
  if p_issues is not null and jsonb_typeof(p_issues) <> 'array' then raise exception 'The issues must be a list'; end if;

  if p_issues is not null then
    delete from public.project_issues where project_id = p_project;
    for v_item in select * from jsonb_array_elements(p_issues) loop
      exit when v_kept >= 10;
      begin
        if jsonb_typeof(v_item) <> 'object' then continue; end if;
        v_number := (v_item ->> 'number')::integer;
        v_title := left(btrim(coalesce(v_item ->> 'title', '')), 200);
        v_comments := greatest(coalesce((v_item ->> 'comments')::integer, 0), 0);
        v_created := (v_item ->> 'created_at')::timestamptz;
        if v_number is null or v_number <= 0 or v_title = '' or v_created is null then continue; end if;
        if v_number = any (v_seen) then continue; end if;
        -- The link must be an issue of this very repository.
        if lower(coalesce(v_item ->> 'url', '')) <>
           lower('https://github.com/' || v_proj.github_owner || '/' || v_proj.github_repo || '/issues/' || v_number) then
          continue;
        end if;
        insert into public.project_issues (project_id, issue_number, title, url, comments, created_on)
        values (p_project, v_number, v_title,
                'https://github.com/' || v_proj.github_owner || '/' || v_proj.github_repo || '/issues/' || v_number,
                v_comments, v_created);
        v_seen := array_append(v_seen, v_number);
        v_kept := v_kept + 1;
      exception when others then
        continue; -- a malformed item is skipped, the rest is kept
      end;
    end loop;
  end if;

  update public.projects
     set extras_synced_at = now(),
         build_status = coalesce(p_build_status, build_status),
         build_checked_at = case when p_build_status is not null then now() else build_checked_at end
   where id = p_project;

  return jsonb_build_object('issues', case when p_issues is null then null else v_kept end,
                            'build_status', coalesce(p_build_status, v_proj.build_status));
end $$;

-- ---------------------------------------------------------------------
-- Everyone: the issues
-- ---------------------------------------------------------------------
create function public.list_good_first_issues(
  p_language text default null, p_clan public.clan_type default null,
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  issue_id bigint, project_id uuid, github_owner text, github_repo text, project_title text, language text,
  issue_number integer, title text, url text, comments integer, created_on timestamptz,
  owner_username text, owner_clan public.clan_type
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_language text := nullif(lower(btrim(coalesce(p_language, ''))), '');
begin
  return query
  select i.id, p.id, p.github_owner, p.github_repo, p.title, p.language,
         i.issue_number, i.title, i.url, i.comments, i.created_on,
         o.username, o.clan
    from public.project_issues i
    join public.projects p on p.id = i.project_id
    join public.profiles o on o.id = p.owner_id
   where public.project_is_listed(p.id) and p.newcomer_friendly
     and (v_language is null or lower(p.language) = v_language)
     and (p_clan is null or o.clan = p_clan)
   order by i.created_on desc, i.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.project_good_first_issues(p_project uuid)
returns table (issue_number integer, title text, url text, comments integer, created_on timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.issue_number, i.title, i.url, i.comments, i.created_on
    from public.project_issues i
    join public.projects p on p.id = i.project_id
   where i.project_id = p_project and public.project_is_listed(p.id) and p.newcomer_friendly
   order by i.created_on desc, i.id
$$;

-- ---------------------------------------------------------------------
-- Owners: opt a project in or out of the newcomer list
-- ---------------------------------------------------------------------
create function public.set_project_newcomer_friendly(p_project uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_on is null then raise exception 'Say whether the project welcomes newcomers'; end if;
  update public.projects set newcomer_friendly = p_on where id = p_project and owner_id = v_me;
  if not found then raise exception 'Project not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.project_issues enable row level security;
revoke all on public.project_issues from public, anon, authenticated;

revoke execute on function public.projects_for_extras(integer) from public, anon, authenticated;
revoke execute on function public.record_github_extras(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.list_good_first_issues(text, public.clan_type, integer, integer) from public;
revoke execute on function public.project_good_first_issues(uuid) from public;
revoke execute on function public.set_project_newcomer_friendly(uuid, boolean) from public, anon;
grant execute on function public.projects_for_extras(integer) to service_role;
grant execute on function public.record_github_extras(uuid, text, jsonb) to service_role;
grant execute on function public.list_good_first_issues(text, public.clan_type, integer, integer) to anon, authenticated;
grant execute on function public.project_good_first_issues(uuid) to anon, authenticated;
grant execute on function public.set_project_newcomer_friendly(uuid, boolean) to authenticated;

grant all on public.project_issues to service_role;

commit;
