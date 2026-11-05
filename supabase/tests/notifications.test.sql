-- Tests for the notifications migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f notifications.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ona (...1) owns a project and a community; paul (...2) and rama (...3)
-- are other members; ama (...4) is an admin; sidy (...5) owns a project and mutes stars.

create schema nfkit;
grant usage on schema nfkit to public;

create function nfkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('d9d9d9d9-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function nfkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', nfkit.uid(p_n)::text, true);
end $$;

create function nfkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function nfkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function nfkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function nfkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := nfkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- How many notices of one kind a member has (looked up as the database owner).
create function nfkit.n(p_user int, p_kind text) returns int
language sql stable security definer as $$
  select count(*)::int from public.notifications where user_id = nfkit.uid(p_user) and kind = p_kind
$$;

create function nfkit.total(p_user int) returns int
language sql stable security definer as $$
  select count(*)::int from public.notifications where user_id = nfkit.uid(p_user)
$$;

create function nfkit.proj(p_repo text) returns uuid
language sql stable security definer as $$ select id from public.projects where github_repo = p_repo $$;

create function nfkit.community() returns uuid
language sql stable security definer as $$ select id from public.communities where slug = 'nf-cercle' $$;

create function nfkit.join_req(p_user int) returns uuid
language sql stable security definer as $$
  select id from public.join_requests where user_id = nfkit.uid(p_user) and status = 'pending' and community_id = nfkit.community()
$$;

create function nfkit.collab_req(p_user int) returns uuid
language sql stable security definer as $$
  select id from public.collab_requests where requester_id = nfkit.uid(p_user) and status = 'pending' and project_id = nfkit.proj('nf-ona')
$$;

create function nfkit.rep(p_reporter int, p_type text, p_target text) returns uuid
language sql stable security definer as $$
  select id from public.reports where reporter_id = nfkit.uid(p_reporter) and target_type = p_type and target_id = p_target and status = 'open'
$$;

