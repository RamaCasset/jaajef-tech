-- Tests for removing a project and noticing a missing private repository. Run AFTER all migrations.
-- People: fay (1) owns projects; gor (2) is a stranger.

create schema rpk;
grant usage on schema rpk to public;
create function rpk.uid(p_n int) returns uuid language sql immutable as $$ select ('c9d0e1f2-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function rpk.pid(p_n int) returns uuid language sql immutable as $$ select ('c9d0e1f2-2222-0000-0000-00000000000' || p_n)::uuid $$;
create function rpk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', rpk.uid(p_n)::text, true);
end $$;
create function rpk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function rpk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := rpk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (rpk.uid(1), 'fay-rp@exemple.sn', '{"provider":"email"}', '{}'),
  (rpk.uid(2), 'gor-rp@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set github_username = 'fay-rp' where id = rpk.uid(1);
insert into public.projects (id, owner_id, github_owner, github_repo, title, verified_at, is_public, cover_path) values
  (rpk.pid(1), rpk.uid(1), 'fay-rp', 'ouvert', 'Ouvert', now(), true, rpk.uid(1)::text || '/c9d0e1f2-0000-0000-0000-000000000099.png');
select public.adopt_private_project(rpk.uid(1), 'cache-a', 'Cache A');
select public.adopt_private_project(rpk.uid(1), 'cache-b', 'Cache B');

do $$
declare c text; n int;
begin
  -- 1. Only the owner removes a project; the cover path comes back for cleanup
  perform rpk.as_user(2);
  perform rpk.must_fail('removing someone else''s project', format('select public.remove_project(%L)', rpk.pid(1)), 'Project not found');
  reset role;
  set local role anon;
  perform rpk.must_fail('a visitor removes a project', format('select public.remove_project(%L)', rpk.pid(1)), 'permission denied');
  reset role;
  perform rpk.as_user(1);
  c := public.remove_project(rpk.pid(1));
  reset role;
  if c <> rpk.uid(1)::text || '/c9d0e1f2-0000-0000-0000-000000000099.png' then raise exception 'FAIL: the cover path was not returned, got %', c; end if;
  if exists (select 1 from public.projects where id = rpk.pid(1)) then raise exception 'FAIL: the project is still there'; end if;
  raise notice 'OK 1: only the owner removes a project';

  -- 2. Missing private repositories are noticed, and cleared when they come back
  perform rpk.as_user(1);
  perform rpk.must_fail('a member reports a missing repository', format('select public.sync_private_presence(%L, %L)', rpk.uid(1), '{}'::text[]), 'permission denied');
  reset role;
  perform public.sync_private_presence(rpk.uid(1), array['Cache-A']);
  select count(*) into n from public.projects where owner_id = rpk.uid(1) and repo_missing_at is not null and github_repo = 'cache-b';
  if n <> 1 then raise exception 'FAIL: the missing repository was not noticed'; end if;
  if (select repo_missing_at from public.projects where github_repo = 'cache-a' and owner_id = rpk.uid(1)) is not null then
    raise exception 'FAIL: a visible repository was flagged (letter case must not matter)';
  end if;
  perform public.sync_private_presence(rpk.uid(1), array['cache-a', 'cache-b']);
  if exists (select 1 from public.projects where owner_id = rpk.uid(1) and repo_missing_at is not null) then
    raise exception 'FAIL: a repository that came back is still flagged';
  end if;
  -- another member's projects are never touched
  perform public.adopt_private_project(rpk.uid(1), 'cache-c', 'Cache C');
  perform public.sync_private_presence(rpk.uid(2), '{}'::text[]);
  if exists (select 1 from public.projects where github_repo = 'cache-c' and repo_missing_at is not null) then
    raise exception 'FAIL: another member''s report changed this project';
  end if;
  raise notice 'OK 2: missing private repositories are flagged and cleared';
end $$;

delete from public.projects where github_owner = 'fay-rp';
delete from auth.users where id::text like 'c9d0e1f2-%';
drop schema rpk cascade;
select 'ALL REMOVE PROJECT TESTS PASSED' as result;
