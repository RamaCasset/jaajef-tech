-- Tests for the github badges migration ("Build passing" and "Good first issues").
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f github_badges.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) and bara (...2) own listed projects, coumba (...3) is a plain member.
-- Projects: gb-alpha (ana, Python), gb-beta (bara, TypeScript), gb-hidden (staff hidden), gb-pending (not confirmed).

create schema gbkit;
grant usage on schema gbkit to public;

create function gbkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('b7b7b7b7-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function gbkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', gbkit.uid(p_n)::text, true);
end $$;

create function gbkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function gbkit.as_service() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function gbkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function gbkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := gbkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function gbkit.proj(p_repo text) returns uuid
language sql stable security definer as $$ select id from public.projects where github_repo = p_repo $$;

-- An issue as the checker would send it.
create function gbkit.issue(p_owner text, p_repo text, p_n int, p_title text, p_age_days int default 1) returns jsonb
language sql immutable as $$
  select jsonb_build_object('number', p_n, 'title', p_title, 'comments', 2,
                            'url', 'https://github.com/' || p_owner || '/' || p_repo || '/issues/' || p_n,
                            'created_at', (timestamptz '2026-01-31 00:00:00+00' - make_interval(days => p_age_days)))
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (gbkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (gbkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (gbkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}');

update public.profiles set clan = 'griot_du_code' where id = gbkit.uid(1);
update public.profiles set clan = 'forgeron' where id = gbkit.uid(2);

insert into public.projects (owner_id, github_owner, github_repo, title, summary, language, tags, verified_at, is_public, staff_hidden, github_stars) values
  (gbkit.uid(1), 'ana-dev', 'gb-alpha', 'Alpha', 'Un projet', 'Python', '{ia}', now(), true, false, 0),
  (gbkit.uid(2), 'bara-dev', 'gb-beta', 'Beta', 'Un autre projet', 'TypeScript', '{web}', now(), true, false, 0),
  (gbkit.uid(1), 'ana-dev', 'gb-hidden', 'Cache', null, 'Python', '{ia}', now(), true, true, 0),
  (gbkit.uid(1), 'ana-dev', 'gb-pending', 'En attente', null, 'Python', '{ia}', null, true, false, 0);

-- ---- 1. The checker's work list ---------------------------------------------------------------------------------------
do $$
declare n int;
begin
  perform gbkit.as_service();
  select count(*) into n from public.projects_for_extras(100) where github_repo like 'gb-%';
  if n <> 2 then raise exception 'FAIL: only the 2 listed gb projects should be on the work list, got %', n; end if;
  if exists (select 1 from public.projects_for_extras(100) where github_repo in ('gb-hidden', 'gb-pending')) then
    raise exception 'FAIL: a hidden or unconfirmed project is on the work list';
  end if;
  reset role;
  raise notice 'OK 1: the checker gets listed projects only';
end $$;

-- ---- 2. Only the checker can use the checker functions ------------------------------------------------------------------
do $$
begin
  perform gbkit.as_anon();
  perform gbkit.must_fail('a visitor reading the work list', $q$select * from public.projects_for_extras(10)$q$, 'permission denied');
  perform gbkit.must_fail('a visitor recording extras', format($q$select public.record_github_extras(%L, 'passing', null)$q$, gbkit.proj('gb-alpha')), 'permission denied');
  reset role;
  perform gbkit.as_user(1);
  perform gbkit.must_fail('the owner reading the work list', $q$select * from public.projects_for_extras(10)$q$, 'permission denied');
  perform gbkit.must_fail('the owner faking a build status', format($q$select public.record_github_extras(%L, 'passing', null)$q$, gbkit.proj('gb-alpha')), 'permission denied');
  perform gbkit.must_fail('the owner writing issues directly', format($q$insert into public.project_issues (project_id, issue_number, title, url, created_on) values (%L, 1, 'x', 'https://github.com/ana-dev/gb-alpha/issues/1', now())$q$, gbkit.proj('gb-alpha')), 'permission denied');
  perform gbkit.must_fail('reading the issue table directly', $q$select * from public.project_issues$q$, 'permission denied');
  reset role;
  raise notice 'OK 2: members and visitors cannot read the work list, record results or touch the issue table';
end $$;

-- ---- 3. Recording a build status ---------------------------------------------------------------------------------------
do $$
declare r jsonb; v text; t timestamptz;
begin
  perform gbkit.as_service();
  r := public.record_github_extras(gbkit.proj('gb-alpha'), 'passing', null);
  reset role;
  select build_status into v from public.projects where github_repo = 'gb-alpha';
  if v is distinct from 'passing' then raise exception 'FAIL: build status not saved'; end if;
  if (select build_checked_at from public.projects where github_repo = 'gb-alpha') is null then raise exception 'FAIL: build check time not saved'; end if;
  if (select extras_synced_at from public.projects where github_repo = 'gb-alpha') is null then raise exception 'FAIL: the project was not marked as looked at'; end if;
  -- null leaves the status as it is
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, null);
  reset role;
  select build_status into v from public.projects where github_repo = 'gb-alpha';
  if v is distinct from 'passing' then raise exception 'FAIL: an empty answer erased the build status'; end if;
  -- unknown status refused
  perform gbkit.as_service();
  perform gbkit.must_fail('an unknown build status', format($q$select public.record_github_extras(%L, 'great', null)$q$, gbkit.proj('gb-alpha')), 'Unknown build status');
  perform gbkit.must_fail('a hidden project', format($q$select public.record_github_extras(%L, 'passing', null)$q$, gbkit.proj('gb-hidden')), 'Project not found');
  perform gbkit.must_fail('an unconfirmed project', format($q$select public.record_github_extras(%L, 'passing', null)$q$, gbkit.proj('gb-pending')), 'Project not found');
  perform gbkit.must_fail('a missing project', $q$select public.record_github_extras(gen_random_uuid(), 'passing', null)$q$, 'Project not found');
  reset role;
  -- each status is accepted
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), 'failing', null);
  perform public.record_github_extras(gbkit.proj('gb-alpha'), 'running', null);
  perform public.record_github_extras(gbkit.proj('gb-alpha'), 'none', null);
  reset role;
  select build_status into v from public.projects where github_repo = 'gb-alpha';
  if v is distinct from 'none' then raise exception 'FAIL: statuses not updated in turn'; end if;
  raise notice 'OK 3: build status is saved, an empty answer leaves it alone, bad input and non-listed projects are refused';
