-- Tests for pinned projects. Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f pinned_projects.test.sql
-- People: ana (1) owns 4 projects; bara (2) is a stranger.

create schema pnk;
grant usage on schema pnk to public;
create function pnk.uid(p_n int) returns uuid language sql immutable as $$ select ('a1b2c3d4-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function pnk.pid(p_n int) returns uuid language sql immutable as $$ select ('a1b2c3d4-2222-0000-0000-00000000000' || p_n)::uuid $$;
create function pnk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', pnk.uid(p_n)::text, true);
end $$;
create function pnk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function pnk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := pnk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (pnk.uid(1), 'ana-pn@exemple.sn', '{"provider":"email"}', '{}'),
  (pnk.uid(2), 'bara-pn@exemple.sn', '{"provider":"email"}', '{}');
insert into public.projects (id, owner_id, github_owner, github_repo, title, verified_at, is_public)
select pnk.pid(n), pnk.uid(1), 'ana-pn', 'depot-' || n, 'Depot PN ' || n, now(), true from generate_series(1, 4) n;

do $$
declare n int;
begin
  perform pnk.as_user(1);
  perform public.set_project_pinned(pnk.pid(1), true);
  perform public.set_project_pinned(pnk.pid(2), true);
  perform public.set_project_pinned(pnk.pid(3), true);
  perform pnk.must_fail('a fourth pin', format('select public.set_project_pinned(%L, true)', pnk.pid(4)), 'at most');
  perform public.set_project_pinned(pnk.pid(1), true); -- pinning twice is harmless
  perform public.set_project_pinned(pnk.pid(3), false);
  perform public.set_project_pinned(pnk.pid(4), true);
  reset role;
  select count(*) into n from public.projects where owner_id = pnk.uid(1) and pinned_at is not null;
  if n <> 3 then raise exception 'FAIL: expected 3 pinned, got %', n; end if;
  raise notice 'OK 1: up to 3 projects can be pinned, and unpinning frees a place';
end $$;

do $$
begin
  perform pnk.as_user(2);
  perform pnk.must_fail('pinning someone else''s project', format('select public.set_project_pinned(%L, true)', pnk.pid(3)), 'Project not found');
  perform pnk.must_fail('writing pinned_at directly', format('update public.projects set pinned_at = now() where id = %L', pnk.pid(3)), 'permission denied');
  reset role;
  set local role anon;
  perform pnk.must_fail('a visitor pins', format('select public.set_project_pinned(%L, true)', pnk.pid(3)), 'permission denied');
  reset role;
  raise notice 'OK 2: only the owner pins';
end $$;

delete from public.projects where github_owner = 'ana-pn';
delete from auth.users where id::text like 'a1b2c3d4-%';
drop schema pnk cascade;
select 'ALL PINNED PROJECT TESTS PASSED' as result;
