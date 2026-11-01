-- Tests for migration 6 (projects imported from GitHub).
-- Run AFTER migrations 1 to 6. psql -v ON_ERROR_STOP=1 -f projects.test.sql
-- Each DO block is its own transaction on purpose (now() is frozen inside one).
--
-- People in this test:
--   ama     (...0001)  signed in with GitHub as "Ama-Dev"
--   bineta  (...0002)  signed in with GitHub as "bineta-dev"
--   coumba  (...0003)  signed up with email, no GitHub

create schema pjkit;
grant usage on schema pjkit to public;

create function pjkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('ffffffff-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function pjkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', pjkit.uid(p_n)::text, true);
end $$;

create function pjkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pjkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pjkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pjkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := pjkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- The id of a listed repository (looked up as the database owner).
create function pjkit.proj(p_repo text) returns uuid
language sql stable security definer as $$
  select id from public.projects where lower(github_repo) = lower(p_repo)
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (pjkit.uid(1), 'ama@exemple.sn', '{"provider":"github"}', '{"user_name":"Ama-Dev"}'),
  (pjkit.uid(2), 'bineta@exemple.sn', '{"provider":"github"}', '{"user_name":"bineta-dev"}'),
  (pjkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Listing a project ------------------------------------------------------
do $$
declare p public.projects;
begin
  perform pjkit.as_user(1);
  perform public.publish_project('https://github.com/ama-dev/jaajef-demo', 'Mon projet', 'Un petit outil', array['Python', 'python', 'API']);
  perform public.publish_project('https://github.com/Ama-Dev/slash-repo/', 'Avec slash');
  perform public.publish_project('https://github.com/ama-dev/dotgit.git', 'Avec .git');
  reset role;

  select * into p from public.projects where github_repo = 'jaajef-demo';
  if p.owner_id <> pjkit.uid(1) then raise exception 'FAIL: wrong owner'; end if;
  if p.tags <> array['python', 'api'] then raise exception 'FAIL: tags were not cleaned: %', p.tags; end if;
  if p.verified_at is not null then raise exception 'FAIL: a new project must start unverified'; end if;
  if p.github_stars <> 0 or p.language is not null then raise exception 'FAIL: GitHub details must start empty'; end if;
  if not exists (select 1 from public.projects where github_repo = 'slash-repo') then raise exception 'FAIL: trailing slash not accepted'; end if;
  if not exists (select 1 from public.projects where github_repo = 'dotgit') then raise exception 'FAIL: .git ending not accepted'; end if;
  raise notice 'OK 1: a project can be listed from a GitHub link; tags are cleaned; it starts pending';
end $$;

-- ---- 2. Refusals -----------------------------------------------------------------
do $$
begin
  perform pjkit.as_user(2);
  perform pjkit.must_fail('listing someone else''s repo', $q$select public.publish_project('https://github.com/ama-dev/autre', 'Pas a moi')$q$, 'own GitHub name');
  perform pjkit.must_fail('listing an org-style lookalike', $q$select public.publish_project('https://github.com/bineta-dev2/x', 'Presque')$q$, 'own GitHub name');
  perform public.publish_project('https://github.com/bineta-dev/mon-api', 'Mon API');
  reset role;

  perform pjkit.as_user(3);
  perform pjkit.must_fail('listing without GitHub', $q$select public.publish_project('https://github.com/coumba/x', 'Sans github')$q$, 'Connect your GitHub');
  reset role;

  perform pjkit.as_user(1);
  perform pjkit.must_fail('not a GitHub link', $q$select public.publish_project('https://gitlab.com/ama-dev/x', 'Autre site')$q$, 'link like');
  perform pjkit.must_fail('plain http link', $q$select public.publish_project('http://github.com/ama-dev/x', 'Pas https')$q$, 'link like');
  perform pjkit.must_fail('link with extra path', $q$select public.publish_project('https://github.com/ama-dev/x/tree/main', 'Trop long')$q$, 'link like');
  perform pjkit.must_fail('same repo listed twice', $q$select public.publish_project('https://github.com/ama-dev/jaajef-demo', 'Encore')$q$, 'already listed');
  perform pjkit.must_fail('same repo, other letter case', $q$select public.publish_project('https://github.com/AMA-DEV/JAAJEF-DEMO', 'Encore')$q$, 'already listed');
  perform pjkit.must_fail('nine tags', $q$select public.publish_project('https://github.com/ama-dev/tags', 'Tags', null, array['aa','bb','cc','dd','ee','ff','gg','hh','ii'])$q$, 'At most 8');
  perform pjkit.must_fail('bad tag', $q$select public.publish_project('https://github.com/ama-dev/tags', 'Tags', null, array['pas valide!'])$q$, 'Tags use');
  perform pjkit.must_fail('one-letter title', $q$select public.publish_project('https://github.com/ama-dev/tags', 'x')$q$, 'check');
  reset role;

  perform pjkit.as_anon();
  perform pjkit.must_fail('visitor lists a project', $q$select public.publish_project('https://github.com/ama-dev/v', 'Visiteur')$q$, 'permission denied');
  reset role;
  raise notice 'OK 2: only your own GitHub repos, once each, with clean links and tags; GitHub sign-in required';
end $$;

-- ---- 3. Pending projects are private to their owner --------------------------------
do $$
declare n int;
begin
  perform pjkit.as_user(1);
  select count(*) into n from public.projects;
  if n <> 3 then raise exception 'FAIL: ama should see her 3 pending projects, saw %', n; end if;
  reset role;

  perform pjkit.as_user(2);
  select count(*) into n from public.projects where owner_id = pjkit.uid(1);
  if n <> 0 then raise exception 'FAIL: another member sees % pending projects of ama', n; end if;
  reset role;

  perform pjkit.as_anon();
  select count(*) into n from public.projects;
  if n <> 0 then raise exception 'FAIL: a visitor sees % pending projects', n; end if;
  reset role;
  raise notice 'OK 3: pending projects are visible only to their owner';
end $$;

-- ---- 4. Members cannot touch the tables or the server functions ------------------------
do $$
declare p uuid := pjkit.proj('jaajef-demo');
begin
  perform pjkit.as_user(1);
  perform pjkit.must_fail('member marks a project verified', format('update public.projects set verified_at = now() where id = %L', p), 'permission denied');
  perform pjkit.must_fail('member sets stars', format('update public.projects set github_stars = 99999 where id = %L', p), 'permission denied');
  perform pjkit.must_fail('direct insert', format('insert into public.projects (owner_id, github_owner, github_repo, title) values (%L, %L, %L, %L)', pjkit.uid(1), 'ama-dev', 'direct', 'Direct'), 'permission denied');
  perform pjkit.must_fail('direct delete', 'delete from public.projects', 'permission denied');
  perform pjkit.must_fail('member calls the sync function', format('select public.record_github_sync(%L, true, %L)', p, 'ama-dev'), 'permission denied');
  perform pjkit.must_fail('member lists what to sync', 'select * from public.projects_to_sync(10)', 'permission denied');
  reset role;

  perform pjkit.as_anon();
  perform pjkit.must_fail('visitor calls the sync function', format('select public.record_github_sync(%L, true, %L)', p, 'ama-dev'), 'permission denied');
  reset role;
  raise notice 'OK 4: members cannot verify projects, fake GitHub details, or call server functions';
end $$;

-- ---- 5. What the server has to check ------------------------------------------------------
do $$
declare n int;
begin
  perform pjkit.as_server();
  select count(*) into n from public.projects_to_sync(10);
  if n <> 4 then raise exception 'FAIL: 4 projects were never checked, server sees %', n; end if;
  select count(*) into n from public.projects_to_sync(2);
  if n <> 2 then raise exception 'FAIL: the limit was ignored (%)', n; end if;
  reset role;
  raise notice 'OK 5: the server gets the list of projects to check, with a limit';
end $$;

-- ---- 6. Confirming a project: visible, rewarded once ------------------------------------------
do $$
declare p uuid := pjkit.proj('jaajef-demo'); r jsonb; xp0 bigint;
begin
  select xp into xp0 from public.profiles where id = pjkit.uid(1);

  perform pjkit.as_server();
  -- GitHub reports the owner with different letter case: still the same owner
  r := public.record_github_sync(p, true, 'AMA-DEV', 'Un outil pour tout', 'Python', 12);
  reset role;

  if not (r ->> 'verified')::boolean or not (r ->> 'rewarded')::boolean then raise exception 'FAIL: first confirmation %', r; end if;
  if (select xp from public.profiles where id = pjkit.uid(1)) <> xp0 + 50 then raise exception 'FAIL: reward was not paid'; end if;
  if not exists (select 1 from public.projects where id = p and verified_at is not null and github_stars = 12 and language = 'Python') then
    raise exception 'FAIL: GitHub details were not saved';
  end if;

  -- the project is now public
  perform pjkit.as_anon();
  if (select count(*) from public.projects) <> 1 then raise exception 'FAIL: a visitor should see exactly the confirmed project'; end if;
  if (select github_stars from public.projects) <> 12 then raise exception 'FAIL: public stars wrong'; end if;
  reset role;

  perform pjkit.as_user(2);
  if (select count(*) from public.projects where owner_id = pjkit.uid(1)) <> 1 then raise exception 'FAIL: another member should see the confirmed project'; end if;
  reset role;
  raise notice 'OK 6: a confirmed project becomes public, with GitHub details, and pays XP';
end $$;

do $$
declare p uuid := pjkit.proj('jaajef-demo'); r jsonb;
begin
  -- checking again updates the stars but never pays again
  perform pjkit.as_server();
  r := public.record_github_sync(p, true, 'ama-dev', 'Un outil pour tout', 'Python', 40);
  if (r ->> 'rewarded')::boolean then raise exception 'FAIL: paid twice for one project'; end if;
  reset role;
  if (select xp from public.profiles where id = pjkit.uid(1)) <> 50 then raise exception 'FAIL: XP should stay at 50'; end if;
  if (select github_stars from public.projects where id = p) <> 40 then raise exception 'FAIL: stars were not refreshed'; end if;

  -- no longer synced "yesterday": it leaves the to-check list
  perform pjkit.as_server();
  if exists (select 1 from public.projects_to_sync(10) where project_id = p) then raise exception 'FAIL: a just-checked project is listed again'; end if;
  reset role;
  raise notice 'OK 6b: re-checking refreshes details but pays once';
end $$;

-- ---- 7. Wrong owner or missing repo: hidden, never public -----------------------------------------
do $$
declare p uuid := pjkit.proj('jaajef-demo'); q uuid := pjkit.proj('slash-repo'); r jsonb;
begin
  perform pjkit.as_server();
  -- GitHub says the repo now belongs to someone else
  r := public.record_github_sync(p, true, 'someone-else', 'x', 'Go', 1);
  if (r ->> 'verified')::boolean then raise exception 'FAIL: wrong owner was accepted'; end if;
  -- a repo that does not exist is never confirmed
  r := public.record_github_sync(q, false);
  if (r ->> 'verified')::boolean then raise exception 'FAIL: missing repo was accepted'; end if;
  reset role;

  perform pjkit.as_anon();
  if (select count(*) from public.projects) <> 0 then raise exception 'FAIL: a project that failed the check is still public'; end if;
  reset role;
  if (select xp from public.profiles where id = pjkit.uid(1)) <> 50 then raise exception 'FAIL: a failed check paid XP'; end if;

  -- when it matches again it comes back, with no new reward
  perform pjkit.as_server();
  r := public.record_github_sync(p, true, 'ama-dev', 'Un outil pour tout', 'Python', 41);
  reset role;
  if not (r ->> 'verified')::boolean or (r ->> 'rewarded')::boolean then raise exception 'FAIL: coming back %', r; end if;
  raise notice 'OK 7: a repo that is missing or belongs to someone else is hidden and earns nothing';
end $$;

-- ---- 8. Editing, hiding, deleting -------------------------------------------------------------------------
do $$
declare p uuid := pjkit.proj('jaajef-demo');
begin
  perform pjkit.as_user(2);
  perform pjkit.must_fail('editing someone else''s project', format('select public.update_project(%L, %L)', p, 'hack'), 'not found');
  perform pjkit.must_fail('deleting someone else''s project', format('select public.delete_project(%L)', p), 'not found');
  reset role;

  perform pjkit.as_user(1);
  perform public.update_project(p, 'Nouveau titre', null, array['Rust'], false);
  reset role;
  if not exists (select 1 from public.projects where id = p and title = 'Nouveau titre' and tags = array['rust'] and not is_public) then
    raise exception 'FAIL: update did not save';
  end if;

  -- hidden by its owner: gone for visitors, still there for the owner
  perform pjkit.as_anon();
  if (select count(*) from public.projects) <> 0 then raise exception 'FAIL: a hidden project is still public'; end if;
  reset role;
  perform pjkit.as_user(1);
  if (select count(*) from public.projects where id = p) <> 1 then raise exception 'FAIL: owner lost their hidden project'; end if;
  perform public.update_project(p, null, null, null, true);
  reset role;
  perform pjkit.as_anon();
  if (select count(*) from public.projects) <> 1 then raise exception 'FAIL: project did not come back'; end if;
  reset role;
  raise notice 'OK 8: owners edit, hide and show their projects; others cannot';
end $$;

-- ---- 9. Deleting and listing again does not pay twice --------------------------------------------------------
do $$
declare p uuid := pjkit.proj('jaajef-demo'); p2 uuid; r jsonb;
begin
  perform pjkit.as_user(1);
  perform public.delete_project(p);
  p2 := public.publish_project('https://github.com/ama-dev/jaajef-demo', 'Retour');
  reset role;

  perform pjkit.as_server();
  r := public.record_github_sync(p2, true, 'ama-dev', 'x', 'Python', 1);
  reset role;
  if not (r ->> 'verified')::boolean then raise exception 'FAIL: relisted project not confirmed'; end if;
  if (r ->> 'rewarded')::boolean then raise exception 'FAIL: delete and relist paid a second time'; end if;
  if (select xp from public.profiles where id = pjkit.uid(1)) <> 50 then raise exception 'FAIL: XP farmed by relisting'; end if;
  raise notice 'OK 9: deleting and listing the same repository again cannot farm XP';
end $$;

-- ---- 10. Limit per member --------------------------------------------------------------------------------------------
update public.game_config set value = '4' where key = 'project_max_per_member';

do $$
begin
  perform pjkit.as_user(1); -- ama already has 3 (slash-repo, dotgit, jaajef-demo)
  perform public.publish_project('https://github.com/ama-dev/quatrieme', 'Quatrieme');
  perform pjkit.must_fail('fifth project', $q$select public.publish_project('https://github.com/ama-dev/cinquieme', 'Cinquieme')$q$, 'limit');
  reset role;
  raise notice 'OK 10: projects per member are limited';
end $$;

update public.game_config set value = '30' where key = 'project_max_per_member';

select 'ALL PROJECT TESTS PASSED' as result;
