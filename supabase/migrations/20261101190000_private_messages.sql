-- =====================================================================
-- jaajef.tech  -  Migration 5: Private messages and files
--
-- What this does
--   * One private conversation per pair of members. Only those two can
--     read it.
--   * Direct messages with editing, deleting, unread tracking and live updates.
--   * Blocking: a blocked person cannot start or continue a conversation.
--   * One file per message (images, PDF, text, zip, up to 10 MB), kept in
--     Supabase Storage in the private bucket "dm-files". Only the two people
--     in the conversation can open a file once it is attached to a message.
--   * Spam limits (messages per minute, new conversations per day).
--
-- How a file travels
--   1. The browser uploads the file to dm-files, inside a folder named after
--      the member's own id (Storage refuses any other folder).
--   2. The browser calls send_direct_message with the file's path. The server
--      checks the path, the file really exists, its type and its size.
--   3. From then on the other person can open it.
--
-- Known limit: deleting a message removes access to its file but the file
-- itself stays in Storage until a clean-up job exists (later).
--
-- Requires migrations 1 to 4.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Settings (guesses, easy to change later)
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('dm_new_conversations_per_day', '20', 'defined', 'Most new private conversations one member can start per day'),
  ('dm_max_file_mb', '10', 'defined', 'Largest file one message can carry, in megabytes');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  a_read_at timestamptz,
  b_read_at timestamptz,
  -- the smaller id is always user_a, so a pair exists only once
  check (user_a < user_b),
  unique (user_a, user_b)
);

create index conversations_user_b on public.conversations (user_b);

create table public.direct_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  file_path text unique,
  file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  file_mime text,
  file_size bigint check (file_size is null or file_size > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (char_length(body) <= 4000),
  check (deleted_at is not null or char_length(btrim(body)) > 0 or file_path is not null),
  check ((file_path is null) = (file_name is null))
);

create index direct_messages_conversation on public.direct_messages (conversation_id, id desc);
create index direct_messages_sender_recent on public.direct_messages (sender_id, created_at desc);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- Helpers (security definer so the privacy rules do not loop on themselves)
-- ---------------------------------------------------------------------
create function public.in_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations
     where id = p_conversation and auth.uid() in (user_a, user_b)
  )
$$;

create function public.is_blocked_between(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_one and blocked_id = p_two)
        or (blocker_id = p_two and blocked_id = p_one)
  )
$$;

-- Can the signed-in member open this file in Storage?
-- Yes if it is in their own folder, or attached to a live message of one of
-- their conversations.
create function public.can_read_dm_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select split_part(p_path, '/', 1) = auth.uid()::text
      or exists (
        select 1
          from public.direct_messages m
          join public.conversations c on c.id = m.conversation_id
         where m.file_path = p_path
           and m.deleted_at is null
           and auth.uid() in (c.user_a, c.user_b)
      )
$$;

-- ---------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------
create function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_user)
  on conflict do nothing;
end $$;

