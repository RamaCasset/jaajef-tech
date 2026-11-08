-- jaajef.tech - Collaborators accept an invitation
--
-- The owner invites a member by username. The member is told (notification) and accepts or
-- declines from "Mes dépôts". Only then does the member see the project. Replaces the direct add.
-- If the member had already asked to collaborate on that project, the invitation is not needed:
-- the member has said yes already, so they are added at once.

drop function public.add_collaborator(uuid, text);

create or replace function public.notification_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'project_starred', 'project_comment', 'project_confirmed', 'project_hidden',
    'collab_request', 'collab_accepted', 'collab_declined',
    'join_request', 'join_approved', 'join_declined',
    'badge_unlocked', 'warning', 'suspension',
    'new_application', 'application_seen', 'application_shortlisted', 'application_declined',
    'job_alert',
    'blog_comment', 'blog_like', 'blog_hidden', 'job_offer_hidden',
    'souk_submission_approved', 'souk_submission_rejected',
    'souk_sale',
    'souk_item_removed',
    'collab_invite', 'collab_invite_accepted', 'collab_invite_declined'
  ]
$$;

insert into public.game_config (key, value, status, description) values
  ('collab_max_invites_per_project', '20', 'defined', 'Most waiting collaboration invitations one project can have')
on conflict (key) do nothing;

create table public.collab_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index collab_invite_one_pending on public.collab_invites (project_id, invitee_id) where status = 'pending';
create index collab_invites_invitee on public.collab_invites (invitee_id, status);

alter table public.collab_invites enable row level security;
revoke all on public.collab_invites from public, anon, authenticated;
grant select on public.collab_invites to authenticated;
-- The owner sees the invitations of their projects. The invited member reads theirs through my_collab_invites().
create policy "owners see the invitations of their projects" on public.collab_invites
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

create function public.invite_collaborator(p_project uuid, p_username text)
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

create function public.cancel_collab_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.collab_invites i set status = 'cancelled', decided_at = now()
   where i.id = p_invite and i.status = 'pending'
     and exists (select 1 from public.projects p where p.id = i.project_id and p.owner_id = auth.uid());
  if not found then raise exception 'Invitation not found'; end if;
end $$;

-- The invitations waiting for me: only what is needed to decide (the project itself stays hidden until I accept).
create function public.my_collab_invites()
returns table (invite_id uuid, project_title text, owner_username text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, p.title, o.username, i.created_at
    from public.collab_invites i
    join public.projects p on p.id = i.project_id
    join public.profiles o on o.id = p.owner_id
   where i.invitee_id = auth.uid() and i.status = 'pending'
   order by i.created_at desc
$$;

create function public.answer_collab_invite(p_invite uuid, p_accept boolean)
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

revoke execute on function public.invite_collaborator(uuid, text) from public, anon;
revoke execute on function public.cancel_collab_invite(uuid) from public, anon;
revoke execute on function public.my_collab_invites() from public, anon;
revoke execute on function public.answer_collab_invite(uuid, boolean) from public, anon;
grant execute on function public.invite_collaborator(uuid, text) to authenticated;
grant execute on function public.cancel_collab_invite(uuid) to authenticated;
grant execute on function public.my_collab_invites() to authenticated;
grant execute on function public.answer_collab_invite(uuid, boolean) to authenticated;
