-- Tests for migration 5 (private messages and files).
-- Run AFTER migrations 1 to 5. psql -v ON_ERROR_STOP=1 -f dm.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
--
-- People in this test:
--   ana     (...0001)
--   babacar (...0002)
--   coumba  (...0003)  the outsider: never part of ana and babacar's conversation
--   demba   (...0004)  starts conversations, for the daily limit
--   eliane  (...0005)  and fatou (...0006): used for the spam limit

create schema dmkit;
grant usage on schema dmkit to public;

create function dmkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('dddddddd-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function dmkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', dmkit.uid(p_n)::text, true);
end $$;

create function dmkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- The conversation between two of the people above (null if none yet).
create function dmkit.conv(p_a int, p_b int) returns uuid
language sql stable security definer as $$
  select id from public.conversations
   where user_a = least(dmkit.uid(p_a), dmkit.uid(p_b)) and user_b = greatest(dmkit.uid(p_a), dmkit.uid(p_b))
$$;

create function dmkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function dmkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := dmkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (dmkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (dmkit.uid(2), 'babacar@exemple.sn', '{"provider":"email"}', '{}'),
  (dmkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (dmkit.uid(4), 'demba@exemple.sn', '{"provider":"email"}', '{}'),
  (dmkit.uid(5), 'eliane@exemple.sn', '{"provider":"email"}', '{}'),
  (dmkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Starting a conversation ---------------------------------------------
do $$
declare c1 uuid; c2 uuid; n int;
begin
  perform dmkit.as_user(1);
  c1 := public.start_conversation(dmkit.uid(2));
  perform dmkit.must_fail('messaging yourself', format('select public.start_conversation(%L)', dmkit.uid(1)), 'yourself');
  perform dmkit.must_fail('messaging someone who does not exist', $q$select public.start_conversation('99999999-9999-9999-9999-999999999999')$q$, 'not found');
  reset role;

  -- the other person starting it gets the same conversation: a pair exists once
  perform dmkit.as_user(2);
  c2 := public.start_conversation(dmkit.uid(1));
  reset role;
  if c1 <> c2 then raise exception 'FAIL: the same pair got two conversations'; end if;

  select count(*) into n from public.conversations where user_a = least(dmkit.uid(1), dmkit.uid(2)) and user_b = greatest(dmkit.uid(1), dmkit.uid(2));
  if n <> 1 then raise exception 'FAIL: expected exactly one conversation, got %', n; end if;

  perform dmkit.as_anon();
  perform dmkit.must_fail('visitor starting a conversation', format('select public.start_conversation(%L)', dmkit.uid(1)), 'permission denied');
  reset role;
  raise notice 'OK 1: one conversation per pair, started from either side; no self-messages, no ghosts, no visitors';
end $$;

-- ---- 2. Privacy: only the two people can read ------------------------------------
do $$
declare c uuid := dmkit.conv(1, 2); n int;
begin
  perform dmkit.as_user(1);
  perform public.send_direct_message(c, 'Salut Babacar, tu as vu le defi ?');
  reset role;
  perform dmkit.as_user(2);
  perform public.send_direct_message(c, 'Oui, il est dur !');
  reset role;

  perform dmkit.as_user(3);
  select count(*) into n from public.conversations;
  if n <> 0 then raise exception 'FAIL: outsider sees % conversations', n; end if;
  select count(*) into n from public.direct_messages;
  if n <> 0 then raise exception 'FAIL: outsider sees % private messages', n; end if;
  select count(*) into n from public.list_my_conversations();
  if n <> 0 then raise exception 'FAIL: outsider inbox is not empty'; end if;
  perform dmkit.must_fail('outsider sends into someone else''s conversation', format('select public.send_direct_message(%L, %L)', c, 'intrus'), 'not found');
  perform dmkit.must_fail('outsider marks it read', format('select public.mark_conversation_read(%L)', c), 'not found');
  reset role;

  perform dmkit.as_anon();
  perform dmkit.must_fail('visitor reads private messages', 'select count(*) from public.direct_messages', 'permission denied');
  perform dmkit.must_fail('visitor reads conversations', 'select count(*) from public.conversations', 'permission denied');
  reset role;

  perform dmkit.as_user(1);
  select count(*) into n from public.direct_messages;
  if n <> 2 then raise exception 'FAIL: ana should see both messages, saw %', n; end if;
  reset role;
  raise notice 'OK 2: only the two people in a conversation can read or write in it';
end $$;

-- ---- 3. Nobody writes to the tables directly -----------------------------------------
do $$
declare c uuid := dmkit.conv(1, 2);
begin
  perform dmkit.as_user(1);
  perform dmkit.must_fail('direct message insert', format('insert into public.direct_messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', c, 'x'), 'permission denied');
  perform dmkit.must_fail('direct message edit', $q$update public.direct_messages set body = 'hack'$q$, 'permission denied');
  perform dmkit.must_fail('direct message delete', 'delete from public.direct_messages', 'permission denied');
  perform dmkit.must_fail('direct conversation insert', format('insert into public.conversations (user_a, user_b) values (%L, %L)', dmkit.uid(1), dmkit.uid(5)), 'permission denied');
  perform dmkit.must_fail('direct block insert', format('insert into public.blocks (blocker_id, blocked_id) values (%L, %L)', dmkit.uid(1), dmkit.uid(5)), 'permission denied');
  perform dmkit.must_fail('reading who started conversations', 'select * from public.conversations_started', 'permission denied');
  reset role;
  raise notice 'OK 3: tables are read-only for members';
end $$;

-- ---- 4. Sending, editing, deleting --------------------------------------------------------
do $$
declare c uuid := dmkit.conv(1, 2); m bigint;
begin
  perform dmkit.as_user(1);
  perform dmkit.must_fail('empty message', format('select public.send_direct_message(%L, %L)', c, '   '), 'empty');
  perform dmkit.must_fail('4001 characters', format('select public.send_direct_message(%L, %L)', c, repeat('x', 4001)), 'too long');
  m := public.send_direct_message(c, repeat('x', 4000)); -- exactly the limit
  perform public.edit_direct_message(m, 'corrige');
  reset role;
  if (select body from public.direct_messages where id = m) <> 'corrige' or (select edited_at from public.direct_messages where id = m) is null then
    raise exception 'FAIL: edit did not save';
  end if;

  perform dmkit.as_user(2);
  perform dmkit.must_fail('editing the other person''s message', format('select public.edit_direct_message(%L, %L)', m, 'hack'), 'your own');
  perform dmkit.must_fail('deleting the other person''s message', format('select public.delete_direct_message(%L)', m), 'your own');
  reset role;

  perform dmkit.as_user(1);
  perform public.delete_direct_message(m);
  perform dmkit.must_fail('editing a deleted message', format('select public.edit_direct_message(%L, %L)', m, 'zombie'), 'not found');
  reset role;
  if (select deleted_at from public.direct_messages where id = m) is null or (select body from public.direct_messages where id = m) <> '' then
    raise exception 'FAIL: delete did not wipe the message';
  end if;
  raise notice 'OK 4: you edit and delete only your own messages';
end $$;

-- ---- 5. Inbox and unread counts -------------------------------------------------------------
-- (the messages from block 2 were sent in earlier transactions; marking read happens later)
do $$
declare r record; c uuid := dmkit.conv(1, 2);
begin
  perform dmkit.as_user(2);
  select * into r from public.list_my_conversations() where conversation_id = c;
  if r.other_user_id <> dmkit.uid(1) then raise exception 'FAIL: inbox shows the wrong person'; end if;
  if r.unread_count <> 1 then raise exception 'FAIL: babacar should have 1 unread (ana wrote 1 live message), got %', r.unread_count; end if;
  if r.other_username <> 'ana' then raise exception 'FAIL: inbox username is %', r.other_username; end if;
  reset role;

  -- you never have unread messages from yourself
  perform dmkit.as_user(1);
  select * into r from public.list_my_conversations() where conversation_id = c;
  if r.unread_count <> 1 then raise exception 'FAIL: ana should have 1 unread (babacar wrote 1), got %', r.unread_count; end if;
  reset role;
end $$;

do $$
declare r record; c uuid := dmkit.conv(1, 2);
begin
  perform dmkit.as_user(2);
  perform public.mark_conversation_read(c);
  reset role;
end $$;

do $$
declare r record; c uuid := dmkit.conv(1, 2);
begin
  perform dmkit.as_user(2);
  select * into r from public.list_my_conversations() where conversation_id = c;
  if r.unread_count <> 0 then raise exception 'FAIL: unread should be 0 after reading, got %', r.unread_count; end if;
  reset role;
  -- reading does not clear the other person's unread
  perform dmkit.as_user(1);
  select * into r from public.list_my_conversations() where conversation_id = c;
  if r.unread_count <> 1 then raise exception 'FAIL: ana unread changed when babacar read, got %', r.unread_count; end if;
  if r.last_message_preview <> 'Oui, il est dur !' then raise exception 'FAIL: preview is %', r.last_message_preview; end if;
  reset role;
  raise notice 'OK 5: inbox shows the other person, a preview and unread counts per person';
end $$;

-- ---- 6. Blocking -----------------------------------------------------------------------------------
do $$
declare c uuid := dmkit.conv(1, 2); n int;
begin
  perform dmkit.as_user(2);
  perform dmkit.must_fail('blocking yourself', format('select public.block_user(%L)', dmkit.uid(2)), 'yourself');
  perform public.block_user(dmkit.uid(1));
  perform public.block_user(dmkit.uid(1)); -- twice is harmless
  perform dmkit.must_fail('blocker keeps writing', format('select public.send_direct_message(%L, %L)', c, 'encore'), 'cannot message');
  select count(*) into n from public.blocks;
  if n <> 1 then raise exception 'FAIL: babacar should see his 1 block, saw %', n; end if;
  reset role;

  perform dmkit.as_user(1);
  perform dmkit.must_fail('blocked person writes', format('select public.send_direct_message(%L, %L)', c, 'hello ?'), 'cannot message');
  perform dmkit.must_fail('blocked person starts again', format('select public.start_conversation(%L)', dmkit.uid(2)), 'cannot message');
  select count(*) into n from public.blocks;
  if n <> 0 then raise exception 'FAIL: the blocked person can see who blocked them (% rows)', n; end if;
  reset role;

  perform dmkit.as_user(2);
  perform public.unblock_user(dmkit.uid(1));
  reset role;
  perform dmkit.as_user(1);
  perform public.send_direct_message(c, 'Merci de m''ecouter');
  reset role;
  raise notice 'OK 6: blocking stops both directions, stays private, and can be undone';
end $$;

-- ---- 7. Files: upload rules ------------------------------------------------------------------------
do $$
declare p text := dmkit.uid(1)::text || '/schema.png'; n int;
begin
  perform dmkit.as_user(1);
  insert into storage.objects (bucket_id, name) values ('dm-files', p);
  perform dmkit.must_fail('upload into another member''s folder',
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'dm-files', dmkit.uid(2)::text || '/faux.png'), 'row-level security');
  perform dmkit.must_fail('upload into the root', $q$insert into storage.objects (bucket_id, name) values ('dm-files', 'vrac.png')$q$, 'row-level security');
  -- no update or delete rule exists, so these silently change nothing
  update storage.objects set name = dmkit.uid(1)::text || '/autre.png' where name = p;
  delete from storage.objects where name = p;
  if not exists (select 1 from storage.objects where name = p) then
    raise exception 'FAIL: a member could rename or delete an uploaded file';
  end if;
  -- the uploader sees their own file
  select count(*) into n from storage.objects where bucket_id = 'dm-files';
  if n <> 1 then raise exception 'FAIL: uploader should see 1 file, saw %', n; end if;
  reset role;

  -- not attached yet: the other person cannot open it
  perform dmkit.as_user(2);
  select count(*) into n from storage.objects where bucket_id = 'dm-files';
  if n <> 0 then raise exception 'FAIL: a file was visible before being attached to a message'; end if;
  reset role;

  if (select public from storage.buckets where id = 'dm-files') then raise exception 'FAIL: the bucket is public'; end if;
  if (select file_size_limit from storage.buckets where id = 'dm-files') <> 10485760 then raise exception 'FAIL: bucket size limit is wrong'; end if;
  raise notice 'OK 7: uploads only into your own folder; a file is private until sent; the bucket is private';
end $$;

-- ---- 8. Files: attaching to a message ----------------------------------------------------------------
do $$
declare c uuid := dmkit.conv(1, 2); p text := dmkit.uid(1)::text || '/schema.png'; m bigint; n int;
begin
  perform dmkit.as_user(1);
  perform dmkit.must_fail('file in another member''s folder', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'voila', dmkit.uid(2)::text || '/x.png', 'x.png', 'image/png', 100), 'own folder');
  perform dmkit.must_fail('file that was never uploaded', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'voila', dmkit.uid(1)::text || '/fantome.png', 'fantome.png', 'image/png', 100), 'not uploaded');
  perform dmkit.must_fail('file type not allowed', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'voila', p, 'virus.exe', 'application/x-msdownload', 100), 'not allowed');
  perform dmkit.must_fail('file over 10 MB', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'voila', p, 'schema.png', 'image/png', 10485761), 'too large');
  perform dmkit.must_fail('path with a sub-folder', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'voila', dmkit.uid(1)::text || '/a/b.png', 'b.png', 'image/png', 100), 'own folder');

  -- file only, no text: allowed
  m := public.send_direct_message(c, '', p, 'schema.png', 'image/png', 2048);
  perform dmkit.must_fail('same file twice', format('select public.send_direct_message(%L, %L, %L, %L, %L, %s)', c, 'encore', p, 'schema.png', 'image/png', 2048), 'already attached');
  reset role;

  -- now babacar can open it, coumba cannot
  perform dmkit.as_user(2);
  select count(*) into n from storage.objects where bucket_id = 'dm-files' and name = p;
  if n <> 1 then raise exception 'FAIL: the recipient cannot open the file'; end if;
  reset role;
  perform dmkit.as_user(3);
  select count(*) into n from storage.objects where bucket_id = 'dm-files';
  if n <> 0 then raise exception 'FAIL: an outsider can open a private file'; end if;
  reset role;
  raise notice 'OK 8: files are checked (folder, existence, type, size), attach once, and open only for the two people';
