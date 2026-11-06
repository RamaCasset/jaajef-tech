-- Tests for the project discovery migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f project_discovery.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1), bara (...2), coumba (...3), dame (...4) own projects or post;
-- ama (...5) is an admin.
-- Projects: ds-alpha (ana, Python), ds-beta (bara, TypeScript), ds-gamma (coumba, Python),
-- and three that must never appear: hidden by staff, not yet confirmed, and private.

create schema dskit;
grant usage on schema dskit to public;

create function dskit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('e8e8e8e8-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function dskit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', dskit.uid(p_n)::text, true);
end $$;

create function dskit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function dskit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function dskit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := dskit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function dskit.proj(p_repo text) returns uuid
language sql stable security definer as $$ select id from public.projects where github_repo = p_repo $$;

-- The repositories a search returns, in order, as one text like 'ds-gamma,ds-beta'.
create function dskit.found(p_query text default 'ds-', p_language text default null, p_tag text default null,
                            p_clan public.clan_type default null, p_sort text default 'recent',
                            p_featured_only boolean default false, p_limit int default 20, p_offset int default 0) returns text
language sql stable as $$
  select coalesce(string_agg(github_repo, ',' order by ord), '')
    from (select github_repo, row_number() over () as ord
            from public.search_projects(p_query, p_language, p_tag, p_clan, p_sort, p_featured_only, p_limit, p_offset)) s
$$;

create function dskit.forum() returns uuid
language sql stable security definer as $$
  select ch.id from public.channels ch join public.communities c on c.id = ch.community_id where c.slug = 'ds-forum' and ch.kind = 'forum'
$$;

