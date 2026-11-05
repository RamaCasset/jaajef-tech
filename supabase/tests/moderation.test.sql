-- Tests for migration 8 (reports and moderation).
-- Run AFTER migrations 1 to 8. psql -v ON_ERROR_STOP=1 -f moderation.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
-- Everything this test creates is deleted at the end (except audit log lines,
-- which by design can never be deleted), so other tests are not affected.
--
-- People in this test:
--   ama     (...0001)  admin
--   binta   (...0002)  moderator
--   cheikh  (...0003)  a member who reports things
--   demba   (...0004)  the member who misbehaves; owns the community "mod-forum"
--   eliane  (...0005)  an outsider (not in the community or in any conversation)
--   fatou   (...0006)  a member of the community who reports things

create schema mdkit;
grant usage on schema mdkit to public;

create function mdkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('dededede-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function mdkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', mdkit.uid(p_n)::text, true);
end $$;

create function mdkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function mdkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function mdkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function mdkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := mdkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- Lookups done as the database owner, so tests can find ids.
create function mdkit.msg(p_body text) returns text
language sql stable security definer as $$ select id::text from public.messages where body = p_body $$;
create function mdkit.dm(p_body text) returns text
language sql stable security definer as $$ select id::text from public.direct_messages where body = p_body $$;
create function mdkit.proj(p_repo text) returns text
language sql stable security definer as $$ select id::text from public.projects where github_repo = p_repo $$;
create function mdkit.general() returns uuid
language sql stable security definer as $$
  select id from public.channels where slug = 'general' and community_id = (select id from public.communities where slug = 'mod-forum')