end $$;

-- the inbox preview of a file-only message
do $$
declare r record; c uuid := dmkit.conv(1, 2);
begin
  perform dmkit.as_user(2);
  select * into r from public.list_my_conversations() where conversation_id = c;
  if r.last_message_preview <> '[file] schema.png' then raise exception 'FAIL: file preview is %', r.last_message_preview; end if;
  reset role;
end $$;

-- ---- 9. Deleting a message removes the other person's access to its file --------------------------------
do $$
declare p text := dmkit.uid(1)::text || '/schema.png'; m bigint; n int;
begin
  select id into m from public.direct_messages where file_path = p;
  perform dmkit.as_user(2);
  perform dmkit.must_fail('deleting the other person''s file message', format('select public.delete_direct_message(%L)', m), 'your own');
  reset role;
  perform dmkit.as_user(1);
  perform public.delete_direct_message(m);
  select count(*) into n from storage.objects where name = p;
  if n <> 1 then raise exception 'FAIL: the owner should still see their own file'; end if;
  reset role;
  perform dmkit.as_user(2);
  select count(*) into n from storage.objects where name = p;
  if n <> 0 then raise exception 'FAIL: the other person can still open a deleted message''s file'; end if;
  reset role;
  raise notice 'OK 9: deleting a message closes the file to the other person';
