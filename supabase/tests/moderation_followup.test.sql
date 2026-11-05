-- Tests for the moderation follow-up migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f moderation_followup.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ona (...1) owns a project and a private community; paul (...2) is a
-- member who gets suspended; rama (...3) is another member; ama (...4) is an admin.

create schema mfkit;
grant usage on schema mfkit to public;

create function mfkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('f0f0f0f0-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function mfkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', mfkit.uid(p_n)::text, true);
end $$;

create function mfkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function mfkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function mfkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function mfkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := mfkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function mfkit.proj(p_repo text) returns uuid
language sql stable security definer as $$ select id from public.projects where github_repo = p_repo $$;

create function mfkit.comment_id(p_body text) returns bigint
language sql stable security definer as $$ select id from public.project_comments where body = p_body order by id limit 1 $$;

create function mfkit.community() returns uuid
language sql stable security definer as $$ select id from public.communities where slug = 'mf-cercle' $$;

create function mfkit.rep(p_reporter int, p_type text, p_target text) returns uuid
language sql stable security definer as $$
  select id from public.reports
   where reporter_id = mfkit.uid(p_reporter) and target_type = p_type and target_id = p_target and status = 'open'
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (mfkit.uid(1), 'ona@exemple.sn', '{"provider":"email"}', '{}'),
  (mfkit.uid(2), 'paul@exemple.sn', '{"provider":"email"}', '{}'),
  (mfkit.uid(3), 'rama@exemple.sn', '{"provider":"email"}', '{}'),
  (mfkit.uid(4), 'ama@exemple.sn', '{"provider":"email"}', '{}');

insert into public.projects (owner_id, github_owner, github_repo, title, verified_at) values
  (mfkit.uid(1), 'ona-dev', 'mf-projet', 'Projet', now());

do $$
declare c uuid;
begin
  perform mfkit.as_server();
  perform public.make_admin(mfkit.uid(4));
  reset role;

  perform mfkit.as_user(1);
  update public.profiles set available_to_collab = true where id = mfkit.uid(1);
  c := public.create_community('mf-cercle', 'Cercle', null, true, true); -- private but listed: people can ask to join
  reset role;

  perform mfkit.as_user(3);
  perform public.post_project_comment(mfkit.proj('mf-projet'), 'Commentaire de Rama');
  reset role;
end $$;

-- ---- 1. A suspended member cannot do the new things ----------------------------------------------------------------
do $$
declare p uuid := mfkit.proj('mf-projet');
begin
  perform mfkit.as_user(2);
  perform public.post_project_comment(p, 'Avant la suspension');
  reset role;

  insert into public.member_suspensions (user_id, until, reason) values (mfkit.uid(2), now() + interval '3 days', 'test');

  perform mfkit.as_user(2);
  perform mfkit.must_fail('a suspended member comments', format('select public.post_project_comment(%L, %L)', p, 'Pendant la suspension'), 'suspended');
  perform mfkit.must_fail('a suspended member edits a comment', format('select public.edit_project_comment(%L, %L)', mfkit.comment_id('Avant la suspension'), 'Modifie'), 'suspended');
  perform mfkit.must_fail('a suspended member asks to collaborate', format('select public.request_collaboration(%L, %L)', p, 'Je peux aider'), 'suspended');
  perform mfkit.must_fail('a suspended member asks to join', format('select public.request_to_join(%L, %L)', mfkit.community(), 'Bonjour'), 'suspended');
  -- but can still star and delete their own comment
  perform public.star_project(p);
  perform public.delete_project_comment(mfkit.comment_id('Avant la suspension'));
  reset role;
  raise notice 'OK 1a: a suspended member cannot comment, edit, ask to collaborate or ask to join; can still star and delete their own comment';
end $$;

update public.member_suspensions set until = now() - interval '1 hour' where user_id = mfkit.uid(2);

do $$
begin
  perform mfkit.as_user(2);
  perform public.post_project_comment(mfkit.proj('mf-projet'), 'Apres la suspension');
  perform public.request_collaboration(mfkit.proj('mf-projet'), 'Je peux aider');
  perform public.request_to_join(mfkit.community(), 'Bonjour');
  reset role;
  raise notice 'OK 1b: when the suspension ends, everything works again';
