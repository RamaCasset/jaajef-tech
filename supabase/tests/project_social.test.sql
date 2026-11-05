-- Tests for the project social migration (stars, comments, ask to collaborate).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f project_social.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
-- Everything this test creates is deleted at the end.
--
-- People: ona (...1) owns the projects; paul (...2), rama (...3) and sidy (...4) are other members.

create schema pskit;
grant usage on schema pskit to public;

create function pskit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('b7b7b7b7-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function pskit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', pskit.uid(p_n)::text, true);
end $$;

create function pskit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pskit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pskit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := pskit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function pskit.proj(p_repo text) returns uuid
language sql stable security definer as $$ select id from public.projects where github_repo = p_repo $$;

create function pskit.stars(p_repo text) returns int
language sql stable security definer as $$
  select coalesce((select star_count from public.project_stats where project_id = pskit.proj(p_repo)), 0)
$$;

create function pskit.comments(p_repo text) returns int
language sql stable security definer as $$
  select coalesce((select comment_count from public.project_stats where project_id = pskit.proj(p_repo)), 0)
$$;

create function pskit.comment_id(p_body text) returns bigint
language sql stable security definer as $$ select id from public.project_comments where body = p_body order by id limit 1 $$;

create function pskit.req(p_requester int, p_repo text) returns uuid
language sql stable security definer as $$
  select id from public.collab_requests where requester_id = pskit.uid(p_requester) and project_id = pskit.proj(p_repo) and status = 'pending'
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (pskit.uid(1), 'ona@exemple.sn', '{"provider":"email"}', '{}'),
  (pskit.uid(2), 'paul@exemple.sn', '{"provider":"email"}', '{}'),
  (pskit.uid(3), 'rama@exemple.sn', '{"provider":"email"}', '{}'),
  (pskit.uid(4), 'sidy@exemple.sn', '{"provider":"email"}', '{}');

insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public) values
  (pskit.uid(1), 'ona-dev', 'ps-listed', 'Projet liste', now(), true),
  (pskit.uid(1), 'ona-dev', 'ps-pending', 'Projet en attente', null, true),
  (pskit.uid(1), 'ona-dev', 'ps-private', 'Projet cache', now(), false),
  (pskit.uid(2), 'paul-dev', 'ps-paul', 'Projet de Paul', now(), true);

-- ---- 1. Stars -----------------------------------------------------------------------------------------------
do $$
begin
  perform pskit.as_user(2);
  perform public.star_project(pskit.proj('ps-listed'));
  perform public.star_project(pskit.proj('ps-listed')); -- a second tap changes nothing
  reset role;
  if pskit.stars('ps-listed') <> 1 then raise exception 'FAIL: one member, two taps, should be 1 star, got %', pskit.stars('ps-listed'); end if;

  perform pskit.as_user(3);
  perform public.star_project(pskit.proj('ps-listed'));
  reset role;
  if pskit.stars('ps-listed') <> 2 then raise exception 'FAIL: expected 2 stars'; end if;

  perform pskit.as_user(1);
  perform pskit.must_fail('starring your own project', format('select public.star_project(%L)', pskit.proj('ps-listed')), 'your own');
  reset role;

  perform pskit.as_user(2);
  perform pskit.must_fail('starring a pending project', format('select public.star_project(%L)', pskit.proj('ps-pending')), 'not found');
  perform pskit.must_fail('starring a private project', format('select public.star_project(%L)', pskit.proj('ps-private')), 'not found');
  perform pskit.must_fail('starring a project that does not exist', format('select public.star_project(%L)', gen_random_uuid()), 'not found');
  reset role;

  perform pskit.as_anon();
  perform pskit.must_fail('a visitor stars', format('select public.star_project(%L)', pskit.proj('ps-listed')), 'permission denied');
  if (select star_count from public.project_stats where project_id = pskit.proj('ps-listed')) <> 2 then raise exception 'FAIL: visitors should see the star count'; end if;
  reset role;
  raise notice 'OK 1a: members can star a listed project once; not their own, not hidden ones; the count is public';
end $$;

do $$
begin
  perform pskit.as_user(2);
  if (select count(*) from public.project_stars) <> 1 then raise exception 'FAIL: paul should see only his own star'; end if;
  perform public.unstar_project(pskit.proj('ps-listed'));
  perform public.unstar_project(pskit.proj('ps-listed')); -- harmless
  if (select count(*) from public.project_stars) <> 0 then raise exception 'FAIL: unstar did not work'; end if;
  reset role;
  if pskit.stars('ps-listed') <> 1 then raise exception 'FAIL: the count should drop to 1, got %', pskit.stars('ps-listed'); end if;

  perform pskit.as_user(1); -- the owner cannot see who starred
  if (select count(*) from public.project_stars) <> 0 then raise exception 'FAIL: the owner sees who starred'; end if;
  perform pskit.must_fail('editing the star count', format('update public.project_stats set star_count = 999 where project_id = %L', pskit.proj('ps-listed')), 'permission denied');
  perform pskit.must_fail('adding a star directly', format('insert into public.project_stars (project_id, user_id) values (%L, %L)', pskit.proj('ps-listed'), pskit.uid(1)), 'permission denied');
  reset role;
  raise notice 'OK 1b: unstar works, who starred is private, counts cannot be edited';
