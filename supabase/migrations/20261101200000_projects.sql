-- =====================================================================
-- jaajef.tech  -  Migration 6: Projects imported from GitHub
--
-- What this does
--   * A member lists one of their own GitHub repositories on their profile:
--     a link, a title, a short summary and up to 8 tags.
--   * Ownership rule: the repository must sit under the member's own GitHub
--     name. That name comes only from a verified GitHub sign-in and nobody can
--     edit it. A member who signed up by email must connect GitHub first.
--   * Pending until checked: a new project is visible only to its owner. It
--     becomes public once the SERVER has confirmed on GitHub that the repo
--     really exists and belongs to that GitHub name.
--   * The details GitHub knows (description, language, stars) are written only
--     by the server, never by members.
--   * The first confirmation of a repository pays a one-time XP reward. The
--     reward is tied to the repository, so deleting and listing it again does
--     not pay twice.
--
-- The part that actually asks GitHub is a separate server program (next
-- piece). This migration gives it two functions: projects_to_sync() to know
-- what to check, and record_github_sync() to save the answer.
--
-- Known limits (first version)
--   * Only repositories under the member's own GitHub name, not organizations.
--   * If someone renames their GitHub account, their old projects stop
--     matching until the profile name is updated.
--
-- Requires migrations 1 to 5.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('project_max_per_member', '30', 'defined', 'Most projects one member can list'),
  ('project_publish_xp', '50', 'tbc', 'PLACEHOLDER: XP for the first confirmed listing of a repository. Amount TBC');

