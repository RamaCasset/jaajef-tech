-- jaajef.tech - A chat room for each project
--
-- The owner of a project can open a room for it. The room is a private, unlisted community
-- (so it already has channels, messages, live updates and moderation) that is linked to the
-- project. Its members are the owner and the project's collaborators: adding a collaborator
-- adds them to the room, removing a collaborator takes them out.
-- Public talk about a project stays in the project comments.

alter table public.communities
  add column project_id uuid unique references public.projects (id) on delete cascade;

-- Opens the room of a project (the owner only). Opening it twice just returns the same room.
create function public.open_project_room(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_project public.projects;
  v_id uuid;
  v_name text;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  select * into v_project from public.projects where id = p_project;
  if not found or v_project.owner_id <> v_user then raise exception 'Only the owner of a project can open its room'; end if;

  select id into v_id from public.communities where project_id = p_project;
  if v_id is not null then return v_id; end if;

  v_name := left(btrim(v_project.title), 60);
  if char_length(v_name) < 2 then v_name := 'Projet'; end if;

  insert into public.communities (slug, name, description, is_private, is_listed, owner_id, project_id)
  values ('projet-' || left(replace(p_project::text, '-', ''), 12), v_name, null, true, false, v_user, p_project)
  returning id into v_id;

  insert into public.community_members (community_id, user_id, role) values (v_id, v_user, 'owner');
  insert into public.channels (community_id, slug, name, kind) values
    (v_id, 'general', 'general', 'chat'),
    (v_id, 'annonces', 'annonces', 'announcement');

  insert into public.community_members (community_id, user_id, role)
  select v_id, c.user_id, 'member' from public.project_collaborators c where c.project_id = p_project
  on conflict do nothing;

  return v_id;
end $$;

revoke execute on function public.open_project_room(uuid) from public, anon;
grant execute on function public.open_project_room(uuid) to authenticated;

-- Collaborators come and go: the room follows.
create function public.project_room_follow_collaborators()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid;
begin
  if tg_op = 'INSERT' then
    select id into v_room from public.communities where project_id = new.project_id;
    if v_room is not null then
      insert into public.community_members (community_id, user_id, role) values (v_room, new.user_id, 'member') on conflict do nothing;
    end if;
    return new;
  end if;
  select id into v_room from public.communities where project_id = old.project_id;
  if v_room is not null then
    -- Only a plain member goes out: never the owner of the room.
    delete from public.community_members where community_id = v_room and user_id = old.user_id and role <> 'owner';
  end if;
  return old;
end $$;

revoke execute on function public.project_room_follow_collaborators() from public, anon, authenticated;

create trigger project_room_follow_collaborators
after insert or delete on public.project_collaborators
for each row execute function public.project_room_follow_collaborators();
