-- jaajef.tech - Collaboration invitations expire after 7 days
--
-- An invitation nobody answered stops working after the number of days in
-- collab_invite_expiry_days. The owner can then invite the person again.

insert into public.game_config (key, value, status, description) values
  ('collab_invite_expiry_days', '7', 'defined', 'Days after which an unanswered collaboration invitation expires')
on conflict (key) do nothing;

alter table public.collab_invites drop constraint collab_invites_status_check;
alter table public.collab_invites add constraint collab_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired'));

create or replace function public.invite_collaborator(p_project uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_title text;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select title into v_title from public.projects where id = p_project and owner_id = v_me for update;
  if not found then raise exception 'Project not found'; end if;
  -- Old invitations that nobody answered are closed, so the person can be invited again.
  update public.collab_invites set status = 'expired', decided_at = now()
   where project_id = p_project and status = 'pending'
     and created_at < now() - make_interval(days => public.chat_setting('collab_invite_expiry_days'));

  select id into v_target from public.profiles where lower(username) = lower(btrim(coalesce(p_username, '')));
  if v_target is null then raise exception 'No member with this username'; end if;
  if v_target = v_me then raise exception 'You are already the owner'; end if;
  if exists (select 1 from public.project_collaborators where project_id = p_project and user_id = v_target) then
    raise exception 'This person is already a collaborator';
  end if;
  if exists (select 1 from public.collab_invites where project_id = p_project and invitee_id = v_target and status = 'pending') then
    raise exception 'This person is already invited';
  end if;
  if (select count(*) from public.project_collaborators where project_id = p_project)
       >= public.chat_setting('project_max_collaborators') then
    raise exception 'This project already has the most collaborators allowed';
  end if;
  if (select count(*) from public.collab_invites where project_id = p_project and status = 'pending')
       >= public.chat_setting('collab_max_invites_per_project') then
    raise exception 'This project has too many invitations waiting';
  end if;

  -- The person already asked to join: that is their yes.
  if exists (select 1 from public.collab_requests where project_id = p_project and requester_id = v_target and status = 'pending') then
    insert into public.project_collaborators (project_id, user_id) values (p_project, v_target);
    update public.collab_requests set status = 'accepted', decided_at = now()
     where project_id = p_project and requester_id = v_target and status = 'pending';
    return null;
  end if;

  insert into public.collab_invites (project_id, invitee_id) values (p_project, v_target) returning id into v_id;
  perform public.notify(v_target, 'collab_invite',
    jsonb_build_object('invite_id', v_id, 'project_title', v_title, 'actor_id', v_me, 'actor_username', public.username_of(v_me)),
    'collab-invite:' || v_id);
  return v_id;
end $$;

create or replace function public.answer_collab_invite(p_invite uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_inv public.collab_invites;
  v_title text;
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into v_inv from public.collab_invites where id = p_invite and invitee_id = v_me for update;
  if not found or v_inv.status <> 'pending' then raise exception 'Invitation not found'; end if;
  if v_inv.created_at < now() - make_interval(days => public.chat_setting('collab_invite_expiry_days')) then
    update public.collab_invites set status = 'expired', decided_at = now() where id = p_invite;
    raise exception 'This invitation has expired';
  end if;
  select title, owner_id into v_title, v_owner from public.projects where id = v_inv.project_id;

  if p_accept then
    if (select count(*) from public.project_collaborators where project_id = v_inv.project_id)
         >= public.chat_setting('project_max_collaborators') then
      raise exception 'This project already has the most collaborators allowed';
    end if;
    insert into public.project_collaborators (project_id, user_id) values (v_inv.project_id, v_me)
      on conflict do nothing;
  end if;

  update public.collab_invites
     set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
   where id = p_invite;
  perform public.notify(v_owner, case when p_accept then 'collab_invite_accepted' else 'collab_invite_declined' end,
    jsonb_build_object('invite_id', p_invite, 'project_id', v_inv.project_id, 'project_title', v_title,
                       'actor_id', v_me, 'actor_username', public.username_of(v_me)),
    'collab-invite-answer:' || p_invite);
end $$;

drop function public.my_collab_invites();

create function public.my_collab_invites()
returns table (invite_id uuid, project_title text, owner_username text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, p.title, o.username, i.created_at,
         i.created_at + make_interval(days => public.chat_setting('collab_invite_expiry_days'))
    from public.collab_invites i
    join public.projects p on p.id = i.project_id
    join public.profiles o on o.id = p.owner_id
   where i.invitee_id = auth.uid() and i.status = 'pending'
     and i.created_at >= now() - make_interval(days => public.chat_setting('collab_invite_expiry_days'))
   order by i.created_at desc
$$;

-- The owner's waiting invitations (expired ones are not listed).
create function public.project_invites(p_project uuid)
returns table (invite_id uuid, invitee_username text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, u.username, i.created_at,
         i.created_at + make_interval(days => public.chat_setting('collab_invite_expiry_days'))
    from public.collab_invites i
    join public.profiles u on u.id = i.invitee_id
   where i.project_id = p_project and i.status = 'pending'
     and i.created_at >= now() - make_interval(days => public.chat_setting('collab_invite_expiry_days'))
     and exists (select 1 from public.projects p where p.id = p_project and p.owner_id = auth.uid())
   order by i.created_at
$$;

revoke execute on function public.project_invites(uuid) from public, anon;
grant execute on function public.project_invites(uuid) to authenticated;

revoke execute on function public.my_collab_invites() from public, anon;
grant execute on function public.my_collab_invites() to authenticated;
