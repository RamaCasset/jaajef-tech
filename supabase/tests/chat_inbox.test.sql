-- Tests for the chat inbox. Run AFTER all migrations.
-- People: rama (1) owns the community; sala (2) is a member; tida (3) is not a member.

create schema cit;
grant usage on schema cit to public;
create function cit.uid(p_n int) returns uuid language sql immutable as $$ select ('f7a8b9c0-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function cit.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', cit.uid(p_n)::text, true); end $$;
create function cit.as_anon() returns void language plpgsql as $$
begin set local role anon; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function cit.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (cit.uid(1), 'rama-ci@exemple.sn', '{"provider":"email"}', '{}'),
  (cit.uid(2), 'sala-ci@exemple.sn', '{"provider":"email"}', '{}'),
  (cit.uid(3), 'tida-ci@exemple.sn', '{"provider":"email"}', '{}');

insert into public.communities (id, slug, name, is_private, owner_id) values
  ('f7a8b9c0-aaaa-0000-0000-000000000001', 'ci-salon', 'Salon', false, cit.uid(1));
insert into public.community_members (community_id, user_id, role, joined_at) values
  ('f7a8b9c0-aaaa-0000-0000-000000000001', cit.uid(1), 'owner', now() - interval '1 day'),
  ('f7a8b9c0-aaaa-0000-0000-000000000001', cit.uid(2), 'member', now() - interval '1 day');
insert into public.channels (id, community_id, slug, name, kind) values
  ('f7a8b9c0-bbbb-0000-0000-000000000001', 'f7a8b9c0-aaaa-0000-0000-000000000001', 'ci-general', 'general', 'chat');

do $$
declare
  ch uuid := 'f7a8b9c0-bbbb-0000-0000-000000000001';
  com uuid := 'f7a8b9c0-aaaa-0000-0000-000000000001';
  r record;
begin
  -- Three messages from rama, one from sala, all after sala and rama joined.
  insert into public.messages (channel_id, community_id, author_id, body, created_at) values
    (ch, com, cit.uid(1), 'un', now() - interval '3 hours'),
    (ch, com, cit.uid(1), 'deux', now() - interval '2 hours'),
    (ch, com, cit.uid(2), 'trois', now() - interval '1 hour'),
    (ch, com, cit.uid(1), 'quatre', now() - interval '30 minutes');

  -- 1. Sala sees 3 unread (her own message does not count) and the last message.
  perform cit.as_user(2);
  select * into r from public.list_my_chat_inbox() where community_id = com;
  reset role;
  if r.unread_count <> 3 then raise exception 'FAIL: expected 3 unread, got %', r.unread_count; end if;
  if r.last_message_preview <> 'quatre' then raise exception 'FAIL: wrong last message %', r.last_message_preview; end if;
  raise notice 'OK 1: unread count and last message';

  -- 2. After she reads the channel, nothing is unread.
  perform cit.as_user(2);
  perform public.mark_channel_read(ch);
  select * into r from public.list_my_chat_inbox() where community_id = com;
  reset role;
  if r.unread_count <> 0 then raise exception 'FAIL: expected 0 unread after reading, got %', r.unread_count; end if;
  raise notice 'OK 2: reading clears the count';

  -- 3. A new message after reading counts again; a deleted one does not.
  insert into public.messages (channel_id, community_id, author_id, body) values (ch, com, cit.uid(1), 'cinq');
  update public.messages set created_at = now() + interval '1 second' where body = 'cinq' and channel_id = ch;
  insert into public.messages (channel_id, community_id, author_id, body, deleted_at) values (ch, com, cit.uid(1), '', now());
  perform cit.as_user(2);
  select * into r from public.list_my_chat_inbox() where community_id = com;
  reset role;
  if r.unread_count <> 1 then raise exception 'FAIL: expected 1 unread, got %', r.unread_count; end if;
  raise notice 'OK 3: new messages count, deleted ones do not';

  -- 4. A non-member sees nothing and cannot mark the channel.
  perform cit.as_user(3);
  if exists (select 1 from public.list_my_chat_inbox() where community_id = com) then
    raise exception 'FAIL: an outsider sees the community';
  end if;
  if cit.error_of(format('select public.mark_channel_read(%L)', ch)) is null then
    raise exception 'FAIL: an outsider marked a channel as read';
  end if;
  reset role;
  raise notice 'OK 4: outsiders are kept out';

  -- 5. A visitor cannot use the inbox, and nobody can write read marks directly.
  perform cit.as_anon();
  if cit.error_of('select * from public.list_my_chat_inbox()') is null then raise exception 'FAIL: a visitor ran the inbox'; end if;
  reset role;
  perform cit.as_user(2);
  if cit.error_of(format('insert into public.channel_reads (user_id, channel_id) values (%L, %L)', cit.uid(2), ch)) is null then
    raise exception 'FAIL: a read mark was written directly';
  end if;
  reset role;
  raise notice 'OK 5: visitors and direct writes refused';

  -- 6. Deleting the community removes the read marks.
  delete from public.communities where id = com;
  if exists (select 1 from public.channel_reads where channel_id = ch) then raise exception 'FAIL: read marks stayed'; end if;
  raise notice 'OK 6: read marks leave with the community';
end $$;

drop schema cit cascade;
