-- Tests for the project rooms. Run AFTER all migrations.
-- People: kady (1) owns the project; lamine (2) collaborates; mame (3) is a stranger.

create schema prm;
grant usage on schema prm to public;
create function prm.uid(p_n int) returns uuid language sql immutable as $$ select ('f2a3b4c5-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function prm.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function prm.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := prm.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (prm.uid(1), 'kady-pr@exemple.sn', '{"provider":"email"}', '{}'),
  (prm.uid(2), 'lamine-pr@exemple.sn', '{"provider":"email"}', '{}'),
  (prm.uid(3), 'mame-pr@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set username = 'kady_pr' where id = prm.uid(1);
update public.profiles set username = 'lamine_pr' where id = prm.uid(2);
update public.profiles set username = 'mame_pr' where id = prm.uid(3);
insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public)
values (prm.uid(1), 'kady-pr', 'appli', 'Mon appli', now(), true);
insert into public.project_collaborators (project_id, user_id)
select id, prm.uid(2) from public.projects where github_owner = 'kady-pr';

do $$
declare p uuid; room uuid; room2 uuid; n int; ch uuid;
begin
  select id into p from public.projects where github_owner = 'kady-pr';

  -- 1. Only the owner can open the room
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', prm.uid(2)::text, true);
  perform prm.must_fail('a collaborator opening the room', format('select public.open_project_room(%L)', p), 'Only the owner');
  perform set_config('request.jwt.claim.sub', prm.uid(3)::text, true);
  perform prm.must_fail('a stranger opening the room', format('select public.open_project_room(%L)', p), 'Only the owner');
  perform prm.must_fail('an unknown project', format('select public.open_project_room(%L)', gen_random_uuid()), 'Only the owner');
  reset role;
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  perform prm.must_fail('anonymous opening the room', format('select public.open_project_room(%L)', p), 'permission denied');
  reset role;
  raise notice 'OK 1: only the owner opens the room';

  -- 2. The owner opens it: a private, unlisted room with two channels, the owner and the collaborator inside
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', prm.uid(1)::text, true);
  room := public.open_project_room(p);
  room2 := public.open_project_room(p);
  reset role;
  if room is null or room <> room2 then raise exception 'FAIL: opening twice gave two rooms'; end if;
  if not (select is_private and not is_listed and project_id = p and owner_id = prm.uid(1) from public.communities where id = room) then
    raise exception 'FAIL: the room is not private, unlisted and linked to the project';
  end if;
  select count(*) into n from public.channels where community_id = room;
  if n <> 2 then raise exception 'FAIL: % channels', n; end if;
  select count(*) into n from public.community_members where community_id = room;
  if n <> 2 then raise exception 'FAIL: % members, expected owner and collaborator', n; end if;
  if (select role from public.community_members where community_id = room and user_id = prm.uid(2)) <> 'member' then
    raise exception 'FAIL: the collaborator is not a plain member';
  end if;
  raise notice 'OK 2: the room is private, unlisted, with the owner and the collaborator';

  -- 3. A stranger cannot see it, a member can; the team can write
  select id into ch from public.channels where community_id = room and slug = 'general';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', prm.uid(3)::text, true);
  select count(*) into n from public.communities where id = room;
  if n <> 0 then raise exception 'FAIL: a stranger can see the room'; end if;
  perform prm.must_fail('a stranger writing', format('select public.send_message(%L, %L)', ch, 'coucou'), 'not in this community');
  perform set_config('request.jwt.claim.sub', prm.uid(2)::text, true);
  select count(*) into n from public.communities where id = room;
  if n <> 1 then raise exception 'FAIL: the collaborator cannot see the room'; end if;
  perform public.send_message(ch, 'Salut l''équipe');
  reset role;
  raise notice 'OK 3: only the team can read and write';

  -- 4. A new collaborator joins the room; a removed one leaves it; the owner never does
  insert into public.project_collaborators (project_id, user_id) values (p, prm.uid(3));
  if not exists (select 1 from public.community_members where community_id = room and user_id = prm.uid(3)) then
    raise exception 'FAIL: a new collaborator did not join the room';
  end if;
  delete from public.project_collaborators where project_id = p and user_id = prm.uid(3);
  if exists (select 1 from public.community_members where community_id = room and user_id = prm.uid(3)) then
    raise exception 'FAIL: a removed collaborator is still in the room';
  end if;
  delete from public.project_collaborators where project_id = p and user_id = prm.uid(2);
  if exists (select 1 from public.community_members where community_id = room and user_id = prm.uid(2)) then
    raise exception 'FAIL: the removed collaborator is still in the room';
  end if;
  if not exists (select 1 from public.community_members where community_id = room and user_id = prm.uid(1) and role = 'owner') then
    raise exception 'FAIL: the owner is no longer in the room';
  end if;
  raise notice 'OK 4: the room follows the collaborators';

  -- 5. The room does not show in the public list of communities, and goes away with the project
  select count(*) into n from public.communities where project_id = p and is_listed;
  if n <> 0 then raise exception 'FAIL: the room is listed'; end if;
  delete from public.projects where id = p;
  if exists (select 1 from public.communities where id = room) then raise exception 'FAIL: the room outlived its project'; end if;
  raise notice 'OK 5: unlisted, and removed with the project';
end $$;
