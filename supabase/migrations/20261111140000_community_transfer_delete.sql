-- jaajef.tech - Hand a community to another member, or delete it.
--
-- Why: an owner who wants to delete their account must first hand their community over or close it.
-- Until now neither was possible, and the owner could not even leave.
--
-- * transfer_community: the owner picks a member; that member becomes the owner, and the previous owner
--   becomes a moderator. The new owner must be below the limit of communities one person may own.
-- * delete_community: the owner deletes the community. To avoid a slip, the owner must type the community's
--   address name (its slug). Channels, messages, members, invites and join requests go with it.

create function public.transfer_community(p_community uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if public.member_role(p_community) is distinct from 'owner' then
    raise exception 'Only the owner can hand over the community';
  end if;
  if p_user is null or p_user = v_me then
    raise exception 'Choose another member';
  end if;
  if not exists (select 1 from public.community_members where community_id = p_community and user_id = p_user) then
    raise exception 'That person is not in this community';
  end if;
  if (select count(*) from public.communities where owner_id = p_user)
       >= public.chat_setting('chat_max_communities_per_member') then
    raise exception 'That member already owns the maximum number of communities';
  end if;

  update public.communities set owner_id = p_user where id = p_community;
  update public.community_members set role = 'owner' where community_id = p_community and user_id = p_user;
  update public.community_members set role = 'moderator' where community_id = p_community and user_id = v_me;
end $$;

create function public.delete_community(p_community uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if public.member_role(p_community) is distinct from 'owner' then
    raise exception 'Only the owner can delete the community';
  end if;
  select slug into v_slug from public.communities where id = p_community;
  if p_confirm_slug is distinct from v_slug then
    raise exception 'Type the community address name to confirm';
  end if;
  delete from public.communities where id = p_community;
end $$;

-- The old message said ownership could not be handed over.
create or replace function public.leave_community(p_community uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.member_role(p_community);
begin
  if v_role is null then raise exception 'You are not in this community'; end if;
  if v_role = 'owner' then
    raise exception 'The owner cannot leave: hand the community to another member, or delete it';
  end if;
  delete from public.community_members
   where community_id = p_community and user_id = auth.uid();
end $$;

revoke execute on function public.transfer_community(uuid, uuid) from public, anon;
revoke execute on function public.delete_community(uuid, text) from public, anon;
grant execute on function public.transfer_community(uuid, uuid) to authenticated;
grant execute on function public.delete_community(uuid, text) to authenticated;