end $$;

-- ---- 2. Comments ------------------------------------------------------------------------------------------------
do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(2);
  perform public.post_project_comment(p, 'Super projet');
  perform pskit.must_fail('empty comment', format('select public.post_project_comment(%L, %L)', p, '   '), 'Write something');
  perform pskit.must_fail('comment of 1001 characters', format('select public.post_project_comment(%L, %L)', p, repeat('x', 1001)), 'too long');
  perform pskit.must_fail('comment on a pending project', format('select public.post_project_comment(%L, %L)', pskit.proj('ps-pending'), 'salut'), 'not found');
  perform pskit.must_fail('comment on a private project', format('select public.post_project_comment(%L, %L)', pskit.proj('ps-private'), 'salut'), 'not found');
  reset role;
  perform pskit.as_user(3);
  perform public.post_project_comment(p, 'Merci pour le partage');
  reset role;
  if pskit.comments('ps-listed') <> 2 then raise exception 'FAIL: expected a count of 2 comments'; end if;

  perform pskit.as_anon();
  if (select count(*) from public.project_comments where project_id = p) <> 2 then raise exception 'FAIL: visitors should read comments on a listed project'; end if;
  if (select count(*) from public.project_comments where project_id = pskit.proj('ps-pending')) <> 0 then raise exception 'FAIL: visitors saw comments of a pending project'; end if;
  perform pskit.must_fail('a visitor comments', format('select public.post_project_comment(%L, %L)', p, 'hello'), 'permission denied');
  perform pskit.must_fail('a direct comment insert', format('insert into public.project_comments (project_id, author_id, body) values (%L, %L, %L)', p, pskit.uid(2), 'x'), 'permission denied');
  reset role;
  raise notice 'OK 2a: members comment on listed projects; everyone can read them; hidden projects take none';
end $$;

do $$
declare p uuid := pskit.proj('ps-listed'); c bigint := pskit.comment_id('Super projet');
begin
  perform pskit.as_user(2);
  perform public.edit_project_comment(c, 'Super projet, bravo');
  reset role;
  if (select edited_at from public.project_comments where id = c) is null then raise exception 'FAIL: the edit was not marked'; end if;

  perform pskit.as_user(3);
  perform pskit.must_fail('editing someone else''s comment', format('select public.edit_project_comment(%L, %L)', c, 'pirate'), 'not found');
  perform pskit.must_fail('deleting someone else''s comment', format('select public.delete_project_comment(%L)', c), 'only delete');
  perform pskit.must_fail('direct edit of a comment', format('update public.project_comments set body = %L where id = %L', 'pirate', c), 'permission denied');
  reset role;

  perform pskit.as_user(1); -- the project owner removes a comment on their project
  perform public.delete_project_comment(c);
  reset role;
  if pskit.comments('ps-listed') <> 1 then raise exception 'FAIL: the count should be 1 after the owner deletes, got %', pskit.comments('ps-listed'); end if;

  perform pskit.as_user(3); -- an author removes their own
  perform public.delete_project_comment(pskit.comment_id('Merci pour le partage'));
  perform pskit.must_fail('deleting a comment twice', format('select public.delete_project_comment(%L)', c), 'not found');
  reset role;
  if pskit.comments('ps-listed') <> 0 then raise exception 'FAIL: the count should be 0'; end if;
  raise notice 'OK 2b: authors edit and delete their own; the project owner can delete any; others cannot';
end $$;

update public.game_config set value = '2' where key = 'project_comment_max_per_hour';

do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(4);
  perform public.post_project_comment(p, 'un');
  perform public.post_project_comment(p, 'deux');
  perform pskit.must_fail('third comment within the hour', format('select public.post_project_comment(%L, %L)', p, 'trois'), 'too fast');
  reset role;
  raise notice 'OK 2c: comments are limited per hour';
end $$;

update public.game_config set value = '20' where key = 'project_comment_max_per_hour';

