-- Tests for collaborators on private projects. Run AFTER all migrations.
-- People: haby (1) owns a private and a public project; ibou (2) is added; jaly (3) is a stranger.

create schema cpk;
grant usage on schema cpk to public;
create function cpk.uid(p_n int) returns uuid language sql immutable as $$ select ('d0e1f2a3-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function cpk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', cpk.uid(p_n)::text, true);
end $$;
create function cpk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function cpk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := cpk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (cpk.uid(1), 'haby-cp@exemple.sn', '{"provider":"email"}', '{}'),
  (cpk.uid(2), 'ibou-cp@exemple.sn', '{"provider":"email"}', '{}'),
  (cpk.uid(3), 'jaly-cp@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set github_username = 'haby-cp', available_to_collab = true where id = cpk.uid(1);
update public.profiles set username = 'ibou_cp' where id = cpk.uid(2);
update public.profiles set username = 'jaly_cp' where id = cpk.uid(3);
select public.adopt_private_project(cpk.uid(1), 'secret', 'Secret') as private_id \gset
insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public)
values (cpk.uid(1), 'haby-cp', 'ouvert', 'Ouvert', now(), true);

do $$
declare p uuid; q uuid; n int;
begin
  select id into p from public.projects where github_repo = 'secret' and github_owner = 'haby-cp';
  select id into q from public.projects where github_repo = 'ouvert' and github_owner = 'haby-cp';

  -- 1. Only the owner adds, by username (any letter case), with clear refusals
  perform cpk.as_user(3);
  perform cpk.must_fail('a stranger adds a collaborator', format('select public.add_collaborator(%L, %L)', p, 'jaly_cp'), 'Project not found');
  reset role;
  set local role anon;
  perform cpk.must_fail('a visitor adds a collaborator', format('select public.add_collaborator(%L, %L)', p, 'ibou_cp'), 'permission denied');
  reset role;
  perform cpk.as_user(1);
  perform cpk.must_fail('an unknown username', format('select public.add_collaborator(%L, %L)', p, 'personne'), 'No member with this username');
  perform cpk.must_fail('adding yourself', format('select public.add_collaborator(%L, %L)', p, (select username from public.profiles where id = cpk.uid(1))), 'already the owner');
  if public.add_collaborator(p, ' IBOU_CP ') <> cpk.uid(2) then raise exception 'FAIL: wrong person added'; end if;
  perform cpk.must_fail('adding twice', format('select public.add_collaborator(%L, %L)', p, 'ibou_cp'), 'already a collaborator');
  reset role;
  raise notice 'OK 1: only the owner adds a collaborator by username';

  -- 2. The private project is visible to the owner and the collaborator, nobody else
  perform cpk.as_user(2);
  select count(*) into n from public.projects where id = p;
  if n <> 1 then raise exception 'FAIL: the collaborator cannot see the private project'; end if;
  select count(*) into n from public.project_collaborators where project_id = p;
  if n <> 1 then raise exception 'FAIL: the collaborator cannot see the collaborator list'; end if;
  reset role;
  perform cpk.as_user(3);
  select count(*) into n from public.projects where id = p;
  if n <> 0 then raise exception 'FAIL: a stranger sees the private project'; end if;
  select count(*) into n from public.project_collaborators where project_id = p;
  if n <> 0 then raise exception 'FAIL: a stranger sees the collaborator list of a private project'; end if;
  reset role;
  set local role anon;
  select count(*) into n from public.projects where id = p;
  if n <> 0 then raise exception 'FAIL: a visitor sees the private project'; end if;
  select count(*) into n from public.project_collaborators where project_id = p;
  if n <> 0 then raise exception 'FAIL: a visitor sees the collaborators of a private project'; end if;
  reset role;
  perform cpk.as_user(2);
  select count(*) into n from public.search_projects() where project_id = p;
  if n <> 0 then raise exception 'FAIL: the private project is in the community search for its collaborator'; end if;
  reset role;
  raise notice 'OK 2: private stays private, except for its members';

  -- 3. A collaborator has no owner powers
  perform cpk.as_user(2);
  perform cpk.must_fail('a collaborator adds someone', format('select public.add_collaborator(%L, %L)', p, 'jaly_cp'), 'Project not found');
  perform cpk.must_fail('a collaborator edits the project', format('select public.update_project(%L, p_title => %L)', p, 'Pris'), 'Project not found');
  perform cpk.must_fail('a collaborator removes the project', format('select public.remove_project(%L)', p), 'Project not found');
  perform cpk.must_fail('a collaborator removes another person', format('select public.remove_collaborator(%L, %L)', p, cpk.uid(1)), 'Only the owner');
  reset role;
  raise notice 'OK 3: a collaborator has no owner powers';

  -- 4. A waiting request is answered when the owner adds the person; the collaborator can leave
  perform cpk.as_user(3);
  perform public.request_collaboration(q, 'Je veux aider');
  reset role;
  perform cpk.as_user(1);
  perform public.add_collaborator(q, 'jaly_cp');
  reset role;
  if exists (select 1 from public.collab_requests where project_id = q and requester_id = cpk.uid(3) and status = 'pending') then
    raise exception 'FAIL: the request is still waiting';
  end if;
  perform cpk.as_user(2);
  perform public.remove_collaborator(p, cpk.uid(2));
  select count(*) into n from public.projects where id = p;
  if n <> 0 then raise exception 'FAIL: someone who left still sees the private project'; end if;
  reset role;
  raise notice 'OK 4: requests are answered, and leaving removes access';
end $$;

delete from public.projects where github_owner = 'haby-cp';
delete from auth.users where id::text like 'd0e1f2a3-%';
drop schema cpk cascade;
select 'ALL PRIVATE COLLABORATOR TESTS PASSED' as result;