end $$;

-- ---- 4. Work list order and the 6 hour wait --------------------------------------------------------------------------------
do $$
declare first_repo text;
begin
  -- gb-alpha was looked at just now; gb-beta never was, so it comes first and alpha is not due
  perform gbkit.as_service();
  if exists (select 1 from public.projects_for_extras(100) where github_repo = 'gb-alpha') then raise exception 'FAIL: a project looked at a moment ago is on the list again'; end if;
  select github_repo into first_repo from public.projects_for_extras(100) where github_repo like 'gb-%' limit 1;
  if first_repo <> 'gb-beta' then raise exception 'FAIL: the never-checked project should come first, got %', first_repo; end if;
  reset role;
  update public.projects set extras_synced_at = now() - interval '7 hours' where github_repo = 'gb-alpha';
  perform gbkit.as_service();
  if not exists (select 1 from public.projects_for_extras(100) where github_repo = 'gb-alpha') then raise exception 'FAIL: a project looked at 7 hours ago should be due'; end if;
  -- a failed project that only stamps the time moves to the back of the line
  perform public.record_github_extras(gbkit.proj('gb-beta'), null, null);
  select github_repo into first_repo from public.projects_for_extras(100) where github_repo like 'gb-%' limit 1;
  if first_repo <> 'gb-alpha' then raise exception 'FAIL: a stubborn project blocks the others, got %', first_repo; end if;
  reset role;
  raise notice 'OK 4: projects are due every 6 hours, never-checked first, and a stubborn project cannot block the others';
end $$;

