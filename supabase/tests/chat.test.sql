-- Tests for migration 4 (chat: communities, channels, messages).
-- Run AFTER migrations 1 to 4. psql -v ON_ERROR_STOP=1 -f chat.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
--
-- People in this test:
--   ama     (...0001)  creates the communities, becomes owner
--   bineta  (...0002)  joins as a plain member
--   cheikh  (...0003)  stays an outsider for most of the test
--   dior    (...0004)  promoted to moderator
--   eliane  (...0005)  used for the spam limit
--   fatou   (...0006)  used for the "3 communities" limit

-- Small helpers that only exist in the test database.
create schema testkit;
grant usage on schema testkit to public;

create function testkit.as_user(p_user text) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-00000000000' || p_user, true);
end $$;

create function testkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Runs a statement and returns the error text, or null if it worked.
create function testkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Fails the test unless the statement is refused with a message containing p_expect.
create function testkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := testkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001', 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000002', 'bineta@exemple.sn', '{"provider":"email"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000003', 'cheikh@exemple.sn', '{"provider":"email"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000004', 'dior@exemple.sn', '{"provider":"email"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000005', 'eliane@exemple.sn', '{"provider":"email"}', '{}'),
  ('cccccccc-0000-0000-0000-000000000006', 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Creating a community sets everything up ----------------------------
do $$
declare c uuid; c2 uuid; n int;
begin
  perform testkit.as_user('1');
  c := public.create_community('dev-dakar', 'Dev Dakar', 'Les devs de Dakar', false);
  c2 := public.create_community('cercle-prive', 'Cercle prive', 'Sur invitation', true);
  reset role;

  if (select role from public.community_members where community_id = c and user_id = 'cccccccc-0000-0000-0000-000000000001') <> 'owner' then
    raise exception 'FAIL: creator is not owner';
  end if;
  select count(*) into n from public.channels where community_id = c;
  if n <> 2 then raise exception 'FAIL: expected 2 default channels, got %', n; end if;
  if not exists (select 1 from public.channels where community_id = c and slug = 'general' and kind = 'chat') then
    raise exception 'FAIL: general channel missing';
  end if;
  if not exists (select 1 from public.channels where community_id = c and slug = 'annonces' and kind = 'announcement') then
    raise exception 'FAIL: annonces channel missing';
  end if;

  -- bad names are refused
  perform testkit.as_user('1');
  perform testkit.must_fail('bad slug', $q$select public.create_community('A B', 'Nom', null, false)$q$, 'check');
  reset role;
  raise notice 'OK 1: a new community has its owner and two default channels';
end $$;

-- ---- 2. Privacy: outsiders and visitors see only public communities --------
do $$
declare n int;
begin
  perform testkit.as_user('3');
  select count(*) into n from public.communities;
  if n <> 1 then raise exception 'FAIL: outsider should see 1 community (the public one), saw %', n; end if;
  if exists (select 1 from public.communities where slug = 'cercle-prive') then
    raise exception 'FAIL: outsider can see a private community';
  end if;
  select count(*) into n from public.channels;
  if n <> 0 then raise exception 'FAIL: outsider sees % channels', n; end if;
  select count(*) into n from public.community_members;
  if n <> 0 then raise exception 'FAIL: outsider sees % members', n; end if;
  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'FAIL: outsider sees % messages', n; end if;
  reset role;

  perform testkit.as_anon();
  select count(*) into n from public.communities;
  if n <> 1 then raise exception 'FAIL: visitor should see 1 public community, saw %', n; end if;
  perform testkit.must_fail('visitor reads channels', 'select count(*) from public.channels', 'permission denied');
  perform testkit.must_fail('visitor reads messages', 'select count(*) from public.messages', 'permission denied');
  perform testkit.must_fail('visitor creates a community', $q$select public.create_community('visiteur', 'Visiteur', null, false)$q$, 'permission denied');
  reset role;

  -- the owner does see the private one
  perform testkit.as_user('1');
  select count(*) into n from public.communities;
  if n <> 2 then raise exception 'FAIL: owner should see both communities, saw %', n; end if;
  reset role;
  raise notice 'OK 2: outsiders and visitors cannot see private communities, channels, members or messages';
end $$;

-- ---- 3. Joining -------------------------------------------------------------
do $$
declare c uuid; cp uuid;
begin
  select id into c from public.communities where slug = 'dev-dakar';
  select id into cp from public.communities where slug = 'cercle-prive';

  perform testkit.as_user('2');
  perform public.join_community(c);
  perform public.join_community(c); -- twice is harmless
  perform testkit.must_fail('joining a private community without invite', format('select public.join_community(%L)', cp), 'private');
  reset role;

  if (select count(*) from public.community_members where community_id = c and user_id = 'cccccccc-0000-0000-0000-000000000002') <> 1 then
    raise exception 'FAIL: bineta should be a member exactly once';
  end if;
  if (select role from public.community_members where community_id = c and user_id = 'cccccccc-0000-0000-0000-000000000002') <> 'member' then
    raise exception 'FAIL: new joiner should be a plain member';
  end if;
  raise notice 'OK 3: public communities can be joined, private ones cannot without an invite';
end $$;

-- ---- 4. Invites ----------------------------------------------------------------
do $$
declare cp uuid; v_normal text; v_single text;
begin
  select id into cp from public.communities where slug = 'cercle-prive';

  -- a plain member of the public community, or an outsider, cannot make invites
  perform testkit.as_user('2');
  perform testkit.must_fail('outsider creates invite', format('select public.create_invite(%L)', cp), 'owner or a moderator');
  reset role;

  perform testkit.as_user('1');
  v_normal := public.create_invite(cp);
  v_single := public.create_invite(cp, 7, 1);
  perform testkit.must_fail('invite lasting 90 days', format('select public.create_invite(%L, 90)', cp), 'between 1 and 30');
  reset role;
  create temp table invite_codes as select v_normal as normal, v_single as single;
  grant select on invite_codes to public;

  perform testkit.as_user('3');
  perform public.join_with_invite((select normal from invite_codes));
  perform public.join_with_invite((select normal from invite_codes)); -- already in: fine
  perform testkit.must_fail('made-up invite', $q$select public.join_with_invite('nope')$q$, 'does not exist');
  -- cheikh now sees the private community and its channels
  if (select count(*) from public.communities where slug = 'cercle-prive') <> 1 then
    raise exception 'FAIL: invited member cannot see the private community';
  end if;
  if (select count(*) from public.channels where community_id = cp) <> 2 then
    raise exception 'FAIL: invited member cannot see the channels';
  end if;
  reset role;

  if (select uses from public.community_invites where code = (select normal from invite_codes)) <> 1 then
    raise exception 'FAIL: invite should count 1 use (re-opening it must not use it up)';
  end if;
  raise notice 'OK 4a: only owner or moderator makes invites; an invite lets a person in once';
end $$;

do $$
declare cp uuid;
begin
  select id into cp from public.communities where slug = 'cercle-prive';

  -- single-use invite: first person gets in, second is refused
  perform testkit.as_user('4');
  perform public.join_with_invite((select single from invite_codes));
  reset role;
  perform testkit.as_user('2');
  perform testkit.must_fail('invite used past its limit', format('select public.join_with_invite(%L)', (select single from invite_codes)), 'too many times');
  reset role;

  -- expired invite
  update public.community_invites set expires_at = now() - interval '1 day'
   where code = (select normal from invite_codes);
end $$;

do $$
begin
  perform testkit.as_user('5');
  perform testkit.must_fail('expired invite', format('select public.join_with_invite(%L)', (select normal from invite_codes)), 'expired');
  reset role;
  raise notice 'OK 4b: single-use and expired invites are refused';
end $$;

-- ---- 5. Messages: who can send, who can read -------------------------------------
do $$
declare ch uuid; ann uuid; n int;
begin
  select id into ch from public.channels where slug = 'general' and community_id = (select id from public.communities where slug = 'dev-dakar');
  select id into ann from public.channels where slug = 'annonces' and community_id = (select id from public.communities where slug = 'dev-dakar');

  perform testkit.as_user('2');
  perform public.send_message(ch, 'Salut tout le monde');
  perform testkit.must_fail('plain member posts an announcement', format('select public.send_message(%L, %L)', ann, 'Je poste'), 'announcement');
  perform testkit.must_fail('empty message', format('select public.send_message(%L, %L)', ch, '   '), 'empty');
  perform testkit.must_fail('4001 character message', format('select public.send_message(%L, %L)', ch, repeat('x', 4001)), 'too long');
  perform public.send_message(ch, repeat('x', 4000)); -- exactly the limit is fine
  reset role;

  perform testkit.as_user('1');
  perform public.send_message(ann, 'Bienvenue sur Dev Dakar');
  reset role;

  -- cheikh joined only the private community: he must not read or write here
  perform testkit.as_user('3');
  select count(*) into n from public.messages where community_id = (select id from public.communities where slug = 'dev-dakar');
  if n <> 0 then raise exception 'FAIL: non-member read % messages', n; end if;
  perform testkit.must_fail('non-member sends', format('select public.send_message(%L, %L)', ch, 'intrus'), 'not in this community');
  reset role;

  -- members read everything in their community
  perform testkit.as_user('2');
  select count(*) into n from public.messages where channel_id in (ch, ann);
  if n <> 3 then raise exception 'FAIL: member should see 3 messages, saw %', n; end if;
  reset role;
  raise notice 'OK 5: members read and write, outsiders cannot; announcements are for owner and moderators';
end $$;

-- ---- 6. Forum threads ---------------------------------------------------------------
do $$
declare c uuid; forum uuid; ch uuid; thread bigint; reply bigint; chat_msg bigint;
begin
  select id into c from public.communities where slug = 'dev-dakar';
  select id into ch from public.channels where slug = 'general' and community_id = c;

  perform testkit.as_user('2');
  perform testkit.must_fail('member creates a channel', format('select public.create_channel(%L, %L, %L, %L)', c, 'forum', 'Forum', 'forum'), 'owner or a moderator');
  reset role;

  perform testkit.as_user('1');
  forum := public.create_channel(c, 'forum', 'Forum', 'forum');
  perform testkit.must_fail('duplicate channel', format('select public.create_channel(%L, %L, %L, %L)', c, 'forum', 'Forum', 'forum'), 'duplicate');
  perform testkit.must_fail('unknown channel kind', format('select public.create_channel(%L, %L, %L, %L)', c, 'voix', 'Voix', 'voice'), 'check');
  reset role;

  perform testkit.as_user('2');
  perform testkit.must_fail('thread without title', format('select public.send_message(%L, %L)', forum, 'Ma question'), 'needs a title');
  thread := public.send_message(forum, 'Comment faire une boucle en Python ?', null, 'Boucles en Python');
  reply := public.send_message(forum, 'Utilise for ... in range()', thread);
  perform testkit.must_fail('reply to a reply', format('select public.send_message(%L, %L, %L)', forum, 'trop profond', reply), 'thread itself');
  perform testkit.must_fail('title on a reply', format('select public.send_message(%L, %L, %L, %L)', forum, 'oups', thread, 'Titre'), 'only a new thread');
  perform testkit.must_fail('title in a chat channel', format('select public.send_message(%L, %L, null, %L)', ch, 'oups', 'Titre'), 'only forum');

  chat_msg := public.send_message(ch, 'un message de chat');
  perform testkit.must_fail('reply across channels', format('select public.send_message(%L, %L, %L)', forum, 'mauvais canal', chat_msg), 'not in this channel');
  -- a reply inside a chat channel is allowed
  perform public.send_message(ch, 'je reponds', chat_msg);
  reset role;
  raise notice 'OK 6: forum threads need a title, replies stay one level deep, replies cannot cross channels';
end $$;

-- ---- 7. Editing and deleting ----------------------------------------------------------
do $$
declare ch uuid; m bigint; mine bigint;
begin
  select id into ch from public.channels where slug = 'general' and community_id = (select id from public.communities where slug = 'dev-dakar');
  select id into m from public.messages where body = 'Salut tout le monde';

  perform testkit.as_user('2');
  perform public.edit_message(m, 'Salut la team');
  mine := m;
  reset role;
  if (select body from public.messages where id = m) <> 'Salut la team' or (select edited_at from public.messages where id = m) is null then
    raise exception 'FAIL: edit did not save or edited_at is missing';
  end if;

  -- another plain member cannot edit or delete it; the owner cannot edit it either
  perform testkit.as_user('4');
  perform public.join_community((select id from public.communities where slug = 'dev-dakar'));
  perform testkit.must_fail('editing someone else''s message', format('select public.edit_message(%L, %L)', m, 'hack'), 'your own');
  perform testkit.must_fail('plain member deleting someone else''s message', format('select public.delete_message(%L)', m), 'your own');
  reset role;
  perform testkit.as_user('1');
  perform testkit.must_fail('owner editing someone else''s message', format('select public.edit_message(%L, %L)', m, 'hack'), 'your own');
  -- but the owner can delete (moderation)
  perform public.delete_message(m);
  reset role;
  if (select deleted_at from public.messages where id = m) is null or (select body from public.messages where id = m) <> '' then
    raise exception 'FAIL: moderator deletion did not wipe the message';
  end if;

  perform testkit.as_user('2');
  perform testkit.must_fail('editing a deleted message', format('select public.edit_message(%L, %L)', m, 'zombie'), 'not found');
  -- authors delete their own
  perform public.delete_message((select id from public.messages where body = 'un message de chat'));
  reset role;
  if (select deleted_at from public.messages where body = '' and parent_id is null and author_id = 'cccccccc-0000-0000-0000-000000000002' and id <> m limit 1) is null then
    raise exception 'FAIL: author could not delete their own message';
  end if;
  raise notice 'OK 7: authors edit and delete their own messages; moderators can delete any; nobody edits others';
end $$;

-- ---- 8. Roles and removing people --------------------------------------------------------
do $$
declare c uuid; mod_id uuid := 'cccccccc-0000-0000-0000-000000000004'; ch uuid;
begin
  select id into c from public.communities where slug = 'dev-dakar';

  -- a plain member cannot promote themselves or anyone
  perform testkit.as_user('2');
  perform testkit.must_fail('member promotes themselves', format('select public.set_member_role(%L, %L, %L)', c, 'cccccccc-0000-0000-0000-000000000002', 'moderator'), 'only the owner');
  reset role;

  perform testkit.as_user('1');
  perform public.set_member_role(c, mod_id, 'moderator');
  perform testkit.must_fail('naming a second owner', format('select public.set_member_role(%L, %L, %L)', c, mod_id, 'owner'), 'moderator or member');
  perform testkit.must_fail('changing the owner role', format('select public.set_member_role(%L, %L, %L)', c, 'cccccccc-0000-0000-0000-000000000001', 'member'), 'cannot be changed');
  reset role;

  -- the moderator can create channels and invites, and remove plain members
  perform testkit.as_user('4');
  ch := public.create_channel(c, 'entraide', 'Entraide', 'chat');
  perform public.create_invite(c);
  perform testkit.must_fail('moderator promotes someone', format('select public.set_member_role(%L, %L, %L)', c, 'cccccccc-0000-0000-0000-000000000002', 'moderator'), 'only the owner');
  perform testkit.must_fail('moderator removes the owner', format('select public.remove_member(%L, %L)', c, 'cccccccc-0000-0000-0000-000000000001'), 'owner cannot be removed');
  reset role;

  -- a second moderator, to check moderators cannot remove each other
  perform testkit.as_user('5');
  perform public.join_community(c);
  reset role;
  perform testkit.as_user('1');
  perform public.set_member_role(c, 'cccccccc-0000-0000-0000-000000000005', 'moderator');
  reset role;
  perform testkit.as_user('4');
  perform testkit.must_fail('moderator removes a moderator', format('select public.remove_member(%L, %L)', c, 'cccccccc-0000-0000-0000-000000000005'), 'another moderator');
  perform public.remove_member(c, 'cccccccc-0000-0000-0000-000000000002');
  reset role;

  if exists (select 1 from public.community_members where community_id = c and user_id = 'cccccccc-0000-0000-0000-000000000002') then
    raise exception 'FAIL: removed member is still in';
  end if;

  -- a removed member can no longer read
  perform testkit.as_user('2');
  if (select count(*) from public.messages where community_id = c) <> 0 then
    raise exception 'FAIL: a removed member can still read messages';
  end if;
  reset role;
  raise notice 'OK 8: only the owner sets roles; moderators moderate but cannot touch owner or each other; removal closes access';
end $$;

-- ---- 9. Leaving -----------------------------------------------------------------------------
do $$
declare c uuid;
begin
  select id into c from public.communities where slug = 'dev-dakar';

  perform testkit.as_user('1');
  perform testkit.must_fail('owner leaving', format('select public.leave_community(%L)', c), 'owner cannot leave');
  reset role;

  perform testkit.as_user('4');
  perform public.leave_community(c);
  perform testkit.must_fail('leaving twice', format('select public.leave_community(%L)', c), 'not in this community');
  reset role;
  raise notice 'OK 9: members can leave, the owner cannot';
end $$;

-- ---- 10. Nobody writes to the tables directly ---------------------------------------------------
do $$
declare c uuid; ch uuid;
begin
  select id into c from public.communities where slug = 'dev-dakar';
  select id into ch from public.channels where slug = 'general' and community_id = c;

  perform testkit.as_user('1'); -- even the owner
  perform testkit.must_fail('direct message insert', format('insert into public.messages (channel_id, community_id, author_id, body) values (%L, %L, auth.uid(), %L)', ch, c, 'x'), 'permission denied');
  perform testkit.must_fail('direct member insert', format('insert into public.community_members (community_id, user_id, role) values (%L, %L, %L)', c, 'cccccccc-0000-0000-0000-000000000003', 'owner'), 'permission denied');
  perform testkit.must_fail('direct role update', format('update public.community_members set role = %L', 'owner'), 'permission denied');
  perform testkit.must_fail('direct community update', $q$update public.communities set is_private = true$q$, 'permission denied');
  perform testkit.must_fail('direct message delete', 'delete from public.messages', 'permission denied');
  perform testkit.must_fail('direct channel insert', format('insert into public.channels (community_id, slug, name) values (%L, %L, %L)', c, 'sneaky', 'Sneaky'), 'permission denied');
  perform testkit.must_fail('reading invites', 'select * from public.community_invites', 'permission denied');
  reset role;
  raise notice 'OK 10: tables are read-only for members, invites cannot be read at all';
end $$;

-- ---- 11. Spam limit ------------------------------------------------------------------------------------
do $$
declare ch uuid; i int;
begin
  select id into ch from public.channels where slug = 'general' and community_id = (select id from public.communities where slug = 'dev-dakar');

  perform testkit.as_user('5');
  for i in 1..20 loop
    perform public.send_message(ch, 'spam ' || i);
  end loop;
  perform testkit.must_fail('21st message in a minute', format('select public.send_message(%L, %L)', ch, 'spam 21'), 'slow down');
  reset role;

  -- the limit is per person: someone else is not blocked
  perform testkit.as_user('1');
  perform public.send_message(ch, 'moi je peux encore ecrire');
  reset role;
  raise notice 'OK 11: 20 messages a minute per member, then a pause; others are unaffected';
end $$;

-- ---- 12. Limits on communities and channels ----------------------------------------------------------------
do $$
declare c uuid; i int;
begin
  perform testkit.as_user('6');
  perform public.create_community('fatou-un', 'Fatou un', null, false);
  perform public.create_community('fatou-deux', 'Fatou deux', null, false);
  c := public.create_community('fatou-trois', 'Fatou trois', null, false);
  perform testkit.must_fail('fourth community', $q$select public.create_community('fatou-quatre', 'Fatou quatre', null, false)$q$, 'limit');

  -- 2 default channels + 28 more = 30, the 31st is refused
  for i in 1..28 loop
    perform public.create_channel(c, 'canal-' || i, 'Canal ' || i, 'chat');
  end loop;
  perform testkit.must_fail('31st channel', format('select public.create_channel(%L, %L, %L, %L)', c, 'de-trop', 'De trop', 'chat'), 'channel limit');
  reset role;
  raise notice 'OK 12: 3 communities per member and 30 channels per community';
end $$;

-- ---- 13. Live updates are switched on -------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    raise exception 'FAIL: messages is not in the realtime publication';
  end if;
  raise notice 'OK 13: new messages are sent out live';
end $$;

select 'ALL CHAT TESTS PASSED' as result;
