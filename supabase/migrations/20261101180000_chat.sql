-- =====================================================================
-- jaajef.tech  -  Migration 4: Chat (communities, channels, messages)
--
-- What this does
--   * Communities (public or private), their members and roles
--     (owner, moderator, member), and invite links for private ones.
--   * Channels inside a community: chat, announcement (only owner and
--     moderators can post), forum (threads with replies).
--   * Messages, with replies, editing and deleting.
--   * Live updates: the messages table is added to Supabase Realtime.
--   * All writing goes through functions that check who you are and what
--     you are allowed to do. Members cannot write to the tables directly.
--
-- Privacy rule: you can read a community's channels, members and messages
-- only if you are a member of it. Public communities can be found by anyone
-- (name and description only) and joined in one click.
--
-- Spam protection: a member can send a limited number of messages per minute.
-- The limits live in game_config so they can be changed without code.
--
-- Requires migrations 1 to 3.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Limits (guesses, easy to change later)
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('chat_messages_per_minute', '20', 'defined', 'Most messages one member can send per minute'),
  ('chat_max_communities_per_member', '3', 'defined', 'Most communities one member can create'),
  ('chat_max_channels_per_community', '30', 'defined', 'Most channels in one community'),
  ('chat_invite_default_days', '7', 'defined', 'How long a new invite link lasts'),
  ('chat_invite_default_uses', '20', 'defined', 'How many people one invite link can bring in');

create function public.chat_setting(p_key text)
returns integer
language sql
stable
set search_path = public
as $$
  select (value #>> '{}')::integer from public.game_config where key = p_key
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (description is null or char_length(description) <= 500),
  avatar_url text,
  is_private boolean not null default false,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index community_members_user on public.community_members (user_id);

create table public.community_invites (
  code text primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'chat' check (kind in ('chat', 'announcement', 'forum')),
  created_at timestamptz not null default now(),
  unique (community_id, slug)
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id bigint references public.messages (id) on delete cascade,
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 4000)
);

create index messages_channel on public.messages (channel_id, id desc);
create index messages_parent on public.messages (parent_id);
create index messages_author_recent on public.messages (author_id, created_at desc);