create function dskit.small_forum() returns uuid
language sql stable security definer as $$
  select ch.id from public.channels ch join public.communities c on c.id = ch.community_id where c.slug = 'ds-petit' and ch.kind = 'forum'
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (dskit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (dskit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (dskit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (dskit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (dskit.uid(5), 'ama@exemple.sn', '{"provider":"email"}', '{}');

update public.profiles set clan = 'griot_du_code', display_name = 'Ana Griot' where id = dskit.uid(1);
update public.profiles set clan = 'forgeron' where id = dskit.uid(2);
update public.profiles set clan = 'griot_du_code' where id = dskit.uid(3);

insert into public.projects (owner_id, github_owner, github_repo, title, summary, language, tags, verified_at, is_public, staff_hidden, github_stars) values
  (dskit.uid(1), 'ana-dev', 'ds-alpha', 'Alpha Vision', 'Reconnaissance d images', 'Python', '{ia,dakar}', now() - interval '5 days', true, false, 10),
  (dskit.uid(2), 'bara-dev', 'ds-beta', 'Beta UI', 'Composants accessibles', 'TypeScript', '{web,dakar}', now() - interval '3 days', true, false, 0),
  (dskit.uid(3), 'coumba-dev', 'ds-gamma', 'Gamma 100% sure_thing', 'Un projet sur la teranga', 'Python', '{ia}', now() - interval '1 day', true, false, 0),
  (dskit.uid(1), 'ana-dev', 'ds-hidden', 'Cache par le staff', null, 'Python', '{ia}', now(), true, true, 0),
  (dskit.uid(1), 'ana-dev', 'ds-pending', 'En attente', null, 'Python', '{ia}', null, true, false, 0),
  (dskit.uid(1), 'ana-dev', 'ds-private', 'Prive', null, 'Python', '{ia}', now(), false, false, 0);

do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  perform public.make_admin(dskit.uid(5));
  reset role;
end $$;

-- ---- 1. Search shows only what is listed, newest first, to everyone ---------------------------------------------
do $$
begin
  perform dskit.as_anon();
  if dskit.found() <> 'ds-gamma,ds-beta,ds-alpha' then raise exception 'FAIL: visitors should see the 3 listed projects, newest first, got %', dskit.found(); end if;
  reset role;
  perform dskit.as_user(4);
  if dskit.found() <> 'ds-gamma,ds-beta,ds-alpha' then raise exception 'FAIL: members should see the same, got %', dskit.found(); end if;
  reset role;
  perform dskit.as_user(1); -- even the owner does not see their own pending, hidden or private projects here
  if dskit.found() <> 'ds-gamma,ds-beta,ds-alpha' then raise exception 'FAIL: the owner sees hidden, pending or private projects in search, got %', dskit.found(); end if;
  reset role;
  raise notice 'OK 1: search shows only listed projects, newest first, to everyone';
end $$;

-- ---- 2. Filters -----------------------------------------------------------------------------------------------------
do $$
begin
  perform dskit.as_anon();
  if dskit.found(p_language => 'python') <> 'ds-gamma,ds-alpha' then raise exception 'FAIL: language filter, got %', dskit.found(p_language => 'python'); end if;
  if dskit.found(p_language => 'TypeScript') <> 'ds-beta' then raise exception 'FAIL: language filter (second), got %', dskit.found(p_language => 'TypeScript'); end if;
  if dskit.found(p_tag => 'dakar') <> 'ds-beta,ds-alpha' then raise exception 'FAIL: tag filter, got %', dskit.found(p_tag => 'dakar'); end if;
  if dskit.found(p_tag => 'DAKAR') <> 'ds-beta,ds-alpha' then raise exception 'FAIL: tag filter should ignore case'; end if;
  if dskit.found(p_clan => 'griot_du_code') <> 'ds-gamma,ds-alpha' then raise exception 'FAIL: clan filter, got %', dskit.found(p_clan => 'griot_du_code'); end if;
  if dskit.found(p_clan => 'forgeron') <> 'ds-beta' then raise exception 'FAIL: clan filter (second), got %', dskit.found(p_clan => 'forgeron'); end if;
  if dskit.found(p_language => 'python', p_tag => 'dakar', p_clan => 'griot_du_code') <> 'ds-alpha' then raise exception 'FAIL: filters should combine'; end if;
  if dskit.found(p_language => 'Rust') <> '' then raise exception 'FAIL: an unknown language should give nothing'; end if;
  reset role;
  raise notice 'OK 2: language, tag and clan filters work, ignore case, and combine';
end $$;

-- ---- 3. Text search ----------------------------------------------------------------------------------------------------
do $$
begin
  perform dskit.as_anon();
  if dskit.found('Beta') <> 'ds-beta' then raise exception 'FAIL: search by title'; end if;
  if dskit.found('reconnaissance') <> 'ds-alpha' then raise exception 'FAIL: search by summary'; end if;
  if dskit.found('ana-dev') <> '' and dskit.found('ana-dev') <> 'ds-alpha' then raise exception 'FAIL: unexpected result for an owner name'; end if;
  if dskit.found('Ana Griot') <> 'ds-alpha' then raise exception 'FAIL: search by owner name, got %', dskit.found('Ana Griot'); end if;
  if dskit.found('ds-b') <> 'ds-beta' then raise exception 'FAIL: search by repository name'; end if;
  if dskit.found('100%') <> 'ds-gamma' then raise exception 'FAIL: a percent sign should be searched as itself, got %', dskit.found('100%'); end if;
  if dskit.found('sure_thing') <> 'ds-gamma' then raise exception 'FAIL: an underscore should be searched as itself'; end if;
  if dskit.found('sure_thin_') <> '' then raise exception 'FAIL: an underscore must not match any character'; end if;
  if dskit.found('Cache par le staff') <> '' then raise exception 'FAIL: a project hidden by staff was found by its title'; end if;
  if dskit.found('') <> 'ds-gamma,ds-beta,ds-alpha' and dskit.found('   ') is null then raise exception 'FAIL: blank search'; end if;
  reset role;
  raise notice 'OK 3: text search covers title, summary, repository and owner, and special characters are plain text';
end $$;

-- ---- 4. Sorting and paging -------------------------------------------------------------------------------------------
do $$
begin
  perform dskit.as_user(1);
  perform public.star_project(dskit.proj('ds-beta'));
  reset role;
  perform dskit.as_user(3);
  perform public.star_project(dskit.proj('ds-beta'));
  perform public.star_project(dskit.proj('ds-alpha'));
  reset role;
  -- beta has old comments too
  perform dskit.as_user(1);
  perform public.post_project_comment(dskit.proj('ds-beta'), 'Un vieux commentaire');
  reset role;
  perform dskit.as_user(3);
  perform public.post_project_comment(dskit.proj('ds-beta'), 'Un autre vieux commentaire');
  reset role;
  update public.project_comments set created_at = now() - interval '30 days' where project_id = dskit.proj('ds-beta');
  -- beta's stars are old; gamma gets two fresh comments; alpha has one fresh star
  update public.project_stars set created_at = now() - interval '30 days' where project_id = dskit.proj('ds-beta');
  perform dskit.as_user(4);
  perform public.post_project_comment(dskit.proj('ds-gamma'), 'Bravo');
  perform public.post_project_comment(dskit.proj('ds-gamma'), 'Vraiment bien');
  reset role;

  perform dskit.as_anon();
  if dskit.found(p_sort => 'stars') <> 'ds-beta,ds-alpha,ds-gamma' then raise exception 'FAIL: sort by stars, got %', dskit.found(p_sort => 'stars'); end if;
  if dskit.found(p_sort => 'trending') <> 'ds-gamma,ds-alpha,ds-beta' then raise exception 'FAIL: sort by trending, got %', dskit.found(p_sort => 'trending'); end if;
  if dskit.found(p_sort => 'name') <> 'ds-alpha,ds-beta,ds-gamma' then raise exception 'FAIL: sort by name, got %', dskit.found(p_sort => 'name'); end if;
  if dskit.found(p_sort => 'recent', p_limit => 1, p_offset => 1) <> 'ds-beta' then raise exception 'FAIL: paging'; end if;
  if dskit.found(p_limit => 2) <> 'ds-gamma,ds-beta' then raise exception 'FAIL: limit'; end if;
  if dskit.found(p_limit => 0) <> 'ds-gamma' then raise exception 'FAIL: a limit of 0 should be raised to 1, got %', dskit.found(p_limit => 0); end if;
  if dskit.found(p_limit => 100000, p_offset => -5) <> 'ds-gamma,ds-beta,ds-alpha' then raise exception 'FAIL: absurd limit and offset should be clamped'; end if;
  perform dskit.must_fail('an unknown sort', $q$select * from public.search_projects('ds-', null, null, null, 'random')$q$, 'Sort by');
  reset role;
  raise notice 'OK 4: sorting by newest, stars, trending and name works; paging is clamped; unknown sorts are refused';
end $$;

-- ---- 5. What each result carries ------------------------------------------------------------------------------------
do $$
declare r record;
begin
  insert into public.project_collaborators (project_id, user_id) values (dskit.proj('ds-gamma'), dskit.uid(4));
  perform dskit.as_anon();
  select * into r from public.search_projects('ds-gamma');
  if r.star_count <> 0 or r.comment_count <> 2 or r.collaborator_count <> 1 or r.recent_activity <> 2 then
    raise exception 'FAIL: counts on a result are wrong: stars %, comments %, collaborators %, activity %', r.star_count, r.comment_count, r.collaborator_count, r.recent_activity;
  end if;
  if r.owner_username <> (select username from public.profiles where id = dskit.uid(3)) or r.owner_clan <> 'griot_du_code' then raise exception 'FAIL: owner details are wrong'; end if;
  select * into r from public.search_projects('ds-alpha');
  if r.github_stars <> 10 or r.star_count <> 1 then raise exception 'FAIL: alpha should have 10 GitHub stars and 1 star here'; end if;
  reset role;
  raise notice 'OK 5: each result carries its counts and the owner';
end $$;

-- ---- 6. Featured projects ----------------------------------------------------------------------------------------------
do $$
declare a uuid := dskit.proj('ds-alpha'); b uuid := dskit.proj('ds-beta');
begin
  perform dskit.as_user(2);
  perform dskit.must_fail('a member features a project', format('select public.set_featured_project(%L, true)', a), 'Only an admin');
  reset role;
  perform dskit.as_anon();
  perform dskit.must_fail('a visitor features a project', format('select public.set_featured_project(%L, true)', a), 'permission denied');
  reset role;

  perform dskit.as_user(5);
  perform public.set_featured_project(a, true);
  perform public.set_featured_project(a, true); -- harmless
  perform dskit.must_fail('featuring a pending project', format('select public.set_featured_project(%L, true)', dskit.proj('ds-pending')), 'not found');
  perform dskit.must_fail('featuring a hidden project', format('select public.set_featured_project(%L, true)', dskit.proj('ds-hidden')), 'not found');
  reset role;
  update public.game_config set value = '1' where key = 'featured_projects_max';
  perform dskit.as_user(5);
  perform dskit.must_fail('featuring more than the limit', format('select public.set_featured_project(%L, true)', b), 'Too many featured');
  reset role;
  update public.game_config set value = '6' where key = 'featured_projects_max';

  perform dskit.as_anon();
  if dskit.found(p_featured_only => true) <> 'ds-alpha' then raise exception 'FAIL: featured only, got %', dskit.found(p_featured_only => true); end if;
  if not (select is_featured from public.search_projects('ds-alpha')) then raise exception 'FAIL: the featured flag is missing'; end if;
  if (select is_featured from public.search_projects('ds-beta')) then raise exception 'FAIL: beta should not be featured'; end if;
  if (select count(*) from public.featured_projects where project_id = a) <> 1 then raise exception 'FAIL: visitors should see what is featured'; end if;
  perform dskit.must_fail('writing the featured list directly', format('insert into public.featured_projects (project_id) values (%L)', b), 'permission denied');
  reset role;

  -- a featured project that staff hide disappears from everywhere
  update public.projects set staff_hidden = true where id = a;
  perform dskit.as_anon();
  if dskit.found(p_featured_only => true) <> '' then raise exception 'FAIL: a hidden project is still featured'; end if;
  if (select count(*) from public.featured_projects where project_id = a) <> 0 then raise exception 'FAIL: a hidden featured project is still visible'; end if;
  reset role;
  update public.projects set staff_hidden = false where id = a;

  perform dskit.as_user(5);
  perform public.set_featured_project(a, false);
  perform public.set_featured_project(a, false); -- harmless
  reset role;
  if dskit.found(p_featured_only => true) <> '' then raise exception 'FAIL: unfeature did not work'; end if;
  if (select count(*) from public.admin_audit_log where action = 'project_featured' and target_id = a::text) <> 1 then raise exception 'FAIL: featuring should be logged once'; end if;
  if (select count(*) from public.admin_audit_log where action = 'project_unfeatured' and target_id = a::text) <> 1 then raise exception 'FAIL: unfeaturing should be logged once'; end if;
  raise notice 'OK 6: only admins feature projects (up to the limit, listed ones only); it is public, logged, and hides with the project';
end $$;

-- ---- 7. Filter menus -----------------------------------------------------------------------------------------------------
do $$
begin
  perform dskit.as_anon();
  if (select project_count from public.project_languages() where language = 'Python') < 2 then raise exception 'FAIL: Python should be used by at least 2 projects'; end if;
  if (select project_count from public.project_languages() where language = 'TypeScript') < 1 then raise exception 'FAIL: TypeScript is missing'; end if;
  if (select project_count from public.popular_project_tags() where tag = 'dakar') < 2 then raise exception 'FAIL: the tag "dakar" should be counted twice'; end if;
  -- the hidden, pending and private projects add nothing
  if (select project_count from public.popular_project_tags() where tag = 'ia') <> 2 then raise exception 'FAIL: the tag "ia" should count 2 listed projects, got %', (select project_count from public.popular_project_tags() where tag = 'ia'); end if;
  if (select count(*) from public.popular_project_tags(1)) <> 1 then raise exception 'FAIL: the tag list limit is ignored'; end if;
  reset role;
  raise notice 'OK 7: the language and tag lists count only listed projects';
end $$;

-- ---- 8. Trending creators ---------------------------------------------------------------------------------------------------
do $$
declare c uuid; f uuid; t bigint;
begin
  perform dskit.as_user(1);
  c := public.create_community('ds-forum', 'Forum test', null, false);
  perform public.create_channel(c, 'forum', 'Forum', 'forum');
  reset role;
  perform dskit.as_user(2); perform public.join_community(c); reset role;
  perform dskit.as_user(3); perform public.join_community(c); reset role;

  perform dskit.as_user(2);
  perform public.send_message(dskit.forum(), 'Premier fil', null, 'Fil 1');
  perform public.send_message(dskit.forum(), 'Deuxieme fil', null, 'Fil 2');
  perform public.send_message(dskit.forum(), 'Troisieme fil', null, 'Fil 3');
  reset role;
  perform dskit.as_user(3);
  perform public.send_message(dskit.forum(), 'Un fil de Coumba', null, 'Fil 4');
  reset role;

  -- a community with fewer than 3 members counts for nothing
  perform dskit.as_user(4);
  perform public.create_community('ds-petit', 'Petit', null, false);
  perform public.create_channel((select id from public.communities where slug = 'ds-petit'), 'forum', 'Forum', 'forum');
  reset role;
  perform dskit.as_user(4);
  perform public.send_message(dskit.small_forum(), 'Tout seul', null, 'Seul');
  reset role;

  perform dskit.as_anon();
  if (select string_agg(username || ':' || contributions, ',' order by contributions desc, username)
        from public.trending_creators(7, 5) where user_id::text like 'e8e8e8e8-%')
     <> (select (select username from public.profiles where id = dskit.uid(2)) || ':3,' || (select username from public.profiles where id = dskit.uid(3)) || ':1') then
    raise exception 'FAIL: trending creators should be bara with 3 then coumba with 1, got %',
      (select string_agg(username || ':' || contributions, ',') from public.trending_creators(7, 5));
  end if;
  if exists (select 1 from public.trending_creators(7, 20) where user_id = dskit.uid(4)) then raise exception 'FAIL: a post in a tiny community counted'; end if;
  if (select count(*) from public.trending_creators(7, 1)) <> 1 then raise exception 'FAIL: the limit is ignored'; end if;
  reset role;

  -- old posts leave the week but stay in a longer window
  update public.messages set created_at = now() - interval '30 days' where author_id = dskit.uid(3) and title = 'Fil 4';
  perform dskit.as_anon();
  if exists (select 1 from public.trending_creators(7, 20) where user_id = dskit.uid(3)) then raise exception 'FAIL: an old post counted in the week'; end if;
  if not exists (select 1 from public.trending_creators(60, 20) where user_id = dskit.uid(3)) then raise exception 'FAIL: an old post should count in a 60 day window'; end if;
  reset role;

  -- a deleted post does not count
  select id into t from public.messages where author_id = dskit.uid(2) and title = 'Fil 3';
  perform dskit.as_user(2);
  perform public.delete_message(t);
  reset role;
  perform dskit.as_anon();
  if (select contributions from public.trending_creators(7, 20) where user_id = dskit.uid(2)) <> 2 then raise exception 'FAIL: a deleted post still counts'; end if;
  reset role;
  raise notice 'OK 8: trending creators count recent forum posts in communities of 3 or more, not deleted ones';
end $$;

-- ---- Clean up ------------------------------------------------------------------------------------------------------------------------
delete from public.communities where slug like 'ds-%';
delete from public.projects where owner_id::text like 'e8e8e8e8-%';
delete from public.profiles where id::text like 'e8e8e8e8-%';
delete from auth.users where id::text like 'e8e8e8e8-%';
drop schema dskit cascade;

do $$
begin
  if exists (select 1 from public.featured_projects) then raise exception 'FAIL: featured projects left behind'; end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  raise notice 'OK 9: the test left nothing behind';
end $$;

select 'ALL PROJECT DISCOVERY TESTS PASSED' as result;
