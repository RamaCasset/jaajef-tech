-- Tests for migration 7 (badges that unlock by themselves).
-- Run AFTER migrations 1 to 7. psql -v ON_ERROR_STOP=1 -f badges.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
-- The goals are lowered during the test (2, 2 and 3) and restored at the end.
-- Everything this test creates is deleted at the end, so other tests are not affected.
--
-- People in this test:
--   ama     (...0001)  has projects
--   bineta  (...0002)  solves quests, and posts in a forum
--   cheikh  (...0003)  posts in a forum, and receives a manual badge
--   dior    (...0004)  posts in her own empty community
-- Stand-in for the old browser report: players can no longer call submit_quest, so the tests grade
-- through the server-only function, as the server would, for the signed-in test player.
create schema if not exists tg;
create or replace function tg.submit_quest(p_quest uuid, p_code text, p_passed integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public.record_graded_attempt(auth.uid(), p_quest, p_code, p_passed, p_total); end $$;
grant usage on schema tg to authenticated, anon, service_role;
grant execute on function tg.submit_quest(uuid, text, integer, integer) to authenticated, anon, service_role;



create schema bgkit;
grant usage on schema bgkit to public;

create function bgkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('badbadba-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function bgkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', bgkit.uid(p_n)::text, true);
end $$;

create function bgkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function bgkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function bgkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function bgkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := bgkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- "progress|unlocked" for one member and badge, or "none" if there is no row.
create function bgkit.badge(p_n int, p_slug text) returns text
language sql stable security definer as $$
  select coalesce(
    (select progress || '|' || (unlocked_at is not null)::text
       from public.user_badges where user_id = bgkit.uid(p_n) and badge_slug = p_slug),
    'none')
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (bgkit.uid(1), 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  (bgkit.uid(2), 'bineta@exemple.sn', '{"provider":"email"}', '{}'),
  (bgkit.uid(3), 'cheikh@exemple.sn', '{"provider":"email"}', '{}'),
  (bgkit.uid(4), 'dior@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. The rules --------------------------------------------------------------------
do $$
declare ok boolean;
begin
  if (select count(*) from public.badge_rules where metric <> 'manual') <> 4 then raise exception 'FAIL: expected 4 automatic badges'; end if;
  if (select count(*) from public.badge_rules where metric = 'manual' and threshold is null) <> 3 then raise exception 'FAIL: expected 3 manual badges'; end if;
  if (select count(*) from public.badge_rules) <> (select count(*) from public.badges) then raise exception 'FAIL: every badge needs a rule'; end if;

  ok := false;
  begin update public.badge_rules set threshold = null where badge_slug = 'maitre_griot';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: an automatic badge without a goal was accepted'; end if;

  ok := false;
  begin update public.badge_rules set threshold = 0 where badge_slug = 'maitre_griot';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: a goal of 0 was accepted'; end if;

  ok := false;
  begin update public.badge_rules set threshold = 5 where badge_slug = 'champion_du_sahel';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: a manual badge was given a goal'; end if;
  raise notice 'OK 1: four automatic badges, three manual, and the rules cannot be nonsense';
end $$;

-- Lower the goals so the test is short (restored at the end).
update public.badge_rules set threshold = 2 where badge_slug in ('l_architecte', 'gardien_du_baobab');
update public.badge_rules set threshold = 3 where badge_slug = 'maitre_griot';

-- ---- 2. Projects: L'Architecte --------------------------------------------------------------
do $$
begin
  -- a pending project counts for nothing
  insert into public.projects (owner_id, github_owner, github_repo, title) values
    (bgkit.uid(1), 'badge-ama', 'repo-1', 'Un'),
    (bgkit.uid(1), 'badge-ama', 'repo-2', 'Deux'),
    (bgkit.uid(1), 'badge-ama', 'repo-3', 'Trois');
  if bgkit.badge(1, 'l_architecte') <> 'none' then raise exception 'FAIL: pending projects counted'; end if;

  update public.projects set verified_at = now() where github_repo = 'repo-1';
  if bgkit.badge(1, 'l_architecte') <> '1|false' then raise exception 'FAIL: one confirmed project should give 1|false, got %', bgkit.badge(1, 'l_architecte'); end if;
  raise notice 'OK 2a: pending projects count for nothing; a confirmed one starts the progress';
end $$;

do $$
begin
  update public.projects set verified_at = now() where github_repo = 'repo-2';
  if bgkit.badge(1, 'l_architecte') <> '2|true' then raise exception 'FAIL: goal reached should unlock, got %', bgkit.badge(1, 'l_architecte'); end if;
  raise notice 'OK 2b: reaching the goal unlocks the badge';
end $$;

do $$
declare before_time timestamptz;
begin
  select unlocked_at into before_time from public.user_badges where user_id = bgkit.uid(1) and badge_slug = 'l_architecte';
  update public.projects set verified_at = now() where github_repo = 'repo-3';
  if bgkit.badge(1, 'l_architecte') <> '2|true' then raise exception 'FAIL: progress should stay capped at the goal, got %', bgkit.badge(1, 'l_architecte'); end if;
  if (select unlocked_at from public.user_badges where user_id = bgkit.uid(1) and badge_slug = 'l_architecte') <> before_time then
    raise exception 'FAIL: the unlock date changed';
  end if;

  -- hiding or losing projects never takes the badge back
  update public.projects set verified_at = null, is_public = false where owner_id = bgkit.uid(1);
  perform public.refresh_badges(bgkit.uid(1), 'projects_published');
  if bgkit.badge(1, 'l_architecte') <> '2|true' then raise exception 'FAIL: the badge was taken back'; end if;
  raise notice 'OK 2c: an unlocked badge keeps its date and is never taken back';
end $$;

-- ---- 3. Quests: Gardien du Baobab, through the real quest functions --------------------------------
insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward, kopek_reward, min_seconds, published)
values
  ('badge-q1', 'Badge 1', 'griot_du_code', 'ndongo', 'javascript', 5, 10, 1, 0, true),
  ('badge-q2', 'Badge 2', 'griot_du_code', 'ndongo', 'javascript', 5, 10, 1, 0, true);
insert into public.quest_tests (quest_id, name, input, expected)
select id, 'only_test', '[1]'::jsonb, '1'::jsonb from public.quests where slug in ('badge-q1', 'badge-q2');

do $$
declare q1 uuid; r jsonb;
begin
  select id into q1 from public.quests where slug = 'badge-q1';
  perform bgkit.as_user(2);
  perform public.start_quest(q1);
  r := tg.submit_quest(q1, 'rate', 0, 1); -- the tests fail
  reset role;
  if (r ->> 'solved')::boolean then raise exception 'FAIL: a failed attempt was accepted'; end if;
  if bgkit.badge(2, 'gardien_du_baobab') <> 'none' then raise exception 'FAIL: a failed attempt counted'; end if;
  raise notice 'OK 3a: a failed attempt counts for nothing';
end $$;

do $$
declare q1 uuid; r jsonb;
begin
  select id into q1 from public.quests where slug = 'badge-q1';
  perform bgkit.as_user(2);
  r := tg.submit_quest(q1, 'solution', 1, 1);
  reset role;
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: the solve was refused %', r; end if;
  if bgkit.badge(2, 'gardien_du_baobab') <> '1|false' then raise exception 'FAIL: first solve should give 1|false, got %', bgkit.badge(2, 'gardien_du_baobab'); end if;

  -- sending the same solved quest again changes nothing
  perform bgkit.as_user(2);
  perform tg.submit_quest(q1, 'solution', 1, 1);
  reset role;
  if bgkit.badge(2, 'gardien_du_baobab') <> '1|false' then raise exception 'FAIL: solving twice counted twice'; end if;
  raise notice 'OK 3b: a solved quest counts once';
end $$;

do $$
declare q2 uuid;
begin
  select id into q2 from public.quests where slug = 'badge-q2';
  perform bgkit.as_user(2);
  perform public.start_quest(q2);
  perform tg.submit_quest(q2, 'solution', 1, 1);
  reset role;
  if bgkit.badge(2, 'gardien_du_baobab') <> '2|true' then raise exception 'FAIL: second solve should unlock, got %', bgkit.badge(2, 'gardien_du_baobab'); end if;
  raise notice 'OK 3c: solving enough quests unlocks the badge';
end $$;

-- ---- 4. Contributions: Maitre Griot ----------------------------------------------------------------------
do $$
declare c uuid; forum uuid; general uuid;
begin
  perform bgkit.as_user(1);
  c := public.create_community('badge-forum', 'Badge forum', null, false);
  forum := public.create_channel(c, 'forum', 'Forum', 'forum');
  reset role;
  perform bgkit.as_user(2);
  perform public.join_community(c);
  reset role;
  perform bgkit.as_user(3);
  perform public.join_community(c);
  reset role;
  select id into general from public.channels where community_id = c and slug = 'general';

  perform bgkit.as_user(2);
  -- a chat message is not a contribution
  perform public.send_message(general, 'salut');
  reset role;
  if bgkit.badge(2, 'maitre_griot') <> 'none' then raise exception 'FAIL: a chat message counted as a contribution'; end if;

  perform bgkit.as_user(2);
  perform public.send_message(forum, 'Ma question', null, 'Une question');
  reset role;
  if bgkit.badge(2, 'maitre_griot') <> '1|false' then raise exception 'FAIL: a forum thread should count, got %', bgkit.badge(2, 'maitre_griot'); end if;
  raise notice 'OK 4a: forum threads count, chat messages do not';
end $$;

do $$
declare thread bigint; forum uuid;
begin
  select id into forum from public.channels where slug = 'forum' and community_id = (select id from public.communities where slug = 'badge-forum');
  select id into thread from public.messages where channel_id = forum and parent_id is null limit 1;

  perform bgkit.as_user(2);
  perform public.send_message(forum, 'Une reponse de moi', thread);
  reset role;
  perform bgkit.as_user(3);
  perform public.send_message(forum, 'Une reponse de cheikh', thread);
  reset role;
  if bgkit.badge(2, 'maitre_griot') <> '2|false' then raise exception 'FAIL: forum replies should count, got %', bgkit.badge(2, 'maitre_griot'); end if;
  if bgkit.badge(3, 'maitre_griot') <> '1|false' then raise exception 'FAIL: cheikh should have 1|false, got %', bgkit.badge(3, 'maitre_griot'); end if;
  raise notice 'OK 4b: replies count';
end $$;

-- Bineta deletes both of her posts, then writes one new thread: her live count
-- drops to 1, but her progress must stay at 2.
do $$
declare forum uuid;
begin
  select id into forum from public.channels where slug = 'forum' and community_id = (select id from public.communities where slug = 'badge-forum');
  perform bgkit.as_user(2);
  perform public.delete_message((select id from public.messages where author_id = bgkit.uid(2) and channel_id = forum and parent_id is null and deleted_at is null));
  perform public.delete_message((select id from public.messages where body = 'Une reponse de moi'));
  perform public.send_message(forum, 'Un nouveau depart', null, 'Nouveau fil');
  reset role;
  if bgkit.badge(2, 'maitre_griot') <> '2|false' then raise exception 'FAIL: progress went down after deletions, got %', bgkit.badge(2, 'maitre_griot'); end if;
  raise notice 'OK 4c: deleting posts never lowers progress';
end $$;

do $$
declare forum uuid; thread bigint;
begin
  select id into forum from public.channels where slug = 'forum' and community_id = (select id from public.communities where slug = 'badge-forum');
  select id into thread from public.messages where author_id = bgkit.uid(2) and channel_id = forum and parent_id is null and deleted_at is null;
  perform bgkit.as_user(2);
  perform public.send_message(forum, 'Je reponds a mon fil', thread);
  perform public.send_message(forum, 'Et encore une', thread);
  reset role;
  -- live count is now 3 (new thread and 2 replies): the goal is reached
  if bgkit.badge(2, 'maitre_griot') <> '3|true' then raise exception 'FAIL: the goal of 3 should unlock, got %', bgkit.badge(2, 'maitre_griot'); end if;
  raise notice 'OK 4d: enough contributions unlock the badge';
end $$;

-- ---- 5. Farming your own empty community does not work ---------------------------------------------------------
do $$
declare c uuid; forum uuid; i int;
begin
  perform bgkit.as_user(4);
  c := public.create_community('badge-solo', 'Badge solo', null, false);
  forum := public.create_channel(c, 'forum', 'Forum', 'forum');
  for i in 1..5 loop
    perform public.send_message(forum, 'Message pour moi-meme ' || i, null, 'Titre ' || i);
  end loop;
  reset role;
  if bgkit.badge(4, 'maitre_griot') <> 'none' then raise exception 'FAIL: posting in a one-person community counted (%)', bgkit.badge(4, 'maitre_griot'); end if;
  raise notice 'OK 5: posts in a community of fewer than 3 people do not count';
end $$;

-- ---- 6. Manual badges ------------------------------------------------------------------------------------------------------
do $$
declare t1 timestamptz; t2 timestamptz;
begin
  perform bgkit.as_user(3);
  perform bgkit.must_fail('member awards themselves a badge', format('select public.award_badge(%L, %L)', bgkit.uid(3), 'champion_du_sahel'), 'permission denied');
  perform bgkit.must_fail('member recounts badges', format('select public.refresh_badges(%L, %L)', bgkit.uid(3), 'quests_solved'), 'permission denied');
  perform bgkit.must_fail('member counts badges', format('select public.badge_metric(%L, %L)', bgkit.uid(3), 'quests_solved'), 'permission denied');
  reset role;
  perform bgkit.as_anon();
  perform bgkit.must_fail('visitor awards a badge', format('select public.award_badge(%L, %L)', bgkit.uid(3), 'champion_du_sahel'), 'permission denied');
  reset role;

  perform bgkit.as_server();
  perform public.award_badge(bgkit.uid(3), 'champion_du_sahel');
  select unlocked_at into t1 from public.user_badges where user_id = bgkit.uid(3) and badge_slug = 'champion_du_sahel';
  perform public.award_badge(bgkit.uid(3), 'champion_du_sahel'); -- twice is harmless
  select unlocked_at into t2 from public.user_badges where user_id = bgkit.uid(3) and badge_slug = 'champion_du_sahel';
  perform bgkit.must_fail('unknown badge', format('select public.award_badge(%L, %L)', bgkit.uid(3), 'inexistant'), 'Badge not found');
  perform bgkit.must_fail('unknown member', $q$select public.award_badge('99999999-9999-9999-9999-999999999999', 'champion_du_sahel')$q$, 'Member not found');
  reset role;
  if t1 is null or t1 <> t2 then raise exception 'FAIL: awarding twice changed the date'; end if;
  raise notice 'OK 6: only the server awards manual badges, once';
end $$;

-- ---- 7. Nobody writes the tables directly; everyone can read -----------------------------------------------------------------
do $$
begin
  perform bgkit.as_user(3);
  perform bgkit.must_fail('direct badge insert', format('insert into public.user_badges (user_id, badge_slug, unlocked_at) values (%L, %L, now())', bgkit.uid(3), 'sceau_securite'), 'permission denied');
  perform bgkit.must_fail('direct progress edit', $q$update public.user_badges set progress = 999, unlocked_at = now()$q$, 'permission denied');
  perform bgkit.must_fail('changing a goal', $q$update public.badge_rules set threshold = 1$q$, 'permission denied');
  reset role;

  perform bgkit.as_anon();
  if (select count(*) from public.badge_rules) <> 7 then raise exception 'FAIL: visitors should read the rules'; end if;
  if bgkit.badge(3, 'champion_du_sahel') = 'none' then raise exception 'FAIL: bgkit helper broken'; end if;
  if (select count(*) from public.user_badges where user_id = bgkit.uid(3)) < 1 then raise exception 'FAIL: visitors should see members'' badges'; end if;
  reset role;
  raise notice 'OK 7: badges are public to read and closed to direct writes';
end $$;

-- ---- Clean up: restore the goals and delete everything this test created --------------------------------------------------------
update public.badge_rules set threshold = 20 where badge_slug = 'l_architecte';
update public.badge_rules set threshold = 128 where badge_slug = 'gardien_du_baobab';
update public.badge_rules set threshold = 100 where badge_slug = 'maitre_griot';

delete from public.communities where slug like 'badge-%';
delete from public.projects where owner_id::text like 'badbadba-%';
delete from public.quests where slug like 'badge-q%';
delete from public.profiles where id::text like 'badbadba-%';
delete from auth.users where id::text like 'badbadba-%';
drop schema bgkit cascade;

do $$
begin
  if (select threshold from public.badge_rules where badge_slug = 'gardien_du_baobab') <> 128 then raise exception 'FAIL: goals were not restored'; end if;
  if exists (select 1 from public.profiles where id::text like 'badbadba-%') then raise exception 'FAIL: test members were not cleaned up'; end if;
  raise notice 'OK 8: goals restored and the test left nothing behind';
end $$;

select 'ALL BADGE TESTS PASSED' as result;
