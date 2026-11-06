-- Tests for the global search migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f global_search.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- Everything this test creates contains the made-up word "zorbo", so results
-- are not mixed up with anything else in the database.

create schema gskit;
grant usage on schema gskit to public;

create function gskit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('a4a4a4a4-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function gskit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', gskit.uid(p_n)::text, true);
end $$;

create function gskit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- What a search returns, as one text like 'community:zorbo-publique,member:zorbo_ana'.
create function gskit.found(p_query text, p_limit int default 5) returns text
language sql stable as $$
  select coalesce(string_agg(kind || ':' || slug, ',' order by kind, pos), '')
    from public.search_everything(p_query, p_limit)
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (gskit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (gskit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (gskit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}');

update public.profiles set username = 'zorbo_ana', display_name = 'Zorbo Ana' where id = gskit.uid(1);
update public.profiles set username = 'zorbo_bara', display_name = 'Bara du Cercle' where id = gskit.uid(2);
update public.profiles set username = 'coumba_c', display_name = 'Coumba' where id = gskit.uid(3);

insert into public.projects (owner_id, github_owner, github_repo, title, summary, tags, verified_at, is_public, staff_hidden) values
  (gskit.uid(1), 'ana-dev', 'zorbo-alpha', 'Zorbo Alpha', 'Un projet', '{ia}', now(), true, false),
  (gskit.uid(2), 'bara-dev', 'beta-repo', 'Le projet zorbo', 'Un autre projet', '{web}', now(), true, false),
  (gskit.uid(1), 'ana-dev', 'zorbo-hidden', 'Zorbo cache par le staff', null, '{}', now(), true, true),
  (gskit.uid(1), 'ana-dev', 'zorbo-pending', 'Zorbo en attente', null, '{}', null, true, false),
  (gskit.uid(1), 'ana-dev', 'zorbo-private', 'Zorbo prive', null, '{}', now(), false, false),
  (gskit.uid(2), 'bara-dev', 'tagged-repo', 'Sans le mot', null, '{zorbotag}', now(), true, false);

insert into public.communities (slug, name, description, is_private, is_listed, owner_id) values
  ('zorbo-publique', 'Zorbo public', 'Ouverte a tous', false, true, gskit.uid(1)),
  ('zorbo-visible', 'Zorbo prive visible', null, true, true, gskit.uid(1)),
  ('zorbo-secret', 'Zorbo prive cache', null, true, false, gskit.uid(1));

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, published) values
  ('zorbo-quete', 'Zorbo quete', 'Une quete publiee', 'griot_du_code', 'ndongo', 'python', 10, 100, true),
  ('zorbo-brouillon', 'Zorbo brouillon', 'Pas encore publiee', 'griot_du_code', 'ndongo', 'python', 10, 100, false);

-- ---- 1. Only public things, for everyone ------------------------------------------------------------------------
do $$
declare expected text :=
  'community:zorbo-visible,community:zorbo-publique,member:zorbo_ana,member:zorbo_bara,project:ana-dev/zorbo-alpha,project:bara-dev/beta-repo,project:bara-dev/tagged-repo,quest:zorbo-quete';
begin
  perform gskit.as_anon();
  if gskit.found('zorbo') <> expected then raise exception 'FAIL: a visitor searching "zorbo" got: %', gskit.found('zorbo'); end if;
  reset role;
  perform gskit.as_user(3);
  if gskit.found('zorbo') <> expected then raise exception 'FAIL: a member searching "zorbo" got: %', gskit.found('zorbo'); end if;
  reset role;
  perform gskit.as_user(1); -- the owner of the hidden, pending and private things does not see them either
  if gskit.found('zorbo') <> expected then raise exception 'FAIL: the owner searching "zorbo" got: %', gskit.found('zorbo'); end if;
  reset role;
  raise notice 'OK 1: search shows only public things: listed projects and communities, published quests, members';
end $$;

-- ---- 2. Best matches first -------------------------------------------------------------------------------------------
do $$
begin
  perform gskit.as_anon();
  if (select slug from public.search_everything('zorbo', 5) where kind = 'project' and pos = 1) <> 'ana-dev/zorbo-alpha' then
    raise exception 'FAIL: a title that starts with the search should come first';
  end if;
  if (select count(*) from public.search_everything('zorbo', 5) where kind = 'project') <> 3 then raise exception 'FAIL: expected 3 projects'; end if;
  if (select slug from public.search_everything('zorbo', 5) where kind = 'member' and pos = 1) <> 'zorbo_ana' then
    raise exception 'FAIL: a member whose name starts with the search should come first';
  end if;
  reset role;
  raise notice 'OK 2: results that start with the search come before results that only contain it';
end $$;

-- ---- 3. What counts as a search --------------------------------------------------------------------------------------------
do $$
begin
  perform gskit.as_anon();
  if gskit.found('z') <> '' then raise exception 'FAIL: one character should give nothing'; end if;
  if gskit.found('   ') <> '' then raise exception 'FAIL: blanks should give nothing'; end if;
  if gskit.found(null) <> '' then raise exception 'FAIL: null should give nothing'; end if;
  if gskit.found(' zorbo ') = '' then raise exception 'FAIL: spaces around a search should be ignored'; end if;
  if gskit.found('ZORBO') <> gskit.found('zorbo') then raise exception 'FAIL: search should ignore case'; end if;
  if gskit.found('zorbo' || repeat('x', 200)) <> '' then raise exception 'FAIL: a very long search should simply find nothing'; end if;
  reset role;
  raise notice 'OK 3: too short, blank or empty searches give nothing; case and spaces are ignored';
end $$;

-- ---- 4. Special characters are plain text ------------------------------------------------------------------------------------
do $$
begin
  perform gskit.as_anon();
  if gskit.found('zor%') <> '' then raise exception 'FAIL: a percent sign must not act as a wildcard, got %', gskit.found('zor%'); end if;
  if gskit.found('zorb_') <> '' then raise exception 'FAIL: an underscore must not match any character, got %', gskit.found('zorb_'); end if;
  if gskit.found('zorbo_a') <> 'member:zorbo_ana' then raise exception 'FAIL: an underscore should be searched as itself, got %', gskit.found('zorbo_a'); end if;
  if gskit.found('zorbo\') <> '' then raise exception 'FAIL: a backslash should be plain text'; end if;
  reset role;
  raise notice 'OK 4: percent signs, underscores and backslashes are searched as plain characters';
end $$;

-- ---- 5. Limits ----------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform gskit.as_anon();
  if (select count(*) from public.search_everything('zorbo', 1) where kind = 'project') <> 1 then raise exception 'FAIL: a limit of 1 should give 1 project'; end if;
  if (select count(*) from public.search_everything('zorbo', 0) where kind = 'project') <> 1 then raise exception 'FAIL: a limit of 0 should be raised to 1'; end if;
  if (select count(*) from public.search_everything('zorbo', 100000) where kind = 'project') <> 3 then raise exception 'FAIL: a huge limit should still work'; end if;
  if (select count(*) from public.search_everything('zorbo', null) where kind = 'project') <> 3 then raise exception 'FAIL: a missing limit should use the default'; end if;
  reset role;
  raise notice 'OK 5: the number of results per kind is limited and kept in range';
end $$;

-- ---- 6. A match in a tag or a summary --------------------------------------------------------------------------------------
do $$
begin
  perform gskit.as_anon();
  if gskit.found('zorbotag') <> 'project:bara-dev/tagged-repo' then raise exception 'FAIL: search by tag, got %', gskit.found('zorbotag'); end if;
  if gskit.found('Ouverte a tous') <> 'community:zorbo-publique' then raise exception 'FAIL: search by community description, got %', gskit.found('Ouverte a tous'); end if;
  if gskit.found('quete publiee') <> 'quest:zorbo-quete' then raise exception 'FAIL: search by quest summary, got %', gskit.found('quete publiee'); end if;
  if gskit.found('Pas encore publiee') <> '' then raise exception 'FAIL: an unpublished quest was found by its summary'; end if;
  reset role;
  raise notice 'OK 6: search also looks at tags and descriptions, but never at unpublished or hidden things';
end $$;

-- ---- Clean up -----------------------------------------------------------------------------------------------------------------------
delete from public.quests where slug like 'zorbo-%';
delete from public.communities where slug like 'zorbo-%';
delete from public.projects where owner_id::text like 'a4a4a4a4-%';
delete from public.profiles where id::text like 'a4a4a4a4-%';
delete from auth.users where id::text like 'a4a4a4a4-%';
drop schema gskit cascade;

do $$
begin
  if exists (select 1 from public.quests where slug like 'zorbo-%') or exists (select 1 from public.communities where slug like 'zorbo-%') then
    raise exception 'FAIL: rows left behind';
  end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL GLOBAL SEARCH TESTS PASSED' as result;
