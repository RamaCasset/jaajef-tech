-- Tests for the project showcase (region, demo link, cover, forks, contributors). Run AFTER all migrations.
-- psql -v ON_ERROR_STOP=1 -f project_showcase.test.sql
-- People: ana (1) owns the project, region dakar; bara (2) collaborator, region thies; coumba (3) stranger.

create schema psk;
grant usage on schema psk to public;
create function psk.uid(p_n int) returns uuid language sql immutable as $$ select ('f6a7b8c9-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function psk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', psk.uid(p_n)::text, true);
end $$;
create function psk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function psk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := psk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;
create function psk.cover(p_n int, p_k int, p_ext text default 'png') returns text language sql immutable as $$
  select psk.uid(p_n)::text || '/0000000' || p_k || '-0000-0000-0000-000000000000.' || p_ext
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (psk.uid(1), 'ana-ps@exemple.sn', '{"provider":"email"}', '{}'),
  (psk.uid(2), 'bara-ps@exemple.sn', '{"provider":"email"}', '{}'),
  (psk.uid(3), 'coumba-ps@exemple.sn', '{"provider":"email"}', '{}');
insert into public.projects (id, owner_id, github_owner, github_repo, title, verified_at, is_public) values
  ('f6a7b8c9-1111-0000-0000-000000000001', psk.uid(1), 'ana-ps', 'vitrine', 'Vitrine PS', now(), true),
  ('f6a7b8c9-1111-0000-0000-000000000002', psk.uid(1), 'ana-ps', 'cache', 'Cache PS', null, true);

do $$
begin
  perform psk.as_user(1);
  update public.profiles set region = 'dakar' where id = psk.uid(1);
  perform psk.must_fail('an unknown region', format('update public.profiles set region = %L where id = %L', 'mars', psk.uid(1)), 'check');
  reset role;
  perform psk.as_user(2);
  update public.profiles set region = 'thies' where id = psk.uid(2);
  reset role;
  if (select count(*) from public.search_projects('PS', null, null, null, 'recent', false, 20, 0, 'dakar') where github_owner = 'ana-ps') <> 1 then
    raise exception 'FAIL: the region filter should find the project of a member from Dakar';
  end if;
  if exists (select 1 from public.search_projects('PS', null, null, null, 'recent', false, 20, 0, 'thies') where github_owner = 'ana-ps') then
    raise exception 'FAIL: the region filter should not find it under another region';
  end if;
  if (select owner_region from public.search_projects('Vitrine PS') limit 1) is distinct from 'dakar' then
    raise exception 'FAIL: the owner region should be returned';
  end if;
  raise notice 'OK 1: members pick a region and projects can be filtered by it';
end $$;

