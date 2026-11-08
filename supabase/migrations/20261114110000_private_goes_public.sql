-- jaajef.tech - A private repository that becomes public on GitHub joins the community list
--
-- The GitHub checker looks, once a day, at each private project. When GitHub now shows the
-- repository to everyone, the project turns into a normal public project: it is confirmed by
-- the usual check, and the member gets the one-time reward (once per repository, as always).
-- Server only.

create function public.private_projects_to_check(p_limit integer default 50)
returns table (project_id uuid, github_owner text, github_repo text)
language sql
stable
security definer
set search_path = public
as $$
  select id, github_owner, github_repo
    from public.projects
   where repo_private
     and (github_synced_at is null or github_synced_at < now() - interval '1 day')
   order by github_synced_at nulls first
   limit least(greatest(p_limit, 1), 200)
$$;

-- p_now_public: GitHub shows the repository to everyone. p_owner_login: the owner GitHub reports (must match).
create function public.record_private_check(
  p_project uuid,
  p_now_public boolean,
  p_owner_login text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj public.projects;
begin
  select * into v_proj from public.projects where id = p_project and repo_private for update;
  if not found then return false; end if;

  if coalesce(p_now_public, false) and lower(coalesce(p_owner_login, '')) = lower(v_proj.github_owner) then
    -- Back to "not yet checked": the usual public check confirms it and pays the reward.
    update public.projects
       set repo_private = false, is_public = true, verified_at = null, github_synced_at = null
     where id = p_project;
    return true;
  end if;

  update public.projects set github_synced_at = now() where id = p_project;
  return false;
end $$;

revoke execute on function public.private_projects_to_check(integer) from public, anon, authenticated;
revoke execute on function public.record_private_check(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.private_projects_to_check(integer) to service_role;
grant execute on function public.record_private_check(uuid, boolean, text) to service_role;
