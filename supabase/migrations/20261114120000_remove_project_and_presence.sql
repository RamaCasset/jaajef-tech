-- jaajef.tech - Remove a project from the platform, and notice a private repository that is gone
--
-- remove_project: the owner removes a project from the platform (its stars, comments and
-- collaborators go with it). The GitHub repository is never touched. Returns the cover file
-- to delete from storage. The one-time reward is not taken back, and listing the same
-- repository again pays nothing more (the reward is per repository).
--
-- repo_missing_at: set when the GitHub app can no longer see a private repository (deleted, or
-- no longer allowed). Cleared as soon as it is visible again. Server only.

alter table public.projects add column repo_missing_at timestamptz;

create function public.remove_project(p_project uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cover text;
begin
  delete from public.projects where id = p_project and owner_id = auth.uid()
  returning cover_path into v_cover;
  if not found then raise exception 'Project not found'; end if;
  return v_cover;
end $$;

revoke execute on function public.remove_project(uuid) from public, anon;
grant execute on function public.remove_project(uuid) to authenticated;

-- p_present: names of the repositories the app can see for this member right now.
create function public.sync_private_presence(p_owner uuid, p_present text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.projects
     set repo_missing_at = case
           when lower(github_repo) = any (select lower(x) from unnest(coalesce(p_present, '{}'::text[])) x) then null
           else coalesce(repo_missing_at, now())
         end
   where owner_id = p_owner and repo_private;
$$;

revoke execute on function public.sync_private_presence(uuid, text[]) from public, anon, authenticated;
grant execute on function public.sync_private_presence(uuid, text[]) to service_role;