-- ---- 5. Recording issues ---------------------------------------------------------------------------------------------------
do $$
declare r jsonb; n int;
begin
  perform gbkit.as_service();
  r := public.record_github_extras(gbkit.proj('gb-alpha'), null, jsonb_build_array(
    gbkit.issue('ana-dev', 'gb-alpha', 11, 'Corriger la faute', 3),
    gbkit.issue('ana-dev', 'gb-alpha', 12, 'Ajouter un test', 1),
    gbkit.issue('ana-dev', 'gb-alpha', 12, 'Doublon', 1),
    gbkit.issue('someone-else', 'gb-alpha', 13, 'Mauvais depot', 1),
    gbkit.issue('ana-dev', 'gb-beta', 14, 'Autre depot', 1),
    jsonb_build_object('number', 15, 'title', '', 'url', 'https://github.com/ana-dev/gb-alpha/issues/15', 'created_at', now()),
    jsonb_build_object('number', 'abc', 'title', 'Numero casse', 'url', 'https://github.com/ana-dev/gb-alpha/issues/16', 'created_at', now()),
    to_jsonb('pas un objet'::text),
    jsonb_build_object('number', 17, 'title', 'Lien pirate', 'url', 'https://evil.example/ana-dev/gb-alpha/issues/17', 'created_at', now())));
  reset role;
  select count(*) into n from public.project_issues where project_id = gbkit.proj('gb-alpha');
  if n <> 2 then raise exception 'FAIL: only the 2 good issues should be kept, got %', n; end if;
  if (r ->> 'issues')::int <> 2 then raise exception 'FAIL: the answer should say 2 issues, got %', r; end if;
  if (select build_status from public.projects where github_repo = 'gb-alpha') is distinct from 'none' then raise exception 'FAIL: saving issues changed the build status'; end if;

  -- a second run replaces the list
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, jsonb_build_array(gbkit.issue('ana-dev', 'gb-alpha', 20, 'Nouvelle', 2)));
  reset role;
  if (select string_agg(issue_number::text, ',') from public.project_issues where project_id = gbkit.proj('gb-alpha')) <> '20' then
    raise exception 'FAIL: a new run should replace the old issues';
  end if;
  -- a null list leaves them alone
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), 'passing', null);
  reset role;
  if (select count(*) from public.project_issues where project_id = gbkit.proj('gb-alpha')) <> 1 then raise exception 'FAIL: an empty answer erased the issues'; end if;
  -- a JSON null also leaves them alone
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, 'null'::jsonb);
  reset role;
  if (select count(*) from public.project_issues where project_id = gbkit.proj('gb-alpha')) <> 1 then raise exception 'FAIL: a JSON null erased the issues'; end if;
  -- an empty list clears them
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, '[]'::jsonb);
  reset role;
  if exists (select 1 from public.project_issues where project_id = gbkit.proj('gb-alpha')) then raise exception 'FAIL: an empty list should clear the issues'; end if;
  perform gbkit.as_service();
  perform gbkit.must_fail('issues that are not a list', format($q$select public.record_github_extras(%L, null, '{"a":1}'::jsonb)$q$, gbkit.proj('gb-alpha')), 'must be a list');
  reset role;
  raise notice 'OK 5: bad, duplicate and foreign issue links are dropped; a new run replaces; null keeps; an empty list clears';
end $$;

-- ---- 6. At most 10, and long titles are cut -------------------------------------------------------------------------------
do $$
declare items jsonb := '[]'::jsonb; i int;
begin
  for i in 1..14 loop
    items := items || jsonb_build_array(gbkit.issue('ana-dev', 'gb-alpha', 100 + i, case when i = 1 then repeat('x', 500) else 'Issue ' || i end, i));
  end loop;
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, items);
  reset role;
  if (select count(*) from public.project_issues where project_id = gbkit.proj('gb-alpha')) <> 10 then raise exception 'FAIL: more than 10 issues were kept'; end if;
  if (select max(char_length(title)) from public.project_issues where project_id = gbkit.proj('gb-alpha')) > 200 then raise exception 'FAIL: a long title was not cut'; end if;
  raise notice 'OK 6: at most 10 issues per project and titles are cut at 200 characters';
