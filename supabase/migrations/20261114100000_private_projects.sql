-- jaajef.tech - Private projects
--
-- A member can list a repository that is private on GitHub. It stays private on the platform:
-- never in the community list, never confirmed by the public checker. The member proves the
-- repository is theirs by installing the GitHub app on it (checked by the repo-editor function),
-- which then calls adopt_private_project below. Only the server can call it.

alter table public.projects add column repo_private boolean not null default false;

-- A private repository can never be made public on the platform.
alter table public.projects add constraint projects_private_stays_hidden check (not repo_private or not is_public);

create function public.adopt_private_project(
  p_owner uuid,
  p_repo text,
  p_title text,
  p_summary text default null,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_github text;
  v_id uuid;
begin
  select github_username into v_github from public.profiles where id = p_owner;
  if v_github is null then raise exception 'Connect your GitHub account to list a project'; end if;
  if p_repo !~ '^[A-Za-z0-9._-]{1,100}$' then raise exception 'Invalid repository name'; end if;

  if (select count(*) from public.projects where owner_id = p_owner)
       >= public.chat_setting('project_max_per_member') then
    raise exception 'You have reached the limit of projects you can list';
  end if;

  begin
    insert into public.projects (owner_id, github_owner, github_repo, title, summary, language, is_public, repo_private, verified_at, github_synced_at)
    values (p_owner, v_github, p_repo, btrim(p_title), left(p_summary, 300), left(p_language, 40), false, true, now(), now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This repository is already listed';
  end;
  return v_id;
end $$;

revoke execute on function public.adopt_private_project(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.adopt_private_project(uuid, text, text, text, text) to service_role;

-- The public checker never looks at private repositories (it would report them as missing).
create or replace function public.projects_to_sync(p_limit integer default 50)
returns table (project_id uuid, github_owner text, github_repo text)
language sql
stable
security definer
set search_path = public
as $$
  select id, github_owner, github_repo
    from public.projects
   where not repo_private
     and (github_synced_at is null or github_synced_at < now() - interval '1 day')
   order by github_synced_at nulls first
   limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.update_project(
  p_project uuid,
  p_title text default null,
  p_summary text default null,
  p_tags text[] default null,
  p_is_public boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_is_public is true and exists (select 1 from public.projects where id = p_project and owner_id = auth.uid() and repo_private) then
    raise exception 'A private repository cannot be made public here. Make it public on GitHub first, then list it again.';
  end if;
  update public.projects
     set title = coalesce(btrim(p_title), title),
         summary = coalesce(p_summary, summary),
         tags = case when p_tags is null then tags else public.clean_tags(p_tags) end,
         is_public = coalesce(p_is_public, is_public)
   where id = p_project and owner_id = auth.uid();
  if not found then raise exception 'Project not found'; end if;
end $$;