create function public.unblock_user(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

-- ---------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------
create function public.start_conversation(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if p_user = v_me then raise exception 'You cannot message yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found';
  end if;
  if public.is_blocked_between(v_me, p_user) then
    raise exception 'You cannot message this person';
  end if;

  v_a := least(v_me, p_user);
  v_b := greatest(v_me, p_user);

  select id into v_id from public.conversations where user_a = v_a and user_b = v_b;
  if v_id is not null then return v_id; end if;

  -- Only brand-new conversations count towards the daily limit.
  if (select count(*) from public.conversations_started
       where starter_id = v_me and started_at > now() - interval '1 day')
       >= public.chat_setting('dm_new_conversations_per_day') then
    raise exception 'Slow down: too many new conversations today';
  end if;

  insert into public.conversations (user_a, user_b) values (v_a, v_b) returning id into v_id;
  insert into public.conversations_started (starter_id, conversation_id) values (v_me, v_id);
  return v_id;
end $$;

-- Who started which conversation (for the daily limit). Never readable by members.
create table public.conversations_started (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  starter_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now()
);

create index conversations_started_recent on public.conversations_started (starter_id, started_at desc);

-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------
create function public.send_direct_message(
  p_conversation uuid,
  p_body text default '',
  p_file_path text default null,
  p_file_name text default null,
  p_file_mime text default null,
  p_file_size bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv public.conversations;
  v_other uuid;
  v_body text := coalesce(p_body, '');
  v_id bigint;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;

  select * into v_conv from public.conversations where id = p_conversation;
  if not found or v_me not in (v_conv.user_a, v_conv.user_b) then
    raise exception 'Conversation not found';
  end if;
  v_other := case when v_me = v_conv.user_a then v_conv.user_b else v_conv.user_a end;

  if public.is_blocked_between(v_me, v_other) then
    raise exception 'You cannot message this person';
  end if;

  if char_length(v_body) > 4000 then raise exception 'The message is too long (4000 characters at most)'; end if;
  if char_length(btrim(v_body)) = 0 and p_file_path is null then raise exception 'The message is empty'; end if;

  if (select count(*) from public.direct_messages
       where sender_id = v_me and created_at > now() - interval '1 minute')
       >= public.chat_setting('chat_messages_per_minute') then
    raise exception 'Slow down: too many messages in the last minute';
  end if;

  if p_file_path is not null then
    -- The file must sit in the sender's own folder and really exist.
    if split_part(p_file_path, '/', 1) <> v_me::text or p_file_path !~ '^[0-9a-f-]{36}/[^/]+$' then
      raise exception 'The file is not in your own folder';
    end if;
    if p_file_name is null or char_length(btrim(p_file_name)) = 0 then raise exception 'The file needs a name'; end if;
    if p_file_mime is null or p_file_mime not in (
         'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
         'text/plain', 'text/markdown', 'application/zip', 'application/json') then
      raise exception 'This file type is not allowed';
    end if;
    if p_file_size is null or p_file_size <= 0
       or p_file_size > public.chat_setting('dm_max_file_mb')::bigint * 1024 * 1024 then
      raise exception 'The file is too large (% MB at most)', public.chat_setting('dm_max_file_mb');
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'dm-files' and name = p_file_path) then
      raise exception 'The file was not uploaded';
    end if;
    if exists (select 1 from public.direct_messages where file_path = p_file_path) then
      raise exception 'This file is already attached to a message';
    end if;
  end if;

  insert into public.direct_messages (conversation_id, sender_id, body, file_path, file_name, file_mime, file_size)
  values (p_conversation, v_me, v_body, p_file_path, p_file_name, p_file_mime, p_file_size)
  returning id into v_id;

  update public.conversations set last_message_at = now() where id = p_conversation;
  return v_id;
end $$;

create function public.edit_direct_message(p_message bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.direct_messages;
begin
  select * into v_msg from public.direct_messages where id = p_message;
  if not found or v_msg.deleted_at is not null then raise exception 'Message not found'; end if;
  if v_msg.sender_id <> auth.uid() then raise exception 'You can only edit your own messages'; end if;
  if char_length(p_body) > 4000 then raise exception 'The message is too long (4000 characters at most)'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 and v_msg.file_path is null then
    raise exception 'The message is empty';
  end if;
  update public.direct_messages set body = p_body, edited_at = now() where id = p_message;
end $$;

create function public.delete_direct_message(p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.direct_messages;
begin
  select * into v_msg from public.direct_messages where id = p_message;
  if not found or v_msg.deleted_at is not null then raise exception 'Message not found'; end if;
  if v_msg.sender_id <> auth.uid() then raise exception 'You can only delete your own messages'; end if;

  -- The row stays so the conversation keeps its shape; text and file are detached.
  -- The file_path is cleared so the other person loses access to the file.
  update public.direct_messages
     set body = '', file_path = null, file_name = null, file_mime = null, file_size = null, deleted_at = now()
   where id = p_message;
end $$;

create function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or auth.uid() not in (v_conv.user_a, v_conv.user_b) then
    raise exception 'Conversation not found';
  end if;
  if auth.uid() = v_conv.user_a then
    update public.conversations set a_read_at = now() where id = p_conversation;
  else
    update public.conversations set b_read_at = now() where id = p_conversation;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The inbox: my conversations, newest first, with unread counts.
-- Runs with the caller's own rights, so the privacy rules apply as usual.
-- ---------------------------------------------------------------------
create function public.list_my_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_url text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
as $$
  select
    c.id,
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    (select case when m.file_path is not null and char_length(btrim(m.body)) = 0 then '[file] ' || m.file_name
                 else left(m.body, 80) end
       from public.direct_messages m
      where m.conversation_id = c.id and m.deleted_at is null
      order by m.id desc limit 1),
    c.last_message_at,
    (select count(*) from public.direct_messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(case when auth.uid() = c.user_a then c.a_read_at else c.b_read_at end, '-infinity'))
  from public.conversations c
  join public.profiles p on p.id = case when auth.uid() = c.user_a then c.user_b else c.user_a end
  where auth.uid() in (c.user_a, c.user_b)
  order by c.last_message_at desc nulls last, c.created_at desc
$$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.direct_messages enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations_started enable row level security;

revoke all on public.conversations, public.direct_messages, public.blocks,
  public.conversations_started from public, anon, authenticated;

grant select on public.conversations, public.direct_messages, public.blocks to authenticated;

create policy "you see only your own conversations"
  on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

create policy "you read only the messages of your own conversations"
  on public.direct_messages for select to authenticated
  using (public.in_conversation(conversation_id));

create policy "you see only the people you blocked"
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

-- conversations_started: no policy and no grant, so nobody reads it directly.

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.start_conversation(uuid) from public, anon;
revoke execute on function public.send_direct_message(uuid, text, text, text, text, bigint) from public, anon;
revoke execute on function public.edit_direct_message(bigint, text) from public, anon;
revoke execute on function public.delete_direct_message(bigint) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.list_my_conversations() from public, anon;

grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.start_conversation(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.edit_direct_message(bigint, text) to authenticated;
grant execute on function public.delete_direct_message(bigint) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.list_my_conversations() to authenticated;

grant execute on function public.in_conversation(uuid) to authenticated;
grant execute on function public.can_read_dm_file(text) to authenticated;
-- is_blocked_between is only for the server's own use.
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

grant all on public.conversations, public.direct_messages, public.blocks,
  public.conversations_started to service_role;

-- ---------------------------------------------------------------------
-- Live updates (Supabase Realtime). Skipped where there is no Realtime.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- File storage: a private bucket and its rules.
--   * Upload: only into your own folder (a folder named after your member id).
--   * Open: your own files, plus files attached to a message in a conversation
--     you are part of.
--   * No overwrite and no delete from the browser.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-files', 'dm-files', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
        'text/plain', 'text/markdown', 'application/zip', 'application/json']
)
on conflict (id) do nothing;

create policy "members upload into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dm-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members open their own files and files sent to them"
  on storage.objects for select to authenticated
  using (bucket_id = 'dm-files' and public.can_read_dm_file(name));

commit;