end $$;

-- ---- 7. The public list -------------------------------------------------------------------------------------------------
do $$
declare n int; r record;
begin
  perform gbkit.as_service();
  perform public.record_github_extras(gbkit.proj('gb-alpha'), null, jsonb_build_array(
    gbkit.issue('ana-dev', 'gb-alpha', 1, 'Alpha un', 5), gbkit.issue('ana-dev', 'gb-alpha', 2, 'Alpha deux', 2)));
  perform public.record_github_extras(gbkit.proj('gb-beta'), null, jsonb_build_array(
    gbkit.issue('bara-dev', 'gb-beta', 7, 'Beta sept', 3)));
  reset role;
  -- issues on projects that are not listed must never show
  insert into public.project_issues (project_id, issue_number, title, url, created_on) values
    (gbkit.proj('gb-hidden'), 1, 'Cache', 'https://github.com/ana-dev/gb-hidden/issues/1', now()),
    (gbkit.proj('gb-pending'), 1, 'Pas confirme', 'https://github.com/ana-dev/gb-pending/issues/1', now());

  perform gbkit.as_anon();
  select count(*) into n from public.list_good_first_issues(null, null, 50, 0) where github_repo like 'gb-%';
  if n <> 3 then raise exception 'FAIL: visitors should see the 3 issues of listed projects, got %', n; end if;
  if exists (select 1 from public.list_good_first_issues(null, null, 50, 0) where github_repo in ('gb-hidden', 'gb-pending')) then
    raise exception 'FAIL: an issue of a hidden or unconfirmed project is shown';
  end if;
  -- newest first: beta (3 days), then alpha deux (2 days)... order by created_on desc
  if (select string_agg(title, ',' order by o) from (select title, row_number() over () o from public.list_good_first_issues('python', null, 50, 0)) s) <> 'Alpha deux,Alpha un' then
    raise exception 'FAIL: the language filter or the order is wrong';
  end if;
  if (select count(*) from public.list_good_first_issues('TYPESCRIPT', null, 50, 0)) <> 1 then raise exception 'FAIL: the language filter should ignore case'; end if;
  if (select count(*) from public.list_good_first_issues('rust', null, 50, 0)) <> 0 then raise exception 'FAIL: an unknown language should give nothing'; end if;
  if (select count(*) from public.list_good_first_issues(null, 'forgeron', 50, 0)) <> 1 then raise exception 'FAIL: the clan filter'; end if;
  if (select count(*) from public.list_good_first_issues('python', 'forgeron', 50, 0)) <> 0 then raise exception 'FAIL: filters should combine'; end if;
  if (select count(*) from public.list_good_first_issues(null, null, 1, 0)) <> 1 then raise exception 'FAIL: the limit'; end if;
  if (select count(*) from public.list_good_first_issues(null, null, 0, -4) where github_repo like 'gb-%') > 1 then raise exception 'FAIL: a limit of 0 should become 1'; end if;
  select * into r from public.list_good_first_issues('python', null, 1, 0);
  if r.owner_username is null or r.owner_clan <> 'griot_du_code' or r.url <> 'https://github.com/ana-dev/gb-alpha/issues/2' or r.comments <> 2 then
    raise exception 'FAIL: the details on an issue are wrong';
  end if;
  reset role;
  perform gbkit.as_user(3);
  if (select count(*) from public.list_good_first_issues(null, null, 50, 0) where github_repo like 'gb-%') <> 3 then raise exception 'FAIL: members should see the same list'; end if;
  reset role;
  raise notice 'OK 7: the public list shows listed projects only, newest first, filters by language and clan, and is paged';
end $$;