do $$
declare old text;
begin
  perform psk.as_user(3);
  perform psk.must_fail('a stranger sets the showcase', $q$select public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', 'https://demo.exemple.sn', null)$q$, 'Project not found');
  reset role;
  perform psk.as_user(1);
  perform psk.must_fail('a demo link over http', $q$select public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', 'http://demo.exemple.sn', null)$q$, 'https');
  perform psk.must_fail('a javascript link', $q$select public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', 'javascript:alert(1)', null)$q$, 'https');
  perform psk.must_fail('a cover that was never uploaded', format('select public.set_project_showcase(%L, null, %L)', 'f6a7b8c9-1111-0000-0000-000000000001', psk.cover(1, 1)), 'not uploaded');
  perform psk.must_fail('a cover in someone else''s folder', format('select public.set_project_showcase(%L, null, %L)', 'f6a7b8c9-1111-0000-0000-000000000001', psk.cover(2, 1)), 'own folder');
  insert into storage.objects (bucket_id, name) values ('project-covers', psk.cover(1, 1));
  perform psk.must_fail('uploading into someone else''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'project-covers', psk.cover(2, 2)), 'row-level security');
  perform psk.must_fail('uploading an SVG', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'project-covers', psk.cover(1, 2, 'svg')), 'row-level security');
  old := public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', 'https://demo.exemple.sn/jeu', psk.cover(1, 1));
  if old is not null then raise exception 'FAIL: no previous cover expected, got %', old; end if;
  insert into storage.objects (bucket_id, name) values ('project-covers', psk.cover(1, 3, 'webp'));
  old := public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', 'https://demo.exemple.sn/jeu', psk.cover(1, 3, 'webp'));
  if old is distinct from psk.cover(1, 1) then raise exception 'FAIL: the replaced cover should be returned, got %', old; end if;
  reset role;
  if (select demo_url from public.projects where id = 'f6a7b8c9-1111-0000-0000-000000000001') <> 'https://demo.exemple.sn/jeu' then
    raise exception 'FAIL: the demo link was not saved';
  end if;
  if (select demo_url || '|' || cover_path from public.search_projects('Vitrine PS') limit 1) <> 'https://demo.exemple.sn/jeu|' || psk.cover(1, 3, 'webp') then
    raise exception 'FAIL: the search should return the demo link and cover';
  end if;
  perform psk.as_user(1);
  old := public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', '', null);
  if old is distinct from psk.cover(1, 3, 'webp') then raise exception 'FAIL: clearing should return the old cover'; end if;
  reset role;
  if (select demo_url from public.projects where id = 'f6a7b8c9-1111-0000-0000-000000000001') is not null then raise exception 'FAIL: an empty link should clear it'; end if;
  perform psk.as_user(1);
  delete from storage.objects where bucket_id = 'project-covers' and name = psk.cover(1, 3, 'webp');
  reset role;
  set local role anon;
  perform psk.must_fail('a visitor sets the showcase', $q$select public.set_project_showcase('f6a7b8c9-1111-0000-0000-000000000001', null, null)$q$, 'permission denied');
  reset role;
  raise notice 'OK 2: the owner sets a demo link (https only) and a cover; nobody else can';
end $$;

do $$
declare n int;
begin
  insert into public.project_collaborators (project_id, user_id) values ('f6a7b8c9-1111-0000-0000-000000000001', psk.uid(2));
  perform psk.as_user(3);
  select count(*) into n from public.project_contributors(array['f6a7b8c9-1111-0000-0000-000000000001', 'f6a7b8c9-1111-0000-0000-000000000002']::uuid[]);
  if n <> 2 then raise exception 'FAIL: expected the owner and one collaborator, got %', n; end if;
  if (select user_id from public.project_contributors(array['f6a7b8c9-1111-0000-0000-000000000001']::uuid[]) limit 1) <> psk.uid(1) then
    raise exception 'FAIL: the owner should come first';
  end if;
  if exists (select 1 from public.project_contributors(array['f6a7b8c9-1111-0000-0000-000000000002']::uuid[])) then
    raise exception 'FAIL: a project that is not confirmed should show nobody';
  end if;
  reset role;
  set local role anon;
  perform psk.must_fail('a visitor lists contributors', $q$select * from public.project_contributors(array['f6a7b8c9-1111-0000-0000-000000000001']::uuid[])$q$, 'permission denied');
  reset role;
  raise notice 'OK 3: the people on a project are listed, owner first, only for confirmed projects';
end $$;

do $$
begin
  set local role service_role;
  perform public.record_github_extras('f6a7b8c9-1111-0000-0000-000000000001', null, null, 12, '2026-11-01T10:00:00Z');
  reset role;
  if (select github_forks from public.projects where id = 'f6a7b8c9-1111-0000-0000-000000000001') <> 12 then raise exception 'FAIL: forks not saved'; end if;
  if (select github_pushed_at from public.projects where id = 'f6a7b8c9-1111-0000-0000-000000000001') <> '2026-11-01T10:00:00Z'::timestamptz then raise exception 'FAIL: last push not saved'; end if;
  set local role service_role;
  perform public.record_github_extras('f6a7b8c9-1111-0000-0000-000000000001');
  reset role;
  if (select github_forks from public.projects where id = 'f6a7b8c9-1111-0000-0000-000000000001') <> 12 then raise exception 'FAIL: an empty answer should keep the forks'; end if;
  perform psk.as_user(1);
  perform psk.must_fail('a member records forks', $q$select public.record_github_extras('f6a7b8c9-1111-0000-0000-000000000001', null, null, 999, null)$q$, 'permission denied');
  reset role;
  raise notice 'OK 4: the checker records forks and the last push, and keeps them when it has no answer';
end $$;

delete from storage.objects where bucket_id = 'project-covers';
delete from public.projects where github_owner = 'ana-ps';
delete from auth.users where id::text like 'f6a7b8c9-%';
drop schema psk cascade;
select 'ALL PROJECT SHOWCASE TESTS PASSED' as result;