-- ---- 3. Ask to collaborate --------------------------------------------------------------------------------------------
do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(2);
  perform pskit.must_fail('asking an owner who is not available', format('select public.request_collaboration(%L, %L)', p, 'Je peux aider'), 'not looking');
  reset role;

  perform pskit.as_user(1);
  update public.profiles set available_to_collab = true where id = pskit.uid(1);
  perform pskit.must_fail('asking to collaborate on your own project', format('select public.request_collaboration(%L, %L)', p, 'moi'), 'your own');
  reset role;

  perform pskit.as_user(2);
  perform pskit.must_fail('empty message', format('select public.request_collaboration(%L, %L)', p, '  '), 'short message');
  perform pskit.must_fail('message of 501 characters', format('select public.request_collaboration(%L, %L)', p, repeat('x', 501)), 'short message');
  perform pskit.must_fail('asking on a pending project', format('select public.request_collaboration(%L, %L)', pskit.proj('ps-pending'), 'salut'), 'not found');
  perform public.request_collaboration(p, 'Je peux aider sur le frontend');
  perform pskit.must_fail('a second request while one waits', format('select public.request_collaboration(%L, %L)', p, 'encore'), 'already have a request');
  reset role;

  perform pskit.as_anon();
  perform pskit.must_fail('a visitor asks', format('select public.request_collaboration(%L, %L)', p, 'hello'), 'permission denied');
  reset role;
  raise notice 'OK 3a: a request needs an available owner, a listed project and a short message; one waiting request at a time';
end $$;

do $$
begin
  perform pskit.as_user(2); -- the requester sees theirs
  if (select count(*) from public.collab_requests) <> 1 then raise exception 'FAIL: the requester should see their request'; end if;
  reset role;
  perform pskit.as_user(1); -- the owner sees it
  if (select count(*) from public.collab_requests) <> 1 then raise exception 'FAIL: the owner should see the request'; end if;
  reset role;
  perform pskit.as_user(3); -- other members do not
  if (select count(*) from public.collab_requests) <> 0 then raise exception 'FAIL: a stranger sees a request'; end if;
  perform pskit.must_fail('editing a request directly', $q$update public.collab_requests set status = 'accepted'$q$, 'permission denied');
  perform pskit.must_fail('answering a request as a stranger', format('select public.decide_collab_request(%L, true)', pskit.req(2, 'ps-listed')), 'Only the project owner');
  reset role;
  perform pskit.as_anon();
  perform pskit.must_fail('a visitor reads requests', 'select count(*) from public.collab_requests', 'permission denied');
  reset role;
  raise notice 'OK 3b: only the requester and the owner see a request; only the owner can answer';
end $$;

do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(1);
  perform public.decide_collab_request(pskit.req(2, 'ps-listed'), false);
  perform pskit.must_fail('answering twice', format('select public.decide_collab_request(%L, true)', (select id from public.collab_requests where requester_id = pskit.uid(2))), 'already been answered');
  reset role;

  perform pskit.as_user(2);
  perform pskit.must_fail('asking again right after a decline', format('select public.request_collaboration(%L, %L)', p, 'svp'), 'ask again later');
  reset role;

  -- after the waiting time, asking is possible again
  update public.collab_requests set decided_at = now() - interval '8 days' where requester_id = pskit.uid(2);
end $$;

do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(2);
  perform public.request_collaboration(p, 'Je retente ma chance');
  reset role;
  perform pskit.as_user(1);
  perform public.decide_collab_request(pskit.req(2, 'ps-listed'), true);
  reset role;

  perform pskit.as_anon(); -- the collaborator list is public
  if (select count(*) from public.project_collaborators where project_id = p) <> 1 then raise exception 'FAIL: visitors should see the collaborator'; end if;
  reset role;

  perform pskit.as_user(2);
  perform pskit.must_fail('asking when already a collaborator', format('select public.request_collaboration(%L, %L)', p, 'encore'), 'already collaborate');
  reset role;
  raise notice 'OK 3c: a declined request has a cool-down; an accepted one adds a public collaborator';
end $$;