-- ---- 8. One project's issues ------------------------------------------------------------------------------------------------
do $$
begin
  perform gbkit.as_anon();
  if (select count(*) from public.project_good_first_issues(gbkit.proj('gb-alpha'))) <> 2 then raise exception 'FAIL: alpha should show 2 issues'; end if;
  if (select string_agg(title, ',') from public.project_good_first_issues(gbkit.proj('gb-alpha'))) <> 'Alpha deux,Alpha un' then raise exception 'FAIL: newest first'; end if;
  if exists (select 1 from public.project_good_first_issues(gbkit.proj('gb-hidden'))) then raise exception 'FAIL: a hidden project showed its issues'; end if;
  if exists (select 1 from public.project_good_first_issues(gbkit.proj('gb-pending'))) then raise exception 'FAIL: an unconfirmed project showed its issues'; end if;
  reset role;
  raise notice 'OK 8: one project shows its own issues, and hidden or unconfirmed ones show nothing';
end $$;

-- ---- 9. Owners can opt out ----------------------------------------------------------------------------------------------------
do $$
begin
  perform gbkit.as_user(2);
  perform gbkit.must_fail('changing someone else''s project', format($q$select public.set_project_newcomer_friendly(%L, false)$q$, gbkit.proj('gb-alpha')), 'Project not found');
  reset role;
  perform gbkit.as_user(3);
  perform gbkit.must_fail('a non-owner', format($q$select public.set_project_newcomer_friendly(%L, false)$q$, gbkit.proj('gb-alpha')), 'Project not found');
  reset role;
  perform gbkit.as_anon();
  perform gbkit.must_fail('a visitor', format($q$select public.set_project_newcomer_friendly(%L, false)$q$, gbkit.proj('gb-alpha')), 'permission denied');
  reset role;
  perform gbkit.as_user(1);
  perform gbkit.must_fail('an empty choice', format($q$select public.set_project_newcomer_friendly(%L, null)$q$, gbkit.proj('gb-alpha')), 'Say whether');
  perform public.set_project_newcomer_friendly(gbkit.proj('gb-alpha'), false);
  reset role;
  perform gbkit.as_anon();
  if exists (select 1 from public.list_good_first_issues(null, null, 50, 0) where github_repo = 'gb-alpha') then raise exception 'FAIL: an opted-out project is still in the public list'; end if;
  if exists (select 1 from public.project_good_first_issues(gbkit.proj('gb-alpha'))) then raise exception 'FAIL: an opted-out project still shows its issues'; end if;
  reset role;
  perform gbkit.as_user(1);
  perform public.set_project_newcomer_friendly(gbkit.proj('gb-alpha'), true);
  reset role;
  perform gbkit.as_anon();
  if (select count(*) from public.list_good_first_issues(null, null, 50, 0) where github_repo = 'gb-alpha') <> 2 then raise exception 'FAIL: switching back on should bring the issues back'; end if;
  reset role;
  raise notice 'OK 9: only the owner can opt a project out, and it can come back';
end $$;

-- ---- 10. Staff hiding a project hides its issues and badge ---------------------------------------------------------------------
do $$
begin
  update public.projects set staff_hidden = true where github_repo = 'gb-beta';
  perform gbkit.as_anon();
  if exists (select 1 from public.list_good_first_issues(null, null, 50, 0) where github_repo = 'gb-beta') then raise exception 'FAIL: a project hidden by staff is still in the list'; end if;
  reset role;
  update public.projects set staff_hidden = false where github_repo = 'gb-beta';
  raise notice 'OK 10: hiding a project removes its issues from the list';
end $$;

-- ---- 11. Deleting a project removes its issues ------------------------------------------------------------------------------------
do $$
declare p uuid := gbkit.proj('gb-beta');
begin
  delete from public.projects where id = p;
  if exists (select 1 from public.project_issues where project_id = p) then raise exception 'FAIL: issues left behind after deleting a project'; end if;
  raise notice 'OK 11: deleting a project deletes its issues';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------------------------
delete from public.projects where owner_id::text like 'b7b7b7b7-%';
delete from public.profiles where id::text like 'b7b7b7b7-%';
delete from auth.users where id::text like 'b7b7b7b7-%';
drop schema gbkit cascade;

do $$
begin
  if exists (select 1 from public.project_issues where url like '%/gb-%') then raise exception 'FAIL: issues left behind'; end if;
  raise notice 'OK 12: the test left nothing behind';
end $$;

select 'ALL GITHUB BADGES TESTS PASSED' as result;