-- ---------------------------------------------------------------------
-- Who is in a community? (used by the privacy rules below)
-- These are security definer so the rules do not loop on themselves.
-- ---------------------------------------------------------------------
create function public.member_role(p_community uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.community_members
   where community_id = p_community and user_id = auth.uid()
$$;

create function public.is_member(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.community_members
     where community_id = p_community and user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------
-- Communities
-- ---------------------------------------------------------------------
create function public.create_community(
  p_slug text,
  p_name text,
  p_description text default null,
  p_is_private boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  if (select count(*) from public.communities where owner_id = v_user)
       >= public.chat_setting('chat_max_communities_per_member') then
    raise exception 'You have reached the limit of communities you can create';
  end if;

  insert into public.communities (slug, name, description, is_private, owner_id)
  values (p_slug, btrim(p_name), p_description, coalesce(p_is_private, false), v_user)
  returning id into v_id;

  insert into public.community_members (community_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.channels (community_id, slug, name, kind) values
    (v_id, 'general', 'general', 'chat'),
    (v_id, 'annonces', 'annonces', 'announcement');

  return v_id;
end $$;

create function public.join_community(p_community uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_private boolean;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  select is_private into v_private from public.communities where id = p_community;
  if not found then raise exception 'Community not found'; end if;
  if v_private then raise exception 'This community is private: you need an invite link'; end if;

  insert into public.community_members (community_id, user_id, role)
  values (p_community, v_user, 'member')
  on conflict do nothing;
end $$;

create function public.create_invite(
  p_community uuid,
  p_days integer default null,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.member_role(p_community);
  v_code text := replace(gen_random_uuid()::text, '-', '');
  v_days integer := coalesce(p_days, public.chat_setting('chat_invite_default_days'));
  v_uses integer := coalesce(p_max_uses, public.chat_setting('chat_invite_default_uses'));
begin
  if v_role is null or v_role not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can create invites';
  end if;
  if v_days < 1 or v_days > 30 then raise exception 'An invite lasts between 1 and 30 days'; end if;

  insert into public.community_invites (code, community_id, created_by, expires_at, max_uses)
  values (v_code, p_community, auth.uid(), now() + make_interval(days => v_days), v_uses);

  return v_code;
end $$;

create function public.join_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.community_invites;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  select * into v_inv from public.community_invites where code = p_code for update;
  if not found then raise exception 'This invite does not exist'; end if;

  -- Already inside: nothing to do, and the invite is not used up.
  if exists (select 1 from public.community_members
              where community_id = v_inv.community_id and user_id = v_user) then
    return v_inv.community_id;
  end if;

  if v_inv.expires_at <= now() then raise exception 'This invite has expired'; end if;
  if v_inv.uses >= v_inv.max_uses then raise exception 'This invite has been used too many times'; end if;

  insert into public.community_members (community_id, user_id, role)
  values (v_inv.community_id, v_user, 'member');

  update public.community_invites set uses = uses + 1 where code = p_code;
  return v_inv.community_id;
end $$;

create function public.leave_community(p_community uuid)
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
    raise exception 'The owner cannot leave: ownership cannot be transferred yet';
  end if;
  delete from public.community_members
   where community_id = p_community and user_id = auth.uid();
end $$;

create function public.set_member_role(p_community uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.member_role(p_community) is distinct from 'owner' then
    raise exception 'Only the owner can change roles';
  end if;
  if p_role not in ('moderator', 'member') then
    raise exception 'A role can only be moderator or member';
  end if;
  if p_user = auth.uid() then raise exception 'The owner role cannot be changed'; end if;

  update public.community_members set role = p_role
   where community_id = p_community and user_id = p_user;
  if not found then raise exception 'That person is not in this community'; end if;
end $$;

create function public.remove_member(p_community uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.member_role(p_community);
  v_them text;
begin
  if v_me is null or v_me not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can remove people';
  end if;
  if p_user = auth.uid() then raise exception 'Use leave to leave a community'; end if;

  select role into v_them from public.community_members
   where community_id = p_community and user_id = p_user;
  if v_them is null then raise exception 'That person is not in this community'; end if;
  if v_them = 'owner' then raise exception 'The owner cannot be removed'; end if;
  if v_me = 'moderator' and v_them = 'moderator' then
    raise exception 'A moderator cannot remove another moderator';
  end if;

  delete from public.community_members where community_id = p_community and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------
create function public.create_channel(p_community uuid, p_slug text, p_name text, p_kind text default 'chat')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.member_role(p_community);
  v_id uuid;
begin
  if v_role is null or v_role not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can create channels';
  end if;
  if (select count(*) from public.channels where community_id = p_community)
       >= public.chat_setting('chat_max_channels_per_community') then
    raise exception 'This community has reached its channel limit';
  end if;

  insert into public.channels (community_id, slug, name, kind)
  values (p_community, p_slug, btrim(p_name), p_kind)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Messages
--   chat channel:         anyone in the community; p_parent is an optional reply
--   announcement channel: owner and moderators only
--   forum channel:        a new thread needs a title and no parent;
--                         a reply needs the thread it answers and no title
-- ---------------------------------------------------------------------
create function public.send_message(
  p_channel uuid,
  p_body text,
  p_parent bigint default null,
  p_title text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ch public.channels;
  v_role text;
  v_parent public.messages;
  v_id bigint;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  select * into v_ch from public.channels where id = p_channel;
  if not found then raise exception 'Channel not found'; end if;

  v_role := public.member_role(v_ch.community_id);
  if v_role is null then raise exception 'You are not in this community'; end if;

  if v_ch.kind = 'announcement' and v_role not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can post in an announcement channel';
  end if;

  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'The message is empty'; end if;
  if char_length(p_body) > 4000 then raise exception 'The message is too long (4000 characters at most)'; end if;

  if (select count(*) from public.messages
       where author_id = v_user and created_at > now() - interval '1 minute')
       >= public.chat_setting('chat_messages_per_minute') then
    raise exception 'Slow down: too many messages in the last minute';
  end if;

  if p_parent is not null then
    select * into v_parent from public.messages where id = p_parent;
    if not found or v_parent.channel_id <> p_channel or v_parent.deleted_at is not null then
      raise exception 'The message you answer is not in this channel';
    end if;
  end if;

  if v_ch.kind = 'forum' then
    if p_parent is null then
      if p_title is null or char_length(btrim(p_title)) = 0 then
        raise exception 'A new forum thread needs a title';
      end if;
    else
      if v_parent.parent_id is not null then raise exception 'Reply to the thread itself, not to another reply'; end if;
      if p_title is not null then raise exception 'Only a new thread has a title'; end if;
    end if;
  elsif p_title is not null then
    raise exception 'Only forum threads have a title';
  end if;

  insert into public.messages (channel_id, community_id, author_id, parent_id, title, body)
  values (p_channel, v_ch.community_id, v_user, p_parent, btrim(p_title), p_body)
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_message(p_message bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or v_msg.deleted_at is not null then raise exception 'Message not found'; end if;
  if v_msg.author_id <> auth.uid() then raise exception 'You can only edit your own messages'; end if;
  if not public.is_member(v_msg.community_id) then raise exception 'You are not in this community'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'The message is empty'; end if;
  if char_length(p_body) > 4000 then raise exception 'The message is too long (4000 characters at most)'; end if;

  update public.messages set body = p_body, edited_at = now() where id = p_message;
end $$;

create function public.delete_message(p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
  v_role text;
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or v_msg.deleted_at is not null then raise exception 'Message not found'; end if;

  v_role := public.member_role(v_msg.community_id);
  if v_role is null then raise exception 'You are not in this community'; end if;
  if v_msg.author_id <> auth.uid() and v_role not in ('owner', 'moderator') then
    raise exception 'You can only delete your own messages';
  end if;

  -- The row stays (so threads keep their shape) but the text is wiped.
  update public.messages set body = '', title = null, deleted_at = now() where id = p_message;
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_invites enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

revoke all on public.communities, public.community_members, public.community_invites,
  public.channels, public.messages from public, anon, authenticated;

grant select on public.communities to anon, authenticated;
grant select on public.community_members, public.channels, public.messages to authenticated;

create policy "public communities are visible to everyone, private ones to their members"
  on public.communities for select to anon, authenticated
  using (not is_private or public.is_member(id));

create policy "members see who is in their community"
  on public.community_members for select to authenticated
  using (public.is_member(community_id));

create policy "members see the channels of their community"
  on public.channels for select to authenticated
  using (public.is_member(community_id));

create policy "members read the messages of their community"
  on public.messages for select to authenticated
  using (public.is_member(community_id));

-- community_invites: no policy and no grant, so nobody reads it directly.

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.create_community(text, text, text, boolean) from public, anon;
revoke execute on function public.join_community(uuid) from public, anon;
revoke execute on function public.create_invite(uuid, integer, integer) from public, anon;
revoke execute on function public.join_with_invite(text) from public, anon;
revoke execute on function public.leave_community(uuid) from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.create_channel(uuid, text, text, text) from public, anon;
revoke execute on function public.send_message(uuid, text, bigint, text) from public, anon;
revoke execute on function public.edit_message(bigint, text) from public, anon;
revoke execute on function public.delete_message(bigint) from public, anon;

grant execute on function public.create_community(text, text, text, boolean) to authenticated;
grant execute on function public.join_community(uuid) to authenticated;
grant execute on function public.create_invite(uuid, integer, integer) to authenticated;
grant execute on function public.join_with_invite(text) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.create_channel(uuid, text, text, text) to authenticated;
grant execute on function public.send_message(uuid, text, bigint, text) to authenticated;
grant execute on function public.edit_message(bigint, text) to authenticated;
grant execute on function public.delete_message(bigint) to authenticated;

grant execute on function public.member_role(uuid) to anon, authenticated;
grant execute on function public.is_member(uuid) to anon, authenticated;
grant execute on function public.chat_setting(text) to anon, authenticated;

grant all on public.communities, public.community_members, public.community_invites,
  public.channels, public.messages to service_role;

-- ---------------------------------------------------------------------
-- Live updates (Supabase Realtime). Skipped where there is no Realtime.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

commit;