-- ---------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  github_owner text not null check (github_owner ~ '^[A-Za-z0-9-]{1,39}$'),
  github_repo text not null check (github_repo ~ '^[A-Za-z0-9._-]{1,100}$'),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  summary text check (summary is null or char_length(summary) <= 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  is_public boolean not null default true,
  -- filled in by the server after asking GitHub
  github_description text,
  language text,
  github_stars integer not null default 0 check (github_stars >= 0),
  github_synced_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A repository can be listed only once on the whole platform.
create unique index projects_one_per_repo
  on public.projects (lower(github_owner), lower(github_repo));

create index projects_owner on public.projects (owner_id);
create index projects_tags on public.projects using gin (tags);
create index projects_public_recent on public.projects (verified_at desc) where is_public and verified_at is not null;

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Tag helper: lowercase, 2 to 24 characters, at most 8, no duplicates
-- ---------------------------------------------------------------------
create function public.clean_tags(p_tags text[])
returns text[]
language plpgsql
immutable
as $$
declare
  v_tag text;
  v_out text[] := '{}';
begin
  foreach v_tag in array coalesce(p_tags, '{}') loop
    v_tag := lower(btrim(v_tag));
    if v_tag !~ '^[a-z0-9+#.-]{2,24}$' then
      raise exception 'Tags use letters, digits and + # . - only (2 to 24 characters)';
    end if;
    if not v_tag = any (v_out) then
      v_out := v_out || v_tag;
    end if;
  end loop;
  if cardinality(v_out) > 8 then raise exception 'At most 8 tags'; end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- Members: list, edit, remove
-- ---------------------------------------------------------------------
create function public.publish_project(
  p_repo_url text,
  p_title text,
  p_summary text default null,
  p_tags text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_github text;
  v_clean text;
  v_parts text[];
  v_id uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;

  select github_username into v_github from public.profiles where id = v_me;
  if v_github is null then
    raise exception 'Connect your GitHub account to list a project';
  end if;

  -- https://github.com/owner/repo, with an optional trailing slash or .git
  v_clean := regexp_replace(regexp_replace(btrim(coalesce(p_repo_url, '')), '/+$', ''), '\.git$', '');
  v_parts := regexp_match(v_clean, '^https://github\.com/([A-Za-z0-9-]{1,39})/([A-Za-z0-9._-]{1,100})$');
  if v_parts is null then
    raise exception 'Use a link like https://github.com/your-name/your-repo';
  end if;

  if lower(v_parts[1]) <> lower(v_github) then
    raise exception 'You can only list repositories under your own GitHub name';
  end if;

  if (select count(*) from public.projects where owner_id = v_me)
       >= public.chat_setting('project_max_per_member') then
    raise exception 'You have reached the limit of projects you can list';
  end if;

  begin
    insert into public.projects (owner_id, github_owner, github_repo, title, summary, tags)
    values (v_me, v_parts[1], v_parts[2], btrim(p_title), p_summary, public.clean_tags(p_tags))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This repository is already listed';
  end;

  return v_id;
end $$;

create function public.update_project(
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
  update public.projects
     set title = coalesce(btrim(p_title), title),
         summary = coalesce(p_summary, summary),
         tags = case when p_tags is null then tags else public.clean_tags(p_tags) end,
         is_public = coalesce(p_is_public, is_public)
   where id = p_project and owner_id = auth.uid();
  if not found then raise exception 'Project not found'; end if;
end $$;

create function public.delete_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.projects where id = p_project and owner_id = auth.uid();
  if not found then raise exception 'Project not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Server only: what to check on GitHub, and saving the answer
-- ---------------------------------------------------------------------
create function public.projects_to_sync(p_limit integer default 50)
returns table (project_id uuid, github_owner text, github_repo text)
language sql
stable
security definer
set search_path = public
as $$
  select id, github_owner, github_repo
    from public.projects
   where github_synced_at is null or github_synced_at < now() - interval '1 day'
   order by github_synced_at nulls first
   limit least(greatest(p_limit, 1), 200)
$$;

-- p_exists: did GitHub find the repository?
-- p_owner_login: the owner name GitHub reports for it (must match).
create function public.record_github_sync(
  p_project uuid,
  p_exists boolean,
  p_owner_login text default null,
  p_description text default null,
  p_language text default null,
  p_stars integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj public.projects;
  v_ok boolean;
  v_rewarded boolean := false;
begin
  select * into v_proj from public.projects where id = p_project for update;
  if not found then raise exception 'Project not found'; end if;

  v_ok := coalesce(p_exists, false) and lower(coalesce(p_owner_login, '')) = lower(v_proj.github_owner);

  if not v_ok then
    -- Missing, moved or someone else's: hide it (if it was public) and remember when we looked.
    update public.projects set verified_at = null, github_synced_at = now() where id = p_project;
    return jsonb_build_object('verified', false, 'rewarded', false);
  end if;

  update public.projects
     set github_description = left(p_description, 500),
         language = left(p_language, 40),
         github_stars = greatest(coalesce(p_stars, 0), 0),
         github_synced_at = now(),
         verified_at = coalesce(verified_at, now())
   where id = p_project;

  -- One reward per repository, ever (the key is the repository, not the listing).
  v_rewarded := public.grant_reward(
    v_proj.owner_id,
    public.chat_setting('project_publish_xp'),
    0,
    'project_published',
    'project:' || lower(v_proj.github_owner) || '/' || lower(v_proj.github_repo),
    'project',
    p_project::text
  );

  return jsonb_build_object('verified', true, 'rewarded', v_rewarded);
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.projects enable row level security;

revoke all on public.projects from public, anon, authenticated;
grant select on public.projects to anon, authenticated;

create policy "verified public projects are visible to everyone, pending ones only to their owner"
  on public.projects for select to anon, authenticated
  using ((is_public and verified_at is not null) or owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.publish_project(text, text, text, text[]) from public, anon;
revoke execute on function public.update_project(uuid, text, text, text[], boolean) from public, anon;
revoke execute on function public.delete_project(uuid) from public, anon;
grant execute on function public.publish_project(text, text, text, text[]) to authenticated;
grant execute on function public.update_project(uuid, text, text, text[], boolean) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;

revoke execute on function public.projects_to_sync(integer) from public, anon, authenticated;
revoke execute on function public.record_github_sync(uuid, boolean, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.projects_to_sync(integer) to service_role;
grant execute on function public.record_github_sync(uuid, boolean, text, text, text, integer) to service_role;

grant all on public.projects to service_role;

commit;
