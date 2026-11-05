-- Tests for migration 7 (ask to join private communities).
-- Run AFTER migrations 1 to 7. psql -v ON_ERROR_STOP=1 -f ask_to_join.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
--
-- People in this test:
--   ama     (...0001)  owner of "ouvert" (public), "ferme" (private, listed), "cache" (private, hidden)
--   binta   (...0002)  owner of "ferme-b1" and "ferme-b2" (private, listed)
--   cheikh  (...0003)  an outsider who asks to join
--   demba   (...0004)  another outsider
--   eliane  (...0005)  a plain member of "ferme", and a moderator later
--   fatou   (...0006)  a plain member of "ferme"

create schema ajkit;
grant usage on schema ajkit to public;

create function ajkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('0a0a0a0a-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function ajkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', ajkit.uid(p_n)::text, true);
end $$;

create function ajkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function ajkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function ajkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := ajkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function ajkit.comm(p_slug text) returns uuid
language sql stable security definer as $$
  select id from public.communities where slug = p_slug
$$;

-- The pending request of one person for one community (looked up as the database owner).
create function ajkit.req(p_slug text, p_n int) returns uuid
language sql stable security definer as $$
  select id from public.join_requests
   where community_id = ajkit.comm(p_slug) and user_id = ajkit.uid(p_n)
   order by created_at desc limit 1
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (ajkit.uid(1), 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  (ajkit.uid(2), 'binta@exemple.sn', '{"provider":"email"}', '{}'),
  (ajkit.uid(3), 'cheikh@exemple.sn', '{"provider":"email"}', '{}'),
  (ajkit.uid(4), 'demba@exemple.sn', '{"provider":"email"}', '{}'),
  (ajkit.uid(5), 'eliane@exemple.sn', '{"provider":"email"}', '{}'),
  (ajkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Listed and hidden communities ---------------------------------------------
do $$
begin
  perform ajkit.as_user(1);
  perform public.create_community('ouvert', 'Ouvert', 'Pour tous', false);
  perform public.create_community('ferme', 'Ferme', 'Sur demande', true); -- listed by default
  perform public.create_community('cache', 'Cache', 'Sur invitation', true, false);
  reset role;
  perform ajkit.as_user(2);
  perform public.create_community('ferme-b1', 'Ferme B1', null, true);
  perform public.create_community('ferme-b2', 'Ferme B2', null, true);
  reset role;

  if not (select is_listed from public.communities where slug = 'ferme') then raise exception 'FAIL: a new private community should be listed by default'; end if;
  if (select is_listed from public.communities where slug = 'cache') then raise exception 'FAIL: hidden community came out listed'; end if;
  raise notice 'OK 1: private communities are listed by default and can be hidden';
end $$;

do $$
declare n int;
begin
  perform ajkit.as_user(3);
  if not exists (select 1 from public.communities where slug = 'ferme') then raise exception 'FAIL: a listed private community is not visible'; end if;
  if exists (select 1 from public.communities where slug = 'cache') then raise exception 'FAIL: a hidden community is visible to an outsider'; end if;
  -- but what is inside stays private
  select count(*) into n from public.channels where community_id = ajkit.comm('ferme');
  if n <> 0 then raise exception 'FAIL: outsider sees % channels of a listed private community', n; end if;
  select count(*) into n from public.community_members where community_id = ajkit.comm('ferme');
  if n <> 0 then raise exception 'FAIL: outsider sees members of a listed private community'; end if;
  select count(*) into n from public.messages where community_id = ajkit.comm('ferme');
  if n <> 0 then raise exception 'FAIL: outsider sees messages of a listed private community'; end if;
  reset role;

  perform ajkit.as_anon();
  if not exists (select 1 from public.communities where slug = 'ferme') then raise exception 'FAIL: a visitor cannot see a listed community'; end if;
  if exists (select 1 from public.communities where slug = 'cache') then raise exception 'FAIL: a visitor sees a hidden community'; end if;
  reset role;

  -- member counts
  perform ajkit.as_user(3);
  if public.community_member_count(ajkit.comm('ferme')) <> 1 then raise exception 'FAIL: listed community count should be 1'; end if;
  if public.community_member_count(ajkit.comm('cache')) is not null then raise exception 'FAIL: the size of a hidden community leaked'; end if;
  reset role;
  perform ajkit.as_user(1);
  if public.community_member_count(ajkit.comm('cache')) <> 1 then raise exception 'FAIL: a member cannot see their own hidden community size'; end if;
  reset role;
  raise notice 'OK 2: outsiders see listed communities (not their insides) and never hidden ones';
end $$;

-- ---- 2. Asking to join ------------------------------------------------------------------
do $$
begin
  perform ajkit.as_user(3);
  perform ajkit.must_fail('asking to join a public community', format('select public.request_to_join(%L)', ajkit.comm('ouvert')), 'public');
  perform ajkit.must_fail('asking to join a hidden community', format('select public.request_to_join(%L)', ajkit.comm('cache')), 'not found');
  perform ajkit.must_fail('asking to join a community that does not exist', $q$select public.request_to_join('99999999-9999-9999-9999-999999999999')$q$, 'not found');
  perform ajkit.must_fail('message of 301 characters', format('select public.request_to_join(%L, %L)', ajkit.comm('ferme'), repeat('x', 301)), 'too long');
  perform public.request_to_join(ajkit.comm('ferme'), 'Je suis dev a Thies');
  perform ajkit.must_fail('asking twice', format('select public.request_to_join(%L)', ajkit.comm('ferme')), 'already asked');
  reset role;

  perform ajkit.as_user(1);
  perform ajkit.must_fail('a member asking to join their own community', format('select public.request_to_join(%L)', ajkit.comm('ferme')), 'already a member');
  reset role;

  perform ajkit.as_anon();
  perform ajkit.must_fail('visitor asking to join', format('select public.request_to_join(%L)', ajkit.comm('ferme')), 'permission denied');
  reset role;
  raise notice 'OK 3: you can ask to join a listed private community once; other cases are refused';
end $$;

-- ---- 3. Who sees the request --------------------------------------------------------------
do $$
declare n int;
begin
  perform ajkit.as_user(3);
  select count(*) into n from public.join_requests;
  if n <> 1 then raise exception 'FAIL: the requester should see their request, saw %', n; end if;
  reset role;

  perform ajkit.as_user(4);
  select count(*) into n from public.join_requests;
  if n <> 0 then raise exception 'FAIL: another outsider sees % requests', n; end if;
  reset role;

  perform ajkit.as_user(2);
  select count(*) into n from public.join_requests;
  if n <> 0 then raise exception 'FAIL: the owner of another community sees % requests', n; end if;
  reset role;

  perform ajkit.as_user(1);
  select count(*) into n from public.join_requests where community_id = ajkit.comm('ferme');
  if n <> 1 then raise exception 'FAIL: the owner should see the request, saw %', n; end if;
  if (select message from public.join_requests limit 1) <> 'Je suis dev a Thies' then raise exception 'FAIL: the message was lost'; end if;
  reset role;

  perform ajkit.as_anon();
  perform ajkit.must_fail('visitor reads requests', 'select count(*) from public.join_requests', 'permission denied');
  reset role;
  raise notice 'OK 4: a request is visible only to the requester and to the community''s owner and moderators';
end $$;

-- ---- 4. Deciding ------------------------------------------------------------------------------
do $$
begin
  -- two plain members and a future moderator
  perform ajkit.as_user(5);
  perform public.request_to_join(ajkit.comm('ferme'));
  reset role;
  perform ajkit.as_user(6);
  perform public.request_to_join(ajkit.comm('ferme'));
  reset role;
  perform ajkit.as_user(1);
  perform public.decide_join_request(ajkit.req('ferme', 5), true);
  perform public.decide_join_request(ajkit.req('ferme', 6), true);
  perform public.set_member_role(ajkit.comm('ferme'), ajkit.uid(5), 'moderator');
  reset role;

  -- a plain member and an outsider cannot answer
  perform ajkit.as_user(6);
  perform ajkit.must_fail('plain member answers a request', format('select public.decide_join_request(%L, true)', ajkit.req('ferme', 3)), 'owner or a moderator');
  reset role;
  perform ajkit.as_user(4);
  perform ajkit.must_fail('outsider answers a request', format('select public.decide_join_request(%L, true)', ajkit.req('ferme', 3)), 'owner or a moderator');
  reset role;
  perform ajkit.as_user(3);
  perform ajkit.must_fail('requester approves themselves', format('select public.decide_join_request(%L, true)', ajkit.req('ferme', 3)), 'owner or a moderator');
  reset role;

  -- a plain member sees no requests; a moderator does
  perform ajkit.as_user(6);
  if (select count(*) from public.join_requests where community_id = ajkit.comm('ferme') and user_id <> ajkit.uid(6)) <> 0 then raise exception 'FAIL: a plain member sees other people''s requests'; end if;
  reset role;
  perform ajkit.as_user(5);
  if (select count(*) from public.join_requests where community_id = ajkit.comm('ferme') and status = 'pending') <> 1 then raise exception 'FAIL: a moderator should see the pending request'; end if;
  reset role;
  raise notice 'OK 5a: only the owner or a moderator can see and answer requests';
end $$;

do $$
begin
  -- the moderator approves cheikh
  perform ajkit.as_user(5);
  perform public.decide_join_request(ajkit.req('ferme', 3), true);
  perform ajkit.must_fail('answering twice', format('select public.decide_join_request(%L, false)', ajkit.req('ferme', 3)), 'already been answered');
  reset role;

  if (select role from public.community_members where community_id = ajkit.comm('ferme') and user_id = ajkit.uid(3)) <> 'member' then
    raise exception 'FAIL: an approved person should be a plain member';
  end if;
  if (select status from public.join_requests where id = ajkit.req('ferme', 3)) <> 'approved' then raise exception 'FAIL: status is not approved'; end if;
  if (select decided_by from public.join_requests where id = ajkit.req('ferme', 3)) <> ajkit.uid(5) then raise exception 'FAIL: decided_by is wrong'; end if;

  -- now cheikh can read inside
  perform ajkit.as_user(3);
  if (select count(*) from public.channels where community_id = ajkit.comm('ferme')) <> 2 then raise exception 'FAIL: an approved member cannot see the channels'; end if;
  reset role;
  perform ajkit.as_user(4);
  if public.community_member_count(ajkit.comm('ferme')) <> 4 then raise exception 'FAIL: member count should be 4 (ama, eliane, fatou, cheikh)'; end if;
  reset role;
  raise notice 'OK 5b: an approved request makes a plain member who can read inside';
end $$;

-- ---- 5. Declining, waiting period -----------------------------------------------------------------
do $$
begin
  perform ajkit.as_user(4);
  perform public.request_to_join(ajkit.comm('ferme'));
  reset role;
  perform ajkit.as_user(1);
  perform public.decide_join_request(ajkit.req('ferme', 4), false);
  reset role;
  if (select status from public.join_requests where id = ajkit.req('ferme', 4)) <> 'declined' then raise exception 'FAIL: status is not declined'; end if;
  if exists (select 1 from public.community_members where community_id = ajkit.comm('ferme') and user_id = ajkit.uid(4)) then
    raise exception 'FAIL: a declined person got in';
  end if;

  perform ajkit.as_user(4);
  perform ajkit.must_fail('asking again right after a decline', format('select public.request_to_join(%L)', ajkit.comm('ferme')), 'wait');
  reset role;
end $$;

-- pretend the decline happened 8 days ago
update public.join_requests set decided_at = now() - interval '8 days'
 where status = 'declined' and user_id = '0a0a0a0a-0000-0000-0000-000000000004';

do $$
begin
  perform ajkit.as_user(4);
  perform public.request_to_join(ajkit.comm('ferme'), 'Je reviens');
  reset role;
  raise notice 'OK 6: after a decline you must wait 7 days, then you can ask again';
end $$;

-- ---- 6. Cancelling ------------------------------------------------------------------------------------
do $$
begin
  perform ajkit.as_user(3);
  perform ajkit.must_fail('cancelling someone else''s request', format('select public.cancel_join_request(%L)', ajkit.req('ferme', 4)), 'not found');
  reset role;
  perform ajkit.as_user(4);
  perform public.cancel_join_request(ajkit.req('ferme', 4));
  perform ajkit.must_fail('cancelling twice', format('select public.cancel_join_request(%L)', ajkit.req('ferme', 4)), 'not found');
  reset role;
  perform ajkit.as_user(1);
  perform ajkit.must_fail('answering a cancelled request', format('select public.decide_join_request(%L, true)', ajkit.req('ferme', 4)), 'already been answered');
  reset role;
  raise notice 'OK 7: you can cancel only your own pending request';
end $$;

-- ---- 7. Limit on pending requests -----------------------------------------------------------------------
update public.game_config set value = '2' where key = 'join_requests_max_pending';

do $$
begin
  perform ajkit.as_user(4);
  perform public.request_to_join(ajkit.comm('ferme'));
  perform public.request_to_join(ajkit.comm('ferme-b1'));
  perform ajkit.must_fail('third pending request', format('select public.request_to_join(%L)', ajkit.comm('ferme-b2')), 'too many');
  reset role;
  raise notice 'OK 8: the number of pending requests per person is limited';
end $$;

update public.game_config set value = '10' where key = 'join_requests_max_pending';

-- ---- 8. Nobody writes the table directly; listing is the owner's choice --------------------------------
do $$
begin
  perform ajkit.as_user(4);
  perform ajkit.must_fail('direct insert', format('insert into public.join_requests (community_id, user_id) values (%L, %L)', ajkit.comm('ferme-b2'), ajkit.uid(4)), 'permission denied');
  perform ajkit.must_fail('direct approval', $q$update public.join_requests set status = 'approved'$q$, 'permission denied');
  perform ajkit.must_fail('direct membership', format('insert into public.community_members (community_id, user_id, role) values (%L, %L, %L)', ajkit.comm('ferme-b2'), ajkit.uid(4), 'owner'), 'permission denied');
  perform ajkit.must_fail('changing the listing of a community you do not own', format('select public.set_community_listing(%L, false)', ajkit.comm('ferme')), 'Only the owner');
  reset role;

  perform ajkit.as_user(5);
  perform ajkit.must_fail('a moderator changes the listing', format('select public.set_community_listing(%L, false)', ajkit.comm('ferme')), 'Only the owner');
  reset role;

  -- the owner hides the community: outsiders lose sight of it and can no longer ask
  perform ajkit.as_user(1);
  perform public.set_community_listing(ajkit.comm('ferme'), false);
  reset role;
  perform ajkit.as_user(4);
  if exists (select 1 from public.communities where slug = 'ferme') then raise exception 'FAIL: a hidden community is still visible'; end if;
  perform ajkit.must_fail('asking to join a community that was just hidden', format('select public.request_to_join(%L)', ajkit.comm('ferme')), 'not found');
  reset role;
  raise notice 'OK 9: tables are read-only; only the owner lists or hides a community';
end $$;

select 'ALL ASK-TO-JOIN TESTS PASSED' as result;