end $$;

-- ---- 2. A project hidden by staff disappears completely ----------------------------------------------------------
do $$
declare p uuid := mfkit.proj('mf-projet'); r uuid;
begin
  perform mfkit.as_user(3);
  r := public.report_content('project', p::text, 'scam');
  reset role;
  perform mfkit.as_user(4);
  perform public.resolve_report(r, 'remove_content');
  reset role;

  perform mfkit.as_anon();
  if (select count(*) from public.project_comments where project_id = p) <> 0 then raise exception 'FAIL: comments of a hidden project are still public'; end if;
  if (select count(*) from public.project_stats where project_id = p) <> 0 then raise exception 'FAIL: counts of a hidden project are still public'; end if;
  reset role;

  perform mfkit.as_user(3);
  perform mfkit.must_fail('starring a hidden project', format('select public.star_project(%L)', p), 'not found');
  perform mfkit.must_fail('commenting on a hidden project', format('select public.post_project_comment(%L, %L)', p, 'salut'), 'not found');
  perform mfkit.must_fail('asking to collaborate on a hidden project', format('select public.request_collaboration(%L, %L)', p, 'salut'), 'not found');
  reset role;

  perform mfkit.as_user(4);
  perform public.staff_restore_project(p);
  reset role;
  perform mfkit.as_anon();
  if (select count(*) from public.project_comments where project_id = p) < 1 then raise exception 'FAIL: comments should be back once the project is restored'; end if;
  reset role;
  raise notice 'OK 2: a project hidden by staff shows nothing and accepts nothing; restoring brings it back';
end $$;

-- ---- 3. Reporting a comment --------------------------------------------------------------------------------------
do $$
declare p uuid := mfkit.proj('mf-projet'); c bigint := mfkit.comment_id('Commentaire de Rama'); r uuid; n int;
begin
  perform mfkit.as_user(3);
  perform mfkit.must_fail('reporting your own comment', format('select public.report_content(%L, %L, %L)', 'project_comment', c, 'spam'), 'own content');
  reset role;

  perform mfkit.as_user(1);
  r := public.report_content('project_comment', c::text, 'spam', 'Publicite');
  perform mfkit.must_fail('reporting the same comment twice', format('select public.report_content(%L, %L, %L)', 'project_comment', c, 'spam'), 'already reported');
  reset role;
  if (select snapshot ->> 'body' from public.reports where id = r) <> 'Commentaire de Rama' then raise exception 'FAIL: the comment was not copied into the report'; end if;
  if (select target_author_id from public.reports where id = r) <> mfkit.uid(3) then raise exception 'FAIL: the author of the comment was not recorded'; end if;

  perform mfkit.as_user(4);
  perform public.resolve_report(r, 'remove_content', 'Spam');
  reset role;
  if exists (select 1 from public.project_comments where id = c) then raise exception 'FAIL: the comment was not removed'; end if;
  select comment_count into n from public.project_stats where project_id = p;
  if n <> 1 then raise exception 'FAIL: the comment count should be 1 (paul has one), got %', n; end if;
  if (select snapshot ->> 'body' from public.reports where id = r) <> 'Commentaire de Rama' then raise exception 'FAIL: the evidence was lost'; end if;

  perform mfkit.as_user(1);
  perform mfkit.must_fail('reporting a comment that is gone', format('select public.report_content(%L, %L, %L)', 'project_comment', c, 'spam'), 'not found');
  reset role;
  raise notice 'OK 3: comments can be reported; staff remove them; the evidence stays; the count follows';
end $$;

-- ---- Clean up ----------------------------------------------------------------------------------------------------
delete from public.communities where slug = 'mf-cercle';
delete from public.projects where owner_id::text like 'f0f0f0f0-%';
delete from public.profiles where id::text like 'f0f0f0f0-%';
delete from auth.users where id::text like 'f0f0f0f0-%';
drop schema mfkit cascade;

do $$
begin
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if exists (select 1 from public.reports) or exists (select 1 from public.project_comments) or exists (select 1 from public.project_stats) then
    raise exception 'FAIL: rows left behind';
  end if;
  raise notice 'OK 4: the test left nothing behind';
end $$;

select 'ALL MODERATION FOLLOW-UP TESTS PASSED' as result;