do $$
declare p uuid := pskit.proj('ps-listed');
begin
  -- withdrawing
  perform pskit.as_user(3);
  perform public.request_collaboration(p, 'Moi aussi');
  reset role;
  perform pskit.as_user(2);
  perform pskit.must_fail('withdrawing someone else''s request', format('select public.withdraw_collab_request(%L)', pskit.req(3, 'ps-listed')), 'No waiting request');
  reset role;
  perform pskit.as_user(3);
  perform public.withdraw_collab_request(pskit.req(3, 'ps-listed'));
  perform pskit.must_fail('withdrawing twice', format('select public.withdraw_collab_request(%L)', (select id from public.collab_requests where requester_id = pskit.uid(3))), 'No waiting request');
  perform public.request_collaboration(p, 'Je reviens'); -- a withdrawn request has no cool-down
  reset role;

  -- removing collaborators
  perform pskit.as_user(3);
  perform pskit.must_fail('removing someone else', format('select public.remove_collaborator(%L, %L)', p, pskit.uid(2)), 'Only the owner');
  reset role;
  perform pskit.as_user(2); -- a collaborator leaves by themselves
  perform public.remove_collaborator(p, pskit.uid(2));
  perform pskit.must_fail('leaving twice', format('select public.remove_collaborator(%L, %L)', p, pskit.uid(2)), 'not a collaborator');
  reset role;
  perform pskit.as_user(1); -- the owner can answer then remove
  perform public.decide_collab_request(pskit.req(3, 'ps-listed'), true);
  perform public.remove_collaborator(p, pskit.uid(3));
  reset role;
  perform pskit.as_user(3);
  perform pskit.must_fail('direct collaborator insert', format('insert into public.project_collaborators (project_id, user_id) values (%L, %L)', p, pskit.uid(3)), 'permission denied');
  reset role;
  raise notice 'OK 3d: requests can be withdrawn; collaborators can leave or be removed by the owner';
end $$;

-- limits
update public.game_config set value = '1' where key = 'project_max_collaborators';

do $$
declare p uuid := pskit.proj('ps-listed');
begin
  perform pskit.as_user(2);
  perform public.request_collaboration(p, 'Bis');
  reset role;
  perform pskit.as_user(3);
  perform public.request_collaboration(p, 'Ter');
  reset role;
  perform pskit.as_user(1);
  perform public.decide_collab_request(pskit.req(2, 'ps-listed'), true);
  perform pskit.must_fail('more collaborators than allowed', format('select public.decide_collab_request(%L, true)', pskit.req(3, 'ps-listed')), 'most collaborators');
  perform public.decide_collab_request(pskit.req(3, 'ps-listed'), false);
  reset role;
  raise notice 'OK 3e: a project has a limit on collaborators';
end $$;

update public.game_config set value = '10' where key = 'project_max_collaborators';
update public.game_config set value = '1' where key = 'collab_max_pending_per_member';

do $$
begin
  update public.profiles set available_to_collab = true where id = pskit.uid(2);
  perform pskit.as_user(4);
  perform public.request_collaboration(pskit.proj('ps-listed'), 'Un');
  perform pskit.must_fail('too many waiting requests for one member', format('select public.request_collaboration(%L, %L)', pskit.proj('ps-paul'), 'Deux'), 'too many requests waiting');
  reset role;
  raise notice 'OK 3f: a member can only have a few requests waiting';
end $$;

update public.game_config set value = '10' where key = 'collab_max_pending_per_member';
update public.game_config set value = '1' where key = 'collab_max_pending_per_project';

do $$
begin
  -- sidy's request for ps-listed still waits; the project is full for newcomers
  update public.collab_requests set decided_at = now() - interval '8 days' where status = 'declined';
  perform pskit.as_user(3);
  perform pskit.must_fail('too many waiting requests on one project', format('select public.request_collaboration(%L, %L)', pskit.proj('ps-listed'), 'Trop'), 'too many requests waiting');
  reset role;
  raise notice 'OK 3g: a project can only have a few requests waiting';
end $$;

update public.game_config set value = '20' where key = 'collab_max_pending_per_project';

-- ---- 4. Deleting a project cleans up ---------------------------------------------------------------------------------
do $$
begin
  perform pskit.as_user(1);
  perform public.delete_project(pskit.proj('ps-listed'));
  reset role;
end $$;

do $$
begin
  if exists (select 1 from public.project_comments where author_id::text like 'b7b7b7b7-%') then raise exception 'FAIL: comments left after the project was deleted'; end if;
  if exists (select 1 from public.collab_requests where requester_id::text like 'b7b7b7b7-%') then raise exception 'FAIL: requests left after the project was deleted'; end if;
  if exists (select 1 from public.project_collaborators where user_id::text like 'b7b7b7b7-%') then raise exception 'FAIL: collaborators left after the project was deleted'; end if;
  raise notice 'OK 4: deleting a project removes its stars, comments, requests and collaborators';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.projects where owner_id::text like 'b7b7b7b7-%';
delete from public.profiles where id::text like 'b7b7b7b7-%';
delete from auth.users where id::text like 'b7b7b7b7-%';
drop schema pskit cascade;

do $$
begin
  if exists (select 1 from public.project_stats) then raise exception 'FAIL: counts left behind'; end if;
  if exists (select 1 from public.project_stars) or exists (select 1 from public.project_comments) or exists (select 1 from public.collab_requests) then
    raise exception 'FAIL: social rows left behind';
  end if;
  raise notice 'OK 5: the test left nothing behind';
end $$;

select 'ALL PROJECT SOCIAL TESTS PASSED' as result;
