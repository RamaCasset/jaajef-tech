-- Tests for Jobs part 5 (talent directory).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f jobs_talent_directory.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) full file; bara (2) small file; coumba (3) approved company; dame (4) admin;
-- guest (5) company waiting for approval; fatou (6) no file; eli (7) full file, will say "not looking".

create schema tdkit;
grant usage on schema tdkit to public;

create function tdkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('8f8f8f8f-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function tdkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', tdkit.uid(p_n)::text, true);
end $$;

create function tdkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function tdkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function tdkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function tdkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := tdkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function tdkit.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

-- How many people the signed-in employer finds with the given words.
create function tdkit.found(p_n int, p_query text default null, p_skill text default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  perform tdkit.as_user(p_n);
  select count(*) into v from public.search_talent(p_query, p_skill);
  reset role;
  return v;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (tdkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(5), 'guest@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}'),
  (tdkit.uid(7), 'eli@exemple.sn', '{"provider":"email"}', '{}');

-- ---- Setup ------------------------------------------------------------------------------------------------------
do $$
declare e uuid;
begin
  perform tdkit.as_server();
  perform public.make_admin(tdkit.uid(4));
  reset role;
  perform tdkit.as_user(3);
  e := public.create_employer('company', 'Atelier Coumba');
  reset role;
  perform tdkit.as_user(4);
  perform public.review_employer(e, true);
  reset role;
  perform tdkit.as_user(5);
  perform public.create_employer('company', 'Guest SARL');
  reset role;

  perform tdkit.as_user(1);
  perform public.save_application_file('Developpeuse full-stack', 'Je construis des applications web.', 'Dakar', 4, 'immediate', array['job', 'freelance'], array['python', 'django', 'sql'], 'https://ana.sn', 'https://linkedin.com/in/ana');
  perform public.add_portfolio_item('Mon site', 'Un site vitrine', 'https://ana.sn');
  reset role;
  perform tdkit.as_user(2);
  perform public.save_application_file('Debutant motive', null, null, null, 'within_month', '{}', '{}');
  reset role;
  perform tdkit.as_user(7);
  perform public.save_application_file('Data engineer', 'Pipelines de donnees.', 'Thies', 8, 'within_month', array['freelance'], array['python', 'spark', 'sql'], 'https://eli.sn', 'https://linkedin.com/in/eli');
  perform public.add_portfolio_item('Pipeline', 'Un pipeline', 'https://eli.sn');
  reset role;
end $$;

-- ---- 1. Joining and leaving -----------------------------------------------------------------------------------
do $$
begin
  perform tdkit.as_anon();
  perform tdkit.must_fail('a visitor joins', 'select public.join_talent_directory()', 'permission denied');
  reset role;
  perform tdkit.as_user(6);
  perform tdkit.must_fail('joining without a file', 'select public.join_talent_directory()', 'application file');
  reset role;
  perform tdkit.as_user(2);
  perform tdkit.must_fail('joining with a file that is too empty', 'select public.join_talent_directory()', 'at least 60 percent');
  reset role;
  perform tdkit.set_config('talent_min_completion', '0');
  perform tdkit.as_user(2);
  if (select listed from public.my_talent_listing()) then raise exception 'FAIL: not listed by default'; end if;
  perform public.join_talent_directory();
  perform public.join_talent_directory();
  if not (select listed and visible from public.my_talent_listing()) then raise exception 'FAIL: bara listed and visible'; end if;
  perform public.leave_talent_directory();
  perform public.leave_talent_directory();
  if (select listed from public.my_talent_listing()) then raise exception 'FAIL: bara left'; end if;
  reset role;
  perform tdkit.set_config('talent_min_completion', '60');

  perform tdkit.as_user(1);
  perform public.join_talent_directory();
  reset role;
  perform tdkit.as_user(7);
  perform public.join_talent_directory();
  reset role;
  raise notice 'OK 1: joining is a choice, needs a real file, and leaving is one call';
end $$;

-- ---- 2. Who can browse ------------------------------------------------------------------------------------------
do $$
begin
  perform tdkit.as_anon();
  perform tdkit.must_fail('a visitor browses', 'select * from public.search_talent()', 'permission denied');
  reset role;
  perform tdkit.as_user(1);
  perform tdkit.must_fail('an ordinary member browses', 'select * from public.search_talent()', 'Only approved companies');
  perform tdkit.must_fail('an ordinary member opens a profile', format('select * from public.get_talent(%L)', tdkit.uid(7)), 'Only approved companies');
  reset role;
  perform tdkit.as_user(5);
  perform tdkit.must_fail('a company waiting for approval browses', 'select * from public.search_talent()', 'Only approved companies');
  reset role;
  perform tdkit.as_user(3);
  if (select count(*) from public.search_talent()) <> 2 then raise exception 'FAIL: the approved company finds the 2 listed members, got %', (select count(*) from public.search_talent()); end if;
  if (select public.can_browse_talent()) is not true then raise exception 'FAIL: can browse'; end if;
  reset role;
  perform tdkit.as_user(1);
  if public.can_browse_talent() then raise exception 'FAIL: ana cannot browse'; end if;
  reset role;
  raise notice 'OK 2: only owners of approved company or hiring profiles can browse';
end $$;

-- ---- 3. Search and filters ------------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform tdkit.as_user(3);
  if (select count(*) from public.search_talent(p_skill => 'django')) <> 1 then raise exception 'FAIL: skill filter'; end if;
  if (select count(*) from public.search_talent(p_skill => ' SQL ')) <> 2 then raise exception 'FAIL: skill filter is cleaned'; end if;
  if (select count(*) from public.search_talent(p_query => 'pipelines')) <> 1 then raise exception 'FAIL: words in the summary'; end if;
  if (select count(*) from public.search_talent(p_query => 'spark')) <> 1 then raise exception 'FAIL: words in the skills'; end if;
  if (select count(*) from public.search_talent(p_location => 'dak')) <> 1 then raise exception 'FAIL: place'; end if;
  if (select count(*) from public.search_talent(p_work_kind => 'job')) <> 1 then raise exception 'FAIL: kind of work'; end if;
  if (select count(*) from public.search_talent(p_availability => 'within_month')) <> 1 then raise exception 'FAIL: availability'; end if;
  if (select count(*) from public.search_talent(p_min_years => 5)) <> 1 then raise exception 'FAIL: minimum years'; end if;
  if (select count(*) from public.search_talent(p_query => '%')) <> 0 then raise exception 'FAIL: a percent sign is not a wildcard'; end if;
  perform tdkit.must_fail('unknown kind', 'select * from public.search_talent(p_work_kind => ''gig'')', 'Unknown kind');
  perform tdkit.must_fail('unknown availability', 'select * from public.search_talent(p_availability => ''not_looking'')', 'Unknown availability');
  select * into r from public.search_talent(p_skill => 'django');
  if r.user_id <> tdkit.uid(1) or r.headline <> 'Developpeuse full-stack' or r.portfolio_count <> 1 or r.experience_years <> 4 then raise exception 'FAIL: result row %', r; end if;

  -- the full profile
  select * into r from public.get_talent(tdkit.uid(1));
  if r.website <> 'https://ana.sn' or jsonb_array_length(r.portfolio) <> 1 or r.portfolio -> 0 ->> 'title' <> 'Mon site' then raise exception 'FAIL: full profile'; end if;
  perform tdkit.must_fail('someone not listed', format('select * from public.get_talent(%L)', tdkit.uid(2)), 'Profile not found');
  perform tdkit.must_fail('someone unknown', format('select * from public.get_talent(%L)', gen_random_uuid()), 'Profile not found');
  reset role;
  raise notice 'OK 3: search filters and the full profile work';
end $$;

-- ---- 4. The listing follows the file ---------------------------------------------------------------------------
do $$
begin
  -- edits show right away
  perform tdkit.as_user(1);
  perform public.save_application_file('Ingenieure logiciel', 'Je construis des applications web.', 'Dakar', 4, 'immediate', array['job', 'freelance'], array['python', 'django', 'sql'], 'https://ana.sn', 'https://linkedin.com/in/ana');
  reset role;
  perform tdkit.as_user(3);
  if (select headline from public.search_talent(p_skill => 'django')) <> 'Ingenieure logiciel' then raise exception 'FAIL: the listing shows the file as it is now'; end if;
  reset role;
  -- "not looking" hides
  perform tdkit.as_user(7);
  perform public.save_application_file('Data engineer', 'Pipelines de donnees.', 'Thies', 8, 'not_looking', array['freelance'], array['python', 'spark', 'sql'], 'https://eli.sn', 'https://linkedin.com/in/eli');
  if (select visible from public.my_talent_listing()) then raise exception 'FAIL: not looking means not visible'; end if;
  if not (select listed from public.my_talent_listing()) then raise exception 'FAIL: still listed, only hidden'; end if;
  reset role;
  if tdkit.found(3) <> 1 then raise exception 'FAIL: eli is hidden while not looking'; end if;
  perform tdkit.as_user(3);
  perform tdkit.must_fail('profile of someone not looking', format('select * from public.get_talent(%L)', tdkit.uid(7)), 'Profile not found');
  reset role;
  perform tdkit.as_user(7);
  perform public.save_application_file('Data engineer', 'Pipelines de donnees.', 'Thies', 8, 'within_month', array['freelance'], array['python', 'spark', 'sql'], 'https://eli.sn', 'https://linkedin.com/in/eli');
  reset role;
  if tdkit.found(3) <> 2 then raise exception 'FAIL: eli is back'; end if;
  -- a suspended member is not shown
  insert into public.member_suspensions (user_id, reason, until) values (tdkit.uid(7), 'test', now() + interval '1 day');
  if tdkit.found(3) <> 1 then raise exception 'FAIL: a suspended member is not shown'; end if;
  delete from public.member_suspensions where user_id = tdkit.uid(7);
  raise notice 'OK 4: the listing follows the file, hides "not looking" and suspended members';
end $$;

-- ---- 5. Staff hiding ---------------------------------------------------------------------------------------------
do $$
declare n_before bigint;
begin
  perform tdkit.as_user(3);
  perform tdkit.must_fail('a company hides a listing', format('select public.set_talent_hidden(%L, true, %L)', tdkit.uid(7), 'x'), 'Only staff');
  reset role;
  perform tdkit.as_user(4);
  perform tdkit.must_fail('hiding without a reason', format('select public.set_talent_hidden(%L, true)', tdkit.uid(7)), 'reason');
  perform tdkit.must_fail('an unknown listing', format('select public.set_talent_hidden(%L, true, %L)', gen_random_uuid(), 'x'), 'Listing not found');
  select count(*) into n_before from public.admin_audit_log;
  perform public.set_talent_hidden(tdkit.uid(7), true, 'Contenu inapproprie');
  perform public.set_talent_hidden(tdkit.uid(7), true, 'Contenu inapproprie'); -- again: no second log
  if (select count(*) from public.admin_audit_log) <> n_before + 1 then raise exception 'FAIL: one audit entry for the hide'; end if;
  if (select count(*) from public.talent_listings) <> 3 then raise exception 'FAIL: staff read all listings'; end if;
  reset role;
  if tdkit.found(3) <> 1 then raise exception 'FAIL: hidden by staff'; end if;
  perform tdkit.as_user(7);
  if (select visible from public.my_talent_listing()) or not (select hidden_by_staff from public.my_talent_listing()) then raise exception 'FAIL: eli sees that staff hid it'; end if;
  perform public.leave_talent_directory();
  perform public.join_talent_directory(); -- joining again must not undo the staff hide
  if (select visible from public.my_talent_listing()) then raise exception 'FAIL: rejoining should not clear a staff hide'; end if;
  reset role;
  perform tdkit.as_user(4);
  perform public.set_talent_hidden(tdkit.uid(7), false);
  reset role;
  if tdkit.found(3) <> 2 then raise exception 'FAIL: shown again'; end if;
  raise notice 'OK 5: staff can hide and show a listing, with the audit log, and rejoining does not undo it';
end $$;

-- ---- 6. Leaving removes the listing; the file going removes it too -----------------------------------------
do $$
begin
  perform tdkit.as_user(1);
  perform public.leave_talent_directory();
  reset role;
  if tdkit.found(3) <> 1 then raise exception 'FAIL: ana left'; end if;
  perform tdkit.as_user(3);
  perform tdkit.must_fail('profile of someone who left', format('select * from public.get_talent(%L)', tdkit.uid(1)), 'Profile not found');
  reset role;
  perform tdkit.as_user(1);
  perform public.join_talent_directory();
  reset role;
  if tdkit.found(3) <> 2 then raise exception 'FAIL: ana is back'; end if;
  -- deleting the application file deletes the listing
  perform tdkit.as_user(7);
  perform public.delete_application_file();
  reset role;
  if exists (select 1 from public.talent_listings where user_id = tdkit.uid(7)) then raise exception 'FAIL: the listing goes with the file'; end if;
  if tdkit.found(3) <> 1 then raise exception 'FAIL: eli is gone from the directory'; end if;
  raise notice 'OK 6: leaving and deleting the file both remove a member from the directory';
end $$;

-- ---- 7. Nobody writes the table directly, and the CV stays out ----------------------------------------------
do $$
begin
  perform tdkit.as_user(1);
  perform tdkit.must_fail('direct insert', format('insert into public.talent_listings (user_id) values (%L)', tdkit.uid(1)), 'permission denied');
  perform tdkit.must_fail('direct update', 'update public.talent_listings set staff_hidden = false', 'permission denied');
  perform tdkit.must_fail('direct delete', 'delete from public.talent_listings', 'permission denied');
  if (select count(*) from public.talent_listings) <> 1 then raise exception 'FAIL: a member reads only her own listing'; end if;
  reset role;
  perform tdkit.as_user(3);
  if exists (select 1 from public.talent_listings) then raise exception 'FAIL: a company cannot read the table directly'; end if;
  if exists (select 1 from jsonb_object_keys(to_jsonb((select s from public.search_talent() s limit 1))) k where k like 'cv%') then raise exception 'FAIL: the CV must not appear in search'; end if;
  if exists (select 1 from jsonb_object_keys(to_jsonb((select g from public.get_talent(tdkit.uid(1)) g))) k where k like 'cv%') then raise exception 'FAIL: the CV must not appear in a profile'; end if;
  reset role;
  raise notice 'OK 7: the table is read-only and the CV is never part of the directory';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.profiles where id::text like '8f8f8f8f-%';
delete from auth.users where id::text like '8f8f8f8f-%';
drop schema tdkit cascade;

do $$
begin
  if exists (select 1 from public.talent_listings) or exists (select 1 from public.employers) or exists (select 1 from public.application_files) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'talent_min_completion') <> '60' then
    raise exception 'FAIL: a setting was left changed';
  end if;
  raise notice 'OK 8: the test left nothing behind';
end $$;

select 'ALL JOBS (TALENT DIRECTORY) TESTS PASSED' as result;