$$;
-- The open report of one reporter about one target.
create function mdkit.rep(p_reporter int, p_type text, p_target text) returns uuid
language sql stable security definer as $$
  select id from public.reports
   where reporter_id = mdkit.uid(p_reporter) and target_type = p_type and target_id = p_target and status = 'open'
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (mdkit.uid(1), 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  (mdkit.uid(2), 'binta@exemple.sn', '{"provider":"email"}', '{}'),
  (mdkit.uid(3), 'cheikh@exemple.sn', '{"provider":"email"}', '{}'),
  (mdkit.uid(4), 'demba@exemple.sn', '{"provider":"email"}', '{}'),
  (mdkit.uid(5), 'eliane@exemple.sn', '{"provider":"email"}', '{}'),
  (mdkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- Setup: staff, a community, messages, a private conversation, a project -----------------
do $$
declare c uuid; conv uuid;
begin
  perform mdkit.as_server();
  perform public.make_admin(mdkit.uid(1));
  reset role;
  perform mdkit.as_user(1);
  perform public.set_moderator(mdkit.uid(2), true);
  reset role;

  perform mdkit.as_user(4);
  c := public.create_community('mod-forum', 'Mod forum', null, false);
  reset role;
  perform mdkit.as_user(3);
  perform public.join_community(c);
  reset role;
  perform mdkit.as_user(6);
  perform public.join_community(c);
  reset role;

  perform mdkit.as_user(4);
  perform public.send_message(mdkit.general(), 'Achetez mes pilules');
  perform public.send_message(mdkit.general(), 'Bonjour a tous');
  reset role;

  perform mdkit.as_user(3);
  conv := public.start_conversation(mdkit.uid(4));
  reset role;
  perform mdkit.as_user(4);
  perform public.send_direct_message(conv, 'Message prive louche');
  reset role;

  insert into public.projects (owner_id, github_owner, github_repo, title, verified_at)
  values (mdkit.uid(4), 'demba-dev', 'mod-projet', 'Un projet', now());
end $$;

-- ---- 1. Reporting: what can be reported, and by whom ----------------------------------------------
do $$
declare r uuid;
begin
  perform mdkit.as_user(3);
  r := public.report_content('message', mdkit.msg('Achetez mes pilules'), 'spam', 'Publicite');
  perform mdkit.must_fail('reporting the same message twice', format('select public.report_content(%L, %L, %L)', 'message', mdkit.msg('Achetez mes pilules'), 'spam'), 'already reported');
  perform mdkit.must_fail('a reason that does not exist', format('select public.report_content(%L, %L, %L)', 'message', mdkit.msg('Bonjour a tous'), 'rude'), 'check');
  perform mdkit.must_fail('reporting a whole community', format('select public.report_content(%L, %L, %L)', 'community', 'x', 'spam'), 'You can report');
  perform mdkit.must_fail('a target id that is not a number', format('select public.report_content(%L, %L, %L)', 'message', 'abc', 'spam'), 'not found');
  perform mdkit.must_fail('a note of 501 characters', format('select public.report_content(%L, %L, %L, %L)', 'message', mdkit.msg('Bonjour a tous'), 'spam', repeat('x', 501)), 'too long');
  perform public.report_content('direct_message', mdkit.dm('Message prive louche'), 'harassment');
  perform public.report_content('project', mdkit.proj('mod-projet'), 'scam');
  perform public.report_content('member', mdkit.uid(4)::text, 'harassment', 'Insulte en prive');
  perform mdkit.must_fail('reporting yourself', format('select public.report_content(%L, %L, %L)', 'member', mdkit.uid(3)::text, 'other'), 'own content');
  reset role;

  if (select snapshot ->> 'body' from public.reports where id = r) <> 'Achetez mes pilules' then raise exception 'FAIL: the snapshot of the message is wrong'; end if;
  if (select community_id from public.reports where id = r) is null then raise exception 'FAIL: the community was not recorded'; end if;
  if (select target_author_id from public.reports where id = r) <> mdkit.uid(4) then raise exception 'FAIL: the author was not recorded'; end if;
  if (select snapshot ->> 'body' from public.reports where target_type = 'direct_message') <> 'Message prive louche' then raise exception 'FAIL: the private message was not copied'; end if;
  raise notice 'OK 1a: members can report messages, private messages, projects and members, with a copy of what was reported';
end $$;

do $$
begin
  -- the author cannot report their own content
  perform mdkit.as_user(4);
  perform mdkit.must_fail('reporting your own message', format('select public.report_content(%L, %L, %L)', 'message', mdkit.msg('Bonjour a tous'), 'spam'), 'own content');
  perform mdkit.must_fail('reporting your own private message', format('select public.report_content(%L, %L, %L)', 'direct_message', mdkit.dm('Message prive louche'), 'spam'), 'own content');
  perform mdkit.must_fail('reporting your own project', format('select public.report_content(%L, %L, %L)', 'project', mdkit.proj('mod-projet'), 'spam'), 'own content');
  reset role;

  -- an outsider cannot report what they cannot see
  perform mdkit.as_user(5);
  perform mdkit.must_fail('outsider reports a community message', format('select public.report_content(%L, %L, %L)', 'message', mdkit.msg('Achetez mes pilules'), 'spam'), 'not found');
  perform mdkit.must_fail('outsider reports a private message', format('select public.report_content(%L, %L, %L)', 'direct_message', mdkit.dm('Message prive louche'), 'spam'), 'not found');
  perform public.report_content('member', mdkit.uid(4)::text, 'spam'); -- anyone can report a public profile
  reset role;

  perform mdkit.as_anon();
  perform mdkit.must_fail('visitor reports', format('select public.report_content(%L, %L, %L)', 'member', mdkit.uid(4)::text, 'spam'), 'permission denied');
  reset role;
  raise notice 'OK 1b: you cannot report your own content or what you cannot see; visitors cannot report';
end $$;

-- ---- 2. Who sees the reports -----------------------------------------------------------------------------
do $$
declare n int; r record;
begin
  perform mdkit.as_user(3);
  select count(*) into n from public.reports;
  if n <> 4 then raise exception 'FAIL: the reporter should see their 4 reports, saw %', n; end if;
  perform mdkit.must_fail('member opens the staff queue', 'select * from public.list_reports()', 'Only staff');
  reset role;

  perform mdkit.as_user(5);
  select count(*) into n from public.reports;
  if n <> 1 then raise exception 'FAIL: eliane should see only her own report, saw %', n; end if;
  reset role;

  perform mdkit.as_user(6);
  select count(*) into n from public.reports;
  if n <> 0 then raise exception 'FAIL: a member sees reports made by others (%)', n; end if;
  reset role;

  perform mdkit.as_user(4); -- the person reported cannot see who reported them
  select count(*) into n from public.reports;
  if n <> 0 then raise exception 'FAIL: the reported member sees % reports', n; end if;
  reset role;

  perform mdkit.as_user(2); -- a moderator
  select count(*) into n from public.list_reports();
  if n <> 5 then raise exception 'FAIL: the moderator should see 5 open reports, saw %', n; end if;
  select open_reports_on_same_target into n from public.list_reports() where target_type = 'member' limit 1;
  if n <> 2 then raise exception 'FAIL: two members reported demba, the queue says %', n; end if;
  -- but moderators cannot read private conversations or other communities
  if (select count(*) from public.direct_messages) <> 0 then raise exception 'FAIL: a moderator can read private messages'; end if;
  if (select count(*) from public.messages) <> 0 then raise exception 'FAIL: a moderator can read a community they are not in'; end if;
  reset role;

  perform mdkit.as_anon();
  perform mdkit.must_fail('visitor reads reports', 'select count(*) from public.reports', 'permission denied');
  reset role;
  raise notice 'OK 2: reports are seen by their author and by staff only; moderators still cannot read private conversations';
end $$;

-- ---- 3. Limit on reports per day -----------------------------------------------------------------------------
update public.game_config set value = '2' where key = 'report_max_per_day';

do $$
begin
  perform mdkit.as_user(6);
  perform public.report_content('message', mdkit.msg('Bonjour a tous'), 'spam');
  perform public.report_content('member', mdkit.uid(5)::text, 'other');
  perform mdkit.must_fail('third report in a day', format('select public.report_content(%L, %L, %L)', 'member', mdkit.uid(4)::text, 'spam'), 'too many reports');
  reset role;
  raise notice 'OK 3: the number of reports per day is limited';
end $$;

update public.game_config set value = '10' where key = 'report_max_per_day';

-- ---- 4. Handling: only staff, dismissing, closing duplicates ---------------------------------------------------
do $$
declare r uuid := mdkit.rep(3, 'member', mdkit.uid(4)::text);
begin
  perform mdkit.as_user(3);
  perform mdkit.must_fail('member resolves a report', format('select public.resolve_report(%L, %L)', r, 'dismiss'), 'Only staff');
  reset role;
  perform mdkit.as_user(2);
  perform mdkit.must_fail('unknown action', format('select public.resolve_report(%L, %L)', r, 'ban_forever'), 'Unknown action');
  perform public.resolve_report(r, 'dismiss', 'Rien a signaler');
  perform mdkit.must_fail('handling a report twice', format('select public.resolve_report(%L, %L)', r, 'dismiss'), 'already been handled');
  reset role;

  -- eliane also reported demba: that report was closed together with this one
  if (select count(*) from public.reports where target_type = 'member' and target_id = mdkit.uid(4)::text and status = 'dismissed') <> 2 then
    raise exception 'FAIL: both reports about the same member should be dismissed';
  end if;
  raise notice 'OK 4: only staff handle reports; one decision closes every report about the same thing';
end $$;

-- ---- 5. Removing content ---------------------------------------------------------------------------------------------
do $$
declare r uuid := mdkit.rep(3, 'message', mdkit.msg('Achetez mes pilules')); m text := mdkit.msg('Achetez mes pilules');
begin
  perform mdkit.as_user(2);
  perform public.resolve_report(r, 'remove_content', 'Spam');
  reset role;
  if (select body from public.messages where id = m::bigint) <> '' or (select deleted_at from public.messages where id = m::bigint) is null then
    raise exception 'FAIL: the message was not removed';
  end if;
  -- the copy in the report survives
  if (select snapshot ->> 'body' from public.reports where id = r) <> 'Achetez mes pilules' then raise exception 'FAIL: the evidence was lost'; end if;

  perform mdkit.as_user(6);
  perform mdkit.must_fail('reporting a message that is already removed', format('select public.report_content(%L, %L, %L)', 'message', m, 'spam'), 'not found');
  reset role;
  raise notice 'OK 5a: a removed message is wiped, but the evidence stays in the report';
end $$;

do $$
declare r uuid := mdkit.rep(3, 'direct_message', mdkit.dm('Message prive louche'));
begin
  perform mdkit.as_user(2);
  perform public.resolve_report(r, 'remove_content');
  reset role;
  if exists (select 1 from public.direct_messages where body = 'Message prive louche') then raise exception 'FAIL: the private message was not removed'; end if;
  if (select count(*) from public.direct_messages where deleted_at is not null and sender_id = mdkit.uid(4)) <> 1 then raise exception 'FAIL: the private message should be marked deleted'; end if;
  raise notice 'OK 5b: a reported private message can be removed';
end $$;

do $$
declare r uuid := mdkit.rep(3, 'project', mdkit.proj('mod-projet')); p uuid := mdkit.proj('mod-projet')::uuid;
begin
  perform mdkit.as_anon();
  if (select count(*) from public.projects where id = p) <> 1 then raise exception 'FAIL: the project should be public before the report'; end if;
  reset role;

  perform mdkit.as_user(2);
  perform public.resolve_report(r, 'remove_content');
  reset role;

  perform mdkit.as_anon();
  if (select count(*) from public.projects where id = p) <> 0 then raise exception 'FAIL: a hidden project is still public'; end if;
  reset role;
  perform mdkit.as_user(4);
  if (select count(*) from public.projects where id = p) <> 1 then raise exception 'FAIL: the owner should still see their project'; end if;
  perform public.update_project(p, null, null, null, true); -- the owner tries to show it again
  reset role;
  perform mdkit.as_anon();
  if (select count(*) from public.projects where id = p) <> 0 then raise exception 'FAIL: the owner brought a hidden project back'; end if;
  reset role;

  perform mdkit.as_user(2);
  perform mdkit.must_fail('a moderator restores a project', format('select public.staff_restore_project(%L)', p), 'Only an admin');
  reset role;
  perform mdkit.as_user(1);
  perform public.staff_restore_project(p);
  perform mdkit.must_fail('restoring a project that is not hidden', format('select public.staff_restore_project(%L)', p), 'not hidden');
  reset role;
  perform mdkit.as_anon();
  if (select count(*) from public.projects where id = p) <> 1 then raise exception 'FAIL: the restored project is not public'; end if;
  reset role;
  raise notice 'OK 5c: staff hide a project; the owner cannot undo it; only an admin restores it';
end $$;

do $$
declare r uuid;
begin
  perform mdkit.as_user(6);
  r := public.report_content('member', mdkit.uid(4)::text, 'harassment');
  reset role;
  perform mdkit.as_user(2);
  perform mdkit.must_fail('removing a member', format('select public.resolve_report(%L, %L)', r, 'remove_content'), 'nothing to remove');
  reset role;
  raise notice 'OK 5d: there is nothing to remove for a member report';
end $$;

-- ---- 6. Warnings ----------------------------------------------------------------------------------------------------------
do $$
declare r uuid := mdkit.rep(6, 'member', mdkit.uid(4)::text);
begin
  perform mdkit.as_user(2);
  perform public.resolve_report(r, 'warn_member', 'Premier avertissement');
  reset role;

  perform mdkit.as_user(4);
  if (select count(*) from public.member_warnings) <> 1 then raise exception 'FAIL: the member should see their own warning'; end if;
  reset role;
  perform mdkit.as_user(3);
  if (select count(*) from public.member_warnings) <> 0 then raise exception 'FAIL: a member sees someone else''s warning'; end if;
  reset role;
  raise notice 'OK 6: a warning is recorded and seen only by the member and staff';
end $$;

-- ---- 7. Suspensions ------------------------------------------------------------------------------------------------------------
do $$
declare r uuid;
begin
  perform mdkit.as_user(3);
  r := public.report_content('member', mdkit.uid(4)::text, 'harassment', 'Encore');
  reset role;

  perform mdkit.as_user(2); -- moderator: 7 days at most
  perform mdkit.must_fail('moderator suspends for 8 days', format('select public.resolve_report(%L, %L, null, 8)', r, 'suspend_member'), 'between 1 and 7');
  perform mdkit.must_fail('suspension without a length', format('select public.resolve_report(%L, %L)', r, 'suspend_member'), 'between 1 and 7');
  perform mdkit.must_fail('suspension of 0 days', format('select public.resolve_report(%L, %L, null, 0)', r, 'suspend_member'), 'between 1 and 7');
  perform public.resolve_report(r, 'suspend_member', 'Trois jours', 3);
  reset role;

  if public.suspended_until(mdkit.uid(4)) is null then raise exception 'FAIL: demba should be suspended'; end if;
  raise notice 'OK 7a: a moderator can suspend for 1 to 7 days';
end $$;

do $$
declare conv uuid; m text := mdkit.msg('Bonjour a tous');
begin
  perform mdkit.as_user(4); -- suspended
  perform mdkit.must_fail('a suspended member posts', format('select public.send_message(%L, %L)', mdkit.general(), 'je continue'), 'suspended');
  perform mdkit.must_fail('a suspended member edits a message', format('select public.edit_message(%L, %L)', m::bigint, 'nouveau texte'), 'suspended');
  perform mdkit.must_fail('a suspended member creates a community', $q$select public.create_community('mod-autre', 'Autre', null, false)$q$, 'suspended');
  perform mdkit.must_fail('a suspended member starts a conversation', format('select public.start_conversation(%L)', mdkit.uid(6)), 'suspended');
  select id into conv from public.conversations where user_a = least(mdkit.uid(3), mdkit.uid(4)) and user_b = greatest(mdkit.uid(3), mdkit.uid(4));
  perform mdkit.must_fail('a suspended member sends a private message', format('select public.send_direct_message(%L, %L)', conv, 'coucou'), 'suspended');
  -- but they can still read, and delete their own messages
  if (select count(*) from public.messages where community_id = (select id from public.communities where slug = 'mod-forum')) < 1 then raise exception 'FAIL: a suspended member can no longer read'; end if;
  perform public.delete_message(m::bigint);
  -- and they see why
  if (select count(*) from public.member_suspensions) <> 1 then raise exception 'FAIL: the member should see their own suspension'; end if;
  reset role;

  perform mdkit.as_user(3); -- others are not affected, and do not see the suspension
  perform public.send_message(mdkit.general(), 'Je peux ecrire');
  if (select count(*) from public.member_suspensions) <> 0 then raise exception 'FAIL: a member sees someone else''s suspension'; end if;
  reset role;
  raise notice 'OK 7b: a suspended member cannot post, edit, create or message, but can read and delete their own; others are unaffected';
end $$;

-- the suspension ends by itself
update public.member_suspensions set until = now() - interval '1 hour';

do $$
begin
  if public.suspended_until(mdkit.uid(4)) is not null then raise exception 'FAIL: an ended suspension still counts'; end if;
  perform mdkit.as_user(4);
  perform public.send_message(mdkit.general(), 'De retour');
  reset role;
  raise notice 'OK 7c: a suspension ends by itself';
end $$;

-- admin: longer suspensions, and lifting
do $$
declare r uuid;
begin
  perform mdkit.as_user(6);
  r := public.report_content('member', mdkit.uid(4)::text, 'harassment', 'Recidive');
  reset role;
  perform mdkit.as_user(1);
  perform mdkit.must_fail('admin suspends for 400 days', format('select public.resolve_report(%L, %L, null, 400)', r, 'suspend_member'), 'between 1 and 365');
  perform public.resolve_report(r, 'suspend_member', 'Un mois', 30);
  reset role;
  if public.suspended_until(mdkit.uid(4)) < now() + interval '29 days' then raise exception 'FAIL: the suspension should last about 30 days'; end if;

  perform mdkit.as_user(3);
  perform mdkit.must_fail('member lifts a suspension', format('select public.lift_suspension(%L)', mdkit.uid(4)), 'Only an admin');
  reset role;
  perform mdkit.as_user(2);
  perform mdkit.must_fail('moderator lifts a suspension', format('select public.lift_suspension(%L)', mdkit.uid(4)), 'Only an admin');
  reset role;
  perform mdkit.as_user(1);
  perform public.lift_suspension(mdkit.uid(4));
  perform mdkit.must_fail('lifting when not suspended', format('select public.lift_suspension(%L)', mdkit.uid(4)), 'not suspended');
  reset role;

  perform mdkit.as_user(4);
  perform public.send_message(mdkit.general(), 'Libere');
  reset role;
  raise notice 'OK 7d: admins suspend up to 365 days and can lift a suspension';
end $$;

-- ---- 8. Staff cannot be sanctioned freely ----------------------------------------------------------------------------------
do $$
declare r_mod uuid; r_admin uuid; r_admin2 uuid;
begin
  perform mdkit.as_user(3);
  r_mod := public.report_content('member', mdkit.uid(2)::text, 'other');
  r_admin := public.report_content('member', mdkit.uid(1)::text, 'other');
  reset role;

  perform mdkit.as_user(2); -- moderator
  perform mdkit.must_fail('moderator warns a moderator', format('select public.resolve_report(%L, %L)', r_mod, 'warn_member'), 'Only an admin can sanction a moderator');
  perform mdkit.must_fail('moderator suspends an admin', format('select public.resolve_report(%L, %L, null, 1)', r_admin, 'suspend_member'), 'cannot be sanctioned');
  reset role;

  perform mdkit.as_user(1); -- admin
  perform mdkit.must_fail('admin sanctions an admin', format('select public.resolve_report(%L, %L, null, 1)', r_admin, 'suspend_member'), 'cannot be sanctioned');
  perform public.resolve_report(r_mod, 'warn_member', 'Rappel');
  perform public.resolve_report(r_admin, 'dismiss');
  reset role;

  if (select count(*) from public.member_warnings where user_id = mdkit.uid(2)) <> 1 then raise exception 'FAIL: the admin should be able to warn a moderator'; end if;
  raise notice 'OK 8: nobody sanctions an admin; only an admin sanctions a moderator';
end $$;

-- ---- 9. The audit log -----------------------------------------------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(a, ', ') into missing
    from unnest(array['report_dismiss', 'report_remove_content', 'report_warn_member', 'report_suspend_member', 'suspension_lifted', 'project_restored']) a
   where not exists (select 1 from public.admin_audit_log where action = a and target_id is not null);
  if missing is not null then raise exception 'FAIL: the audit log is missing: %', missing; end if;
  if exists (select 1 from public.admin_audit_log where action like 'report_%' and actor_id is null) then raise exception 'FAIL: a staff action has no actor'; end if;
  raise notice 'OK 9: every kind of staff action is in the audit log';
end $$;

-- ---- 10. Nobody writes the tables directly ---------------------------------------------------------------------------------------------------
do $$
begin
  perform mdkit.as_user(3);
  perform mdkit.must_fail('direct report insert', format('insert into public.reports (reporter_id, target_type, target_id, target_author_id, reason) values (%L, %L, %L, %L, %L)', mdkit.uid(3), 'member', 'x', mdkit.uid(4), 'spam'), 'permission denied');
  perform mdkit.must_fail('editing a report', $q$update public.reports set status = 'dismissed'$q$, 'permission denied');
  reset role;
  perform mdkit.as_user(1); -- even an admin
  perform mdkit.must_fail('admin inserts a suspension', format('insert into public.member_suspensions (user_id, until) values (%L, now() + interval %L)', mdkit.uid(3), '1 day'), 'permission denied');
  perform mdkit.must_fail('admin inserts a warning', format('insert into public.member_warnings (user_id) values (%L)', mdkit.uid(3)), 'permission denied');
  perform mdkit.must_fail('admin removes a suspension', 'delete from public.member_suspensions', 'permission denied');
  reset role;
  raise notice 'OK 10: reports, warnings and suspensions can only change through the functions';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------------------------------------------
delete from public.communities where slug like 'mod-%';
delete from public.projects where owner_id::text like 'dededede-%';
delete from public.profiles where id::text like 'dededede-%';
delete from auth.users where id::text like 'dededede-%';
drop schema mdkit cascade;

do $$
begin
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if exists (select 1 from public.reports) then raise exception 'FAIL: reports left behind'; end if;
  raise notice 'OK 11: the test left nothing behind';
end $$;

select 'ALL MODERATION TESTS PASSED' as result;
