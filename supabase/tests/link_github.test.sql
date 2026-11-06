-- Tests for connecting a GitHub account. Run AFTER all migrations.
-- psql -v ON_ERROR_STOP=1 -f link_github.test.sql

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('ab000000-0000-0000-0000-000000000001', 'lg1@exemple.sn', '{"provider":"email"}', '{"user_name":"fake-name"}'),
  ('ab000000-0000-0000-0000-000000000002', 'lg2@exemple.sn', '{"provider":"email"}', '{}'),
  ('ab000000-0000-0000-0000-000000000003', 'lg3@exemple.sn', '{"provider":"email"}', '{}'),
  ('ab000000-0000-0000-0000-000000000004', 'lg4@exemple.sn', '{"provider":"email"}', '{}');
insert into auth.identities (user_id, provider, identity_data) values
  ('ab000000-0000-0000-0000-000000000001', 'email', '{"user_name":"not-github"}'),
  ('ab000000-0000-0000-0000-000000000002', 'github', '{"user_name":"Bara-Dev"}'),
  ('ab000000-0000-0000-0000-000000000003', 'github', '{"user_name":"bara-dev"}'),
  ('ab000000-0000-0000-0000-000000000004', 'github', '{"user_name":"bad name!"}');

-- ---- 1. Only a verified GitHub identity counts -------------------------------------------------------------------
do $$
declare u1 uuid := 'ab000000-0000-0000-0000-000000000001'; u2 uuid := 'ab000000-0000-0000-0000-000000000002'; ok boolean := false; r text;
begin
  -- no GitHub identity (even with a GitHub-looking name typed at sign-up): refused, profile untouched
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  begin perform public.link_github_account(); exception when raise_exception then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: linked without a GitHub identity'; end if;
  if (select github_username from public.profiles where id = u1) is not null then raise exception 'FAIL: name set without identity'; end if;

  -- with a GitHub identity: the name comes from the identity
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  r := public.link_github_account();
  reset role;
  if r <> 'Bara-Dev' or (select github_username from public.profiles where id = u2) <> 'Bara-Dev' then
    raise exception 'FAIL: name not copied: %', r;
  end if;
  raise notice 'OK 1: the GitHub name comes only from a verified GitHub identity';
end $$;

-- ---- 2. Again is harmless; a taken name and a bad name are refused ----------------------------------------------
do $$
declare u2 uuid := 'ab000000-0000-0000-0000-000000000002'; u3 uuid := 'ab000000-0000-0000-0000-000000000003'; u4 uuid := 'ab000000-0000-0000-0000-000000000004'; ok boolean; r text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  r := public.link_github_account();
  reset role;
  if r <> 'Bara-Dev' then raise exception 'FAIL: not repeatable'; end if;

  ok := false;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u3::text, true);
  begin perform public.link_github_account(); exception when raise_exception then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: the same GitHub name (different case) was linked to two members'; end if;

  ok := false;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u4::text, true);
  begin perform public.link_github_account(); exception when raise_exception then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: an unusable GitHub name was accepted'; end if;
  raise notice 'OK 2: repeatable; one GitHub name per member (any letter case); bad names refused';
end $$;

-- ---- 3. Not signed in: refused; members still cannot write the column directly ------------------------------------
do $$
declare u1 uuid := 'ab000000-0000-0000-0000-000000000001'; ok boolean := false; n integer;
begin
  set local role anon;
  begin perform public.link_github_account(); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: anonymous visitor could call the link'; end if;

  ok := false;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  begin update public.profiles set github_username = 'whoever' where id = u1; exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: a member wrote github_username directly'; end if;
  raise notice 'OK 3: visitors refused; direct writes to github_username still refused';
end $$;

-- ---- 4. After linking, listing a project under that name works; under another name it does not ----------------
do $$
declare u2 uuid := 'ab000000-0000-0000-0000-000000000002'; ok boolean := false; id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  id := public.publish_project('https://github.com/bara-dev/mon-depot', 'Mon depot', null, '{}');
  begin perform public.publish_project('https://github.com/someone-else/repo', 'Autre', null, '{}'); exception when raise_exception then ok := true; end;
  reset role;
  if id is null then raise exception 'FAIL: project not listed after linking'; end if;
  if not ok then raise exception 'FAIL: listed a repository under another GitHub name'; end if;
  raise notice 'OK 4: after linking, projects under the member''s own GitHub name can be listed';
end $$;

delete from public.projects where owner_id = 'ab000000-0000-0000-0000-000000000002';
delete from auth.users where id in ('ab000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000002','ab000000-0000-0000-0000-000000000003','ab000000-0000-0000-0000-000000000004');

select 'ALL LINK GITHUB TESTS PASSED' as result;