end $$;

-- ---- 10. Daily limit on new conversations ----------------------------------------------------------------
update public.game_config set value = '2' where key = 'dm_new_conversations_per_day';

do $$
declare c1 uuid; again uuid;
begin
  perform dmkit.as_user(4);
  c1 := public.start_conversation(dmkit.uid(1));
  perform public.start_conversation(dmkit.uid(2));
  perform dmkit.must_fail('third new conversation in a day', format('select public.start_conversation(%L)', dmkit.uid(3)), 'new conversations');
  -- opening an existing conversation again is not "new"
  again := public.start_conversation(dmkit.uid(1));
  reset role;
  if again <> c1 then raise exception 'FAIL: existing conversation was not reused'; end if;
  raise notice 'OK 10: daily limit on new conversations (existing ones do not count)';
end $$;

update public.game_config set value = '20' where key = 'dm_new_conversations_per_day';

-- ---- 11. Spam limit ----------------------------------------------------------------------------------------------
do $$
declare c uuid; i int;
begin
  perform dmkit.as_user(5);
  c := public.start_conversation(dmkit.uid(6));
  for i in 1..20 loop
    perform public.send_direct_message(c, 'spam ' || i);
  end loop;
  perform dmkit.must_fail('21st message in a minute', format('select public.send_direct_message(%L, %L)', c, 'spam 21'), 'slow down');
  reset role;

  -- the limit is per person
  perform dmkit.as_user(6);
  perform public.send_direct_message(c, 'moi je peux repondre');
  reset role;
  raise notice 'OK 11: 20 private messages a minute per member, then a pause';
end $$;

-- ---- 12. Live updates ----------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages') then
    raise exception 'FAIL: direct_messages is not in the realtime publication';
  end if;
  raise notice 'OK 12: new private messages are sent out live';
end $$;

select 'ALL PRIVATE MESSAGE TESTS PASSED' as result;
