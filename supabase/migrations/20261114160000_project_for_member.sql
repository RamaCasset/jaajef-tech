-- jaajef.tech - Who may read a project's code through the GitHub app
--
-- The repo-editor function (server only) asks this before it reads the code of a project for
-- someone who is not the GitHub account that owns it: only the owner and the collaborators.

create function public.project_for_member(p_user uuid, p_project uuid)
returns table (github_owner text, github_repo text, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.github_owner, p.github_repo, p.owner_id = p_user
    from public.projects p
   where p.id = p_project
     and (p.owner_id = p_user
          or exists (select 1 from public.project_collaborators c where c.project_id = p.id and c.user_id = p_user))
$$;

revoke execute on function public.project_for_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_for_member(uuid, uuid) to service_role;