create function nfkit.last_data(p_user int, p_kind text) returns jsonb
language sql stable security definer as $$
  select data from public.notifications where user_id = nfkit.uid(p_user) and kind = p_kind order by id desc limit 1
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (nfkit.uid(1), 'ona@exemple.sn', '{"provider":"email"}', '{}'),
  (nfkit.uid(2), 'paul@exemple.sn', '{"provider":"email"}', '{}'),
  (nfkit.uid(3), 'rama@exemple.sn', '{"provider":"email"}', '{}'),
  (nfkit.uid(4), 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  (nfkit.uid(5), 'sidy@exemple.sn', '{"provider":"email"}', '{}');

insert into public.projects (owner_id, github_owner, github_repo, title, verified_at) values
  (nfkit.uid(1), 'ona-dev', 'nf-ona', 'Projet Ona', now()),
  (nfkit.uid(5), 'sidy-dev', 'nf-sidy', 'Projet Sidy', now());

do $$
begin
  perform nfkit.as_server();
  perform public.make_admin(nfkit.uid(4));
  reset role;
  perform nfkit.as_user(1);
  update public.profiles set available_to_collab = true where id = nfkit.uid(1);
  perform public.create_community('nf-cercle', 'Cercle', null, true, true);
  reset role;
end $$;

-- Setting up created nothing.
do $$
begin
  if (select count(*) from public.notifications where user_id::text like 'd9d9d9d9-%') <> 0 then
    raise exception 'FAIL: setting up should not create notices (found %)', (select count(*) from public.notifications where user_id::text like 'd9d9d9d9-%');
  end if;
  raise notice 'OK 0: nothing is created by setting things up';
end $$;

-- ---- 1. Stars ----------------------------------------------------------------------------------------------------
do $$
declare p uuid := nfkit.proj('nf-ona');
begin
  perform nfkit.as_user(2);
  perform public.star_project(p);
  perform public.unstar_project(p);
  perform public.star_project(p); -- star, unstar, star: one notice
  reset role;
  if nfkit.n(1, 'project_starred') <> 1 then raise exception 'FAIL: the owner should have exactly 1 star notice, got %', nfkit.n(1, 'project_starred'); end if;
  if nfkit.last_data(1, 'project_starred') ->> 'actor_username' <> (select username from public.profiles where id = nfkit.uid(2)) then raise exception 'FAIL: the notice does not name who starred'; end if;
  if nfkit.last_data(1, 'project_starred') ->> 'project_title' <> 'Projet Ona' then raise exception 'FAIL: the notice does not name the project'; end if;
  if nfkit.total(2) <> 0 then raise exception 'FAIL: the person who starred got a notice'; end if;

  perform nfkit.as_user(3);
  perform public.star_project(p);
  reset role;
  if nfkit.n(1, 'project_starred') <> 2 then raise exception 'FAIL: a second person starring should add a notice'; end if;
  raise notice 'OK 1: a star notifies the owner once per person, even after unstar and star again';
end $$;

-- ---- 2. Comments -------------------------------------------------------------------------------------------------
do $$
declare p uuid := nfkit.proj('nf-ona');
begin
  perform nfkit.as_user(2);
  perform public.post_project_comment(p, 'Bravo pour ce projet');
  reset role;
  if nfkit.n(1, 'project_comment') <> 1 then raise exception 'FAIL: the owner should be told about a comment'; end if;
  if nfkit.last_data(1, 'project_comment') ->> 'excerpt' <> 'Bravo pour ce projet' then raise exception 'FAIL: the notice has no excerpt'; end if;

  perform nfkit.as_user(1);
  perform public.post_project_comment(p, 'Merci a tous');
  reset role;
  if nfkit.n(1, 'project_comment') <> 1 then raise exception 'FAIL: the owner was told about their own comment'; end if;
  raise notice 'OK 2: a comment notifies the owner, but not when the owner writes it';
end $$;

-- ---- 3. Ask to collaborate ------------------------------------------------------------------------------------------
do $$
declare p uuid := nfkit.proj('nf-ona');
begin
  perform nfkit.as_user(2);
  perform public.request_collaboration(p, 'Je peux aider');
  reset role;
  if nfkit.n(1, 'collab_request') <> 1 then raise exception 'FAIL: the owner should be told about a request'; end if;

  perform nfkit.as_user(1);
  perform public.decide_collab_request(nfkit.collab_req(2), true);
  reset role;
  if nfkit.n(2, 'collab_accepted') <> 1 then raise exception 'FAIL: the requester should hear the request was accepted'; end if;

  perform nfkit.as_user(3);
  perform public.request_collaboration(p, 'Moi aussi');
  reset role;
  perform nfkit.as_user(1);
  perform public.decide_collab_request(nfkit.collab_req(3), false);
  reset role;
  if nfkit.n(3, 'collab_declined') <> 1 then raise exception 'FAIL: the requester should hear the request was declined'; end if;

  -- withdrawing tells nobody
  update public.game_config set value = '0' where key = 'collab_cooldown_days';
  perform nfkit.as_user(3);
  perform public.request_collaboration(p, 'Je reessaie');
  perform public.withdraw_collab_request(nfkit.collab_req(3));
  reset role;
  if nfkit.n(1, 'collab_request') <> 3 then raise exception 'FAIL: expected 3 request notices for the owner (paul, rama, rama again), got %', nfkit.n(1, 'collab_request'); end if;
  if nfkit.n(3, 'collab_declined') <> 1 or nfkit.n(3, 'collab_accepted') <> 0 then raise exception 'FAIL: withdrawing created an answer notice'; end if;
  update public.game_config set value = '7' where key = 'collab_cooldown_days';
  raise notice 'OK 3: requests and answers are notified; withdrawing is silent';
end $$;

-- ---- 4. Ask to join -------------------------------------------------------------------------------------------------
do $$
begin
  perform nfkit.as_user(2);
  perform public.request_to_join(nfkit.community(), 'Bonjour');
  reset role;
  if nfkit.n(1, 'join_request') <> 1 then raise exception 'FAIL: the community owner should be told about a join request'; end if;
  if nfkit.n(2, 'join_request') <> 0 then raise exception 'FAIL: the person asking was told about their own request'; end if;

  perform nfkit.as_user(1);
  perform public.decide_join_request(nfkit.join_req(2), true);
  reset role;
  if nfkit.n(2, 'join_approved') <> 1 then raise exception 'FAIL: approval should be notified'; end if;

  perform nfkit.as_user(3);
  perform public.request_to_join(nfkit.community(), 'Moi aussi');
  reset role;
  perform nfkit.as_user(1);
  perform public.decide_join_request(nfkit.join_req(3), false);
  reset role;
  if nfkit.n(3, 'join_declined') <> 1 then raise exception 'FAIL: refusal should be notified'; end if;
  raise notice 'OK 4: join requests notify the owner; answers notify the member';
end $$;

-- ---- 5. Project confirmed and hidden ----------------------------------------------------------------------------------
do $$
declare r uuid; p uuid;
begin
  insert into public.projects (owner_id, github_owner, github_repo, title) values (nfkit.uid(2), 'paul-dev', 'nf-paul', 'Projet Paul');
  if nfkit.n(2, 'project_confirmed') <> 0 then raise exception 'FAIL: a pending project should not notify'; end if;
  p := nfkit.proj('nf-paul');
  update public.projects set verified_at = now() where id = p;
  update public.projects set github_stars = 3 where id = p;
  if nfkit.n(2, 'project_confirmed') <> 1 then raise exception 'FAIL: confirming should notify the owner once'; end if;

  perform nfkit.as_user(3);
  r := public.report_content('project', p::text, 'scam');
  reset role;
  perform nfkit.as_user(4);
  perform public.resolve_report(r, 'remove_content');
  reset role;
  if nfkit.n(2, 'project_hidden') <> 1 then raise exception 'FAIL: the owner should be told the project was hidden'; end if;
  raise notice 'OK 5: confirmation and hiding are notified once each';
end $$;

-- ---- 6. Warnings and suspensions --------------------------------------------------------------------------------------
do $$
declare r uuid;
begin
  perform nfkit.as_user(3);
  r := public.report_content('member', nfkit.uid(2)::text, 'harassment');
  reset role;
  perform nfkit.as_user(4);
  perform public.resolve_report(r, 'warn_member', 'Premier avertissement');
  reset role;
  if nfkit.n(2, 'warning') <> 1 then raise exception 'FAIL: the member should be told about the warning'; end if;
  if nfkit.last_data(2, 'warning') ->> 'note' <> 'Premier avertissement' then raise exception 'FAIL: the warning notice has no note'; end if;

  perform nfkit.as_user(3);
  r := public.report_content('member', nfkit.uid(2)::text, 'harassment', 'Encore');
  reset role;
  perform nfkit.as_user(4);
  perform public.resolve_report(r, 'suspend_member', 'Trois jours', 3);
  reset role;
  if nfkit.n(2, 'suspension') <> 1 then raise exception 'FAIL: the member should be told about the suspension'; end if;
  if (nfkit.last_data(2, 'suspension') ->> 'until')::timestamptz < now() + interval '2 days' then raise exception 'FAIL: the suspension notice has the wrong end date'; end if;
  if nfkit.n(3, 'warning') + nfkit.n(3, 'suspension') + nfkit.n(3, 'project_hidden') <> 0 then raise exception 'FAIL: the reporter was told about the outcome'; end if;
  raise notice 'OK 6: warnings and suspensions notify the member; the reporter is told nothing';
end $$;

-- ---- 7. Badges ----------------------------------------------------------------------------------------------------------
do $$
begin
  insert into public.user_badges (user_id, badge_slug, progress, unlocked_at) values (nfkit.uid(3), 'maitre_griot', 40, null)
  on conflict (user_id, badge_slug) do update set progress = 40;
  if nfkit.n(3, 'badge_unlocked') <> 0 then raise exception 'FAIL: progress alone should not notify'; end if;
  update public.user_badges set progress = 100, unlocked_at = now() where user_id = nfkit.uid(3) and badge_slug = 'maitre_griot';
  update public.user_badges set progress = 120, unlocked_at = now() where user_id = nfkit.uid(3) and badge_slug = 'maitre_griot';
  if nfkit.n(3, 'badge_unlocked') <> 1 then raise exception 'FAIL: unlocking should notify exactly once, got %', nfkit.n(3, 'badge_unlocked'); end if;
  if nfkit.last_data(3, 'badge_unlocked') ->> 'badge_name' is null then raise exception 'FAIL: the badge notice has no name'; end if;
  raise notice 'OK 7: a badge notifies when it unlocks, once';
end $$;

-- ---- 8. Privacy and no faking --------------------------------------------------------------------------------------------
do $$
declare n_own int;
begin
  perform nfkit.as_user(1);
  select count(*) into n_own from public.notifications;
  if n_own <> nfkit.total(1) then raise exception 'FAIL: ona should see her % notices, saw %', nfkit.total(1), n_own; end if;
  if exists (select 1 from public.notifications where user_id <> nfkit.uid(1)) then raise exception 'FAIL: a member sees someone else''s notices'; end if;
  perform nfkit.must_fail('creating a notice', format('insert into public.notifications (user_id, kind) values (%L, %L)', nfkit.uid(1), 'warning'), 'permission denied');
  perform nfkit.must_fail('editing a notice', $q$update public.notifications set read_at = null$q$, 'permission denied');
  perform nfkit.must_fail('deleting a notice', 'delete from public.notifications', 'permission denied');
  perform nfkit.must_fail('calling notify directly', format('select public.notify(%L, %L)', nfkit.uid(1), 'warning'), 'permission denied');
  perform nfkit.must_fail('editing the mutes directly', format('insert into public.notification_mutes (user_id, kind) values (%L, %L)', nfkit.uid(1), 'project_starred'), 'permission denied');
  reset role;

  perform nfkit.as_anon();
  perform nfkit.must_fail('a visitor reads notices', 'select count(*) from public.notifications', 'permission denied');
  perform nfkit.must_fail('a visitor counts unread', 'select public.unread_notification_count()', 'permission denied');
  reset role;
  raise notice 'OK 8: notices are private, and nobody can create, edit or delete them directly';
end $$;

-- ---- 9. Reading --------------------------------------------------------------------------------------------------------------
do $$
declare total int := nfkit.total(1); first_id bigint; mine int;
begin
  perform nfkit.as_user(1);
  if public.unread_notification_count() <> total then raise exception 'FAIL: all % notices should be unread, count says %', total, public.unread_notification_count(); end if;
  select id into first_id from public.notifications order by id limit 1;
  perform public.mark_notification_read(first_id);
  perform public.mark_notification_read(first_id); -- harmless
  if public.unread_notification_count() <> total - 1 then raise exception 'FAIL: one notice should now be read'; end if;
  reset role;

  perform nfkit.as_user(2);
  perform nfkit.must_fail('marking someone else''s notice', format('select public.mark_notification_read(%L)', first_id), 'not found');
  reset role;
  if (select read_at from public.notifications where id = first_id) is null then raise exception 'FAIL: the notice should stay read'; end if;

  perform nfkit.as_user(1);
  mine := public.mark_all_notifications_read();
  if mine <> total - 1 then raise exception 'FAIL: mark all should change % notices, changed %', total - 1, mine; end if;
  if public.mark_all_notifications_read() <> 0 then raise exception 'FAIL: a second mark all should change nothing'; end if;
  if public.unread_notification_count() <> 0 then raise exception 'FAIL: nothing should be unread'; end if;
  reset role;

  perform nfkit.as_user(3); -- ona's reading did not touch rama's
  if public.unread_notification_count() <> nfkit.total(3) then raise exception 'FAIL: reading changed someone else''s unread count'; end if;
  reset role;
  raise notice 'OK 9: mark one, mark all and the unread count only affect your own notices';
end $$;

-- ---- 10. Muting ------------------------------------------------------------------------------------------------------------
do $$
declare p uuid := nfkit.proj('nf-sidy');
begin
  perform nfkit.as_user(5);
  perform nfkit.must_fail('muting an unknown kind', format('select public.set_notification_mute(%L, true)', 'sunshine'), 'Unknown kind');
  perform nfkit.must_fail('muting warnings', format('select public.set_notification_mute(%L, true)', 'warning'), 'cannot be switched off');
  perform nfkit.must_fail('muting suspensions', format('select public.set_notification_mute(%L, true)', 'suspension'), 'cannot be switched off');
  perform nfkit.must_fail('muting hidden projects', format('select public.set_notification_mute(%L, true)', 'project_hidden'), 'cannot be switched off');
  perform public.set_notification_mute('project_starred', true);
  perform public.set_notification_mute('project_starred', true); -- harmless
  if (select count(*) from public.notification_mutes) <> 1 then raise exception 'FAIL: sidy should have one mute'; end if;
  reset role;

  perform nfkit.as_user(1);
  perform public.star_project(p);
  reset role;
  if nfkit.n(5, 'project_starred') <> 0 then raise exception 'FAIL: a muted kind still created a notice'; end if;

  perform nfkit.as_user(5);
  perform public.set_notification_mute('project_starred', false);
  reset role;
  perform nfkit.as_user(2);
  perform public.star_project(p);
  reset role;
  if nfkit.n(5, 'project_starred') <> 1 then raise exception 'FAIL: after unmuting, notices should come again'; end if;

  perform nfkit.as_user(1); -- others' mutes are private
  if (select count(*) from public.notification_mutes) <> 0 then raise exception 'FAIL: a member sees someone else''s mutes'; end if;
  reset role;
  raise notice 'OK 10: noisy kinds can be muted; warnings, suspensions and hidden-project notices cannot';
end $$;

-- ---- 11. Tidying up -------------------------------------------------------------------------------------------------------------
do $$
declare removed int;
begin
  -- one old read notice, one old unread notice (91 days), one recent
  update public.notifications set read_at = now() - interval '40 days' where id = (select min(id) from public.notifications where user_id = nfkit.uid(1));
  update public.notifications set created_at = now() - interval '91 days' where id = (select min(id) from public.notifications where user_id = nfkit.uid(3));

  perform nfkit.as_user(1);
  perform nfkit.must_fail('a member purges', 'select public.purge_old_notifications()', 'permission denied');
  reset role;

  perform nfkit.as_server();
  removed := public.purge_old_notifications();
  reset role;
  if removed < 2 then raise exception 'FAIL: expected at least 2 old notices removed, got %', removed; end if;
  if nfkit.total(5) <> 1 then raise exception 'FAIL: recent notices should be kept'; end if;
  raise notice 'OK 11: old notices are tidied up by the server, recent ones stay';
end $$;

-- ---- Clean up ----------------------------------------------------------------------------------------------------------------------
delete from public.communities where slug = 'nf-cercle';
delete from public.projects where owner_id::text like 'd9d9d9d9-%';
delete from public.profiles where id::text like 'd9d9d9d9-%';
delete from auth.users where id::text like 'd9d9d9d9-%';
drop schema nfkit cascade;

do $$
begin
  if exists (select 1 from public.notifications where user_id::text like 'd9d9d9d9-%') or exists (select 1 from public.notification_mutes where user_id::text like 'd9d9d9d9-%') then raise exception 'FAIL: notices left behind'; end if;
  if exists (select 1 from public.staff_roles) or exists (select 1 from public.reports) then raise exception 'FAIL: staff or reports left behind'; end if;
  raise notice 'OK 12: the test left nothing behind';
end $$;

select 'ALL NOTIFICATION TESTS PASSED' as result;
