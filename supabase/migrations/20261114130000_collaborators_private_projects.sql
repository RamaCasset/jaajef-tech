-- jaajef.tech - Collaborators on private projects
--
-- * The owner adds a collaborator by username (no acceptance step: the person can leave at any time).
-- * A collaborator sees the project and its collaborator list, even when it is private.
--   Nobody else does: a private project stays hidden from everyone else.

create function public.is_project_collaborator(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.project_collaborators where project_id = p_project and user_id = auth.uid())
$$;

create function public.is_project_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.projects where id = p_project and owner_id = auth.uid())
      or exists (select 1 from public.project_collaborators where project_id = p_project and user_id = auth.uid())
$$;

revoke execute on function public.is_project_collaborator(uuid) from public, anon;
revoke execute on function public.is_project_member(uuid) from public, anon;
grant execute on function public.is_project_collaborator(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;

-- Members only (signed in): extra rules next to the existing public ones.
create policy "collaborators see the project they work on" on public.projects
  for select to authenticated
  using (public.is_project_collaborator(id));

create policy "members see the collaborators of their project" on public.project_collaborators
  for select to authenticated
  using (public.is_project_member(project_id));

create function public.add_collaborator(p_project uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  perform 1 from public.projects where id = p_project and owner_id = v_me for update;
  if not found then raise exception 'Project not found'; end if;

  select id into v_target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_target is null then raise exception 'No member with this username'; end if;
  if v_target = v_me then raise exception 'You are already the owner'; end if;
  if exists (select 1 from public.project_collaborators where project_id = p_project and user_id = v_target) then
    raise exception 'This person is already a collaborator';
  end if;
  if (select count(*) from public.project_collaborators where project_id = p_project)
       >= public.chat_setting('project_max_collaborators') then
    raise exception 'This project already has the most collaborators allowed';
  end if;

  insert into public.project_collaborators (project_id, user_id) values (p_project, v_target);
  -- A waiting request from this person is now answered.
  update public.collab_requests set status = 'accepted', decided_at = now()
   where project_id = p_project and requester_id = v_target and status = 'pending';
  return v_target;
end $$;

revoke execute on function public.add_collaborator(uuid, text) from public, anon;
grant execute on function public.add_collaborator(uuid, text) to authenticated;
