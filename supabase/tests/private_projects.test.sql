-- Tests for private projects. Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f private_projects.test.sql
-- People: dia (1) has a linked GitHub name; eli (2) is a stranger.

create schema ppk;
grant usage on schema ppk to public;
create function ppk.uid(p_n int) returns uuid language sql immutable as $$ select ('b7c8d9e0-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function ppk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', ppk.uid(p_n)::text, true);
end $$;
create function ppk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function ppk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := ppk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (ppk.uid(1), 'dia-pp@exemple.sn', '{"provider":"email"}', '{}'),
  (ppk.uid(2), 'eli-pp@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set github_username = 'dia-pp' where id = ppk.uid(1);

do $$
declare p uuid; n int; r record;
begin
  -- 1. Only the server adds a private project
  perform ppk.as_user(1);
  perform ppk.must_fail('a member adds a private project directly', format('select public.adopt_private_project(%L, %L, %L)', ppk.uid(1), 'secret', 'Secret'), 'permission denied');
  reset role;
  set local role anon;
  perform ppk.must_fail('a visitor adds a private project', format('select public.adopt_private_project(%L, %L, %L)', ppk.uid(1), 'secret', 'Secret'), 'permission denied');
  reset role;

  p := public.adopt_private_project(ppk.uid(1), 'secret', 'Secret', 'Un projet prive', 'Python');
  select * into r from public.projects where id = p;
  if r.is_public or not r.repo_private or r.verified_at is null or r.github_owner <> 'dia-pp' or r.language <> 'Python' then
    raise exception 'FAIL: the private project was not stored as private and confirmed';
  end if;
  perform ppk.must_fail('the same repository twice', format('select public.adopt_private_project(%L, %L, %L)', ppk.uid(1), 'secret', 'Secret'), 'already listed');
  perform ppk.must_fail('a member with no GitHub name', format('select public.adopt_private_project(%L, %L, %L)', ppk.uid(2), 'secret', 'Secret'), 'Connect your GitHub');
  perform ppk.must_fail('a bad repository name', format('select public.adopt_private_project(%L, %L, %L)', ppk.uid(1), 'bad name', 'x'), 'Invalid repository name');
  raise notice 'OK 1: only the server adds a private project, stored private';

  -- 2. Visibility: the owner sees it, a stranger does not, the community search does not
  perform ppk.as_user(1);
  select count(*) into n from public.projects where id = p;
  if n <> 1 then raise exception 'FAIL: the owner cannot see their private project'; end if;
  reset role;
  perform ppk.as_user(2);
  select count(*) into n from public.projects where id = p;
  if n <> 0 then raise exception 'FAIL: a stranger sees a private project'; end if;
  select count(*) into n from public.search_projects() where project_id = p;
  if n <> 0 then raise exception 'FAIL: a private project is in the community search'; end if;
  reset role;
  raise notice 'OK 2: private stays hidden from others';

  -- 3. It can never be made public, and the public checker skips it
  perform ppk.as_user(1);
  perform ppk.must_fail('making a private repository public', format('select public.update_project(%L, p_is_public => true)', p), 'cannot be made public');
  perform public.update_project(p, p_title => 'Secret 2');
  reset role;
  begin
    update public.projects set is_public = true where id = p;
    raise exception 'FAIL: the database let a private project become public';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.projects_to_sync(200) where project_id = p) then
    raise exception 'FAIL: the public checker would look at a private repository';
  end if;
  raise notice 'OK 3: never public, never sent to the public checker';

  -- 4. When the repository becomes public on GitHub, the project joins the community list and is rewarded once
  perform ppk.as_user(1);
  perform ppk.must_fail('a member runs the private check', format('select public.record_private_check(%L, true, %L)', p, 'dia-pp'), 'permission denied');
  reset role;
  update public.projects set github_synced_at = now() - interval '2 days' where id = p;
  if not exists (select 1 from public.private_projects_to_check(10) where project_id = p) then raise exception 'FAIL: the private project is not due for a check'; end if;
  if public.record_private_check(p, false) then raise exception 'FAIL: still private but reported as public'; end if;
  if exists (select 1 from public.private_projects_to_check(10) where project_id = p) then raise exception 'FAIL: a just-checked private project is listed again'; end if;
  if public.record_private_check(p, true, 'someone-else') then raise exception 'FAIL: a repository of another owner turned the project public'; end if;
  if not (select repo_private from public.projects where id = p) then raise exception 'FAIL: the project left private on a wrong owner'; end if;

  if not public.record_private_check(p, true, 'Dia-PP') then raise exception 'FAIL: the project did not turn public'; end if;
  select * into r from public.projects where id = p;
  if r.repo_private or not r.is_public or r.verified_at is not null or r.github_synced_at is not null then
    raise exception 'FAIL: a project turned public must wait for the usual check';
  end if;
  if not exists (select 1 from public.projects_to_sync(200) where project_id = p) then raise exception 'FAIL: the usual check will not pick it up'; end if;
  perform public.record_github_sync(p, true, 'dia-pp', 'Un projet prive', 'Python', 2);
  select count(*) into n from public.xp_events where user_id = ppk.uid(1) and reason = 'project_published';
  if n <> 1 then raise exception 'FAIL: expected one reward, got %', n; end if;
  if (select verified_at from public.projects where id = p) is null then raise exception 'FAIL: not confirmed'; end if;
  if public.record_private_check(p, true, 'dia-pp') then raise exception 'FAIL: a public project was handled as private'; end if;
  raise notice 'OK 4: private turned public is confirmed and rewarded once';
end $$;

delete from public.projects where github_owner = 'dia-pp';
delete from auth.users where id::text like 'b7c8d9e0-%';
drop schema ppk cascade;
select 'ALL PRIVATE PROJECT TESTS PASSED' as result;
