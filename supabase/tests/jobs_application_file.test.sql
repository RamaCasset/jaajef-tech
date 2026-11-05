-- Tests for Jobs part 2 (the application file).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f jobs_application_file.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) builds her file; bara (...2) is another member; guest (...3) has no file.

create schema afkit;
grant usage on schema afkit to public;

create function afkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('b8b8b8b8-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function afkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', afkit.uid(p_n)::text, true);
end $$;

create function afkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function afkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function afkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := afkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- A CV path in a member's own folder, with a fixed id so tests can name it.
create function afkit.cv(p_n int, p_k int) returns text
language sql immutable as $$
  select afkit.uid(p_n)::text || '/0000000' || p_k || '-0000-0000-0000-000000000000.pdf'
$$;

create function afkit.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

create function afkit.pct(p_n int) returns integer
language plpgsql as $$
declare v integer;
begin
  perform afkit.as_user(p_n);
  select completion into v from public.my_application_file();
  reset role;
  return v;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (afkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (afkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (afkit.uid(3), 'guest@exemple.sn', '{"provider":"email"}', '{}');

insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public) values
  (afkit.uid(1), 'ana-dev', 'outil-ana', 'Outil Ana', now(), true),
  (afkit.uid(2), 'bara-dev', 'outil-bara', 'Outil Bara', now(), true);

-- ---- 1. An empty file ------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform afkit.as_user(1);
  select * into r from public.my_application_file();
  if r.completion <> 0 or r.portfolio_count <> 0 or r.headline is not null or r.cv_name is not null then raise exception 'FAIL: an empty file should be empty'; end if;
  if r.missing <> array['headline', 'summary', 'location', 'experience_years', 'availability', 'skills', 'portfolio', 'cv'] then raise exception 'FAIL: all 8 parts missing, got %', r.missing; end if;
  if r.skills <> '{}' or r.work_kinds <> '{}' then raise exception 'FAIL: empty lists expected'; end if;
  reset role;
  perform afkit.as_anon();
  perform afkit.must_fail('a visitor reads the file', 'select * from public.my_application_file()', 'permission denied');
  perform afkit.must_fail('a visitor saves a file', $q$select public.save_application_file('a', 'b', 'c', 1, 'immediate', '{}', '{}')$q$, 'permission denied');
  reset role;
  raise notice 'OK 1: an empty file shows 0 percent and the 8 missing parts; visitors have no access';
end $$;

-- ---- 2. Saving the written parts ------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform afkit.as_user(1);
  perform afkit.must_fail('a long headline', format('select public.save_application_file(%L, null, null, null, null, %L, %L)', repeat('a', 101), '{}', '{}'), 'headline is too long');
  perform afkit.must_fail('a long text about you', format('select public.save_application_file(null, %L, null, null, null, %L, %L)', repeat('a', 1001), '{}', '{}'), 'too long');
  perform afkit.must_fail('a long place', format('select public.save_application_file(null, null, %L, null, null, %L, %L)', repeat('a', 101), '{}', '{}'), 'place is too long');
  perform afkit.must_fail('negative experience', $q$select public.save_application_file(null, null, null, -1, null, '{}', '{}')$q$, 'between 0 and 60');
  perform afkit.must_fail('experience over 60', $q$select public.save_application_file(null, null, null, 61, null, '{}', '{}')$q$, 'between 0 and 60');
  perform afkit.must_fail('a bad availability', $q$select public.save_application_file(null, null, null, null, 'bientot', '{}', '{}')$q$, 'Choose immediate');
  perform afkit.must_fail('a bad kind of work', $q$select public.save_application_file(null, null, null, null, null, array['stage'], '{}')$q$, 'job or freelance');
  perform afkit.must_fail('a bad skill', $q$select public.save_application_file(null, null, null, null, null, '{}', array['a b'])$q$, 'Skills use');
  perform afkit.must_fail('21 skills', format('select public.save_application_file(null, null, null, null, null, %L, %L)', '{}', (select array_agg('skill' || lpad(i::text, 2, '0')) from generate_series(1, 21) i)), 'At most 20');
  perform afkit.must_fail('a website that is not https', $q$select public.save_application_file(null, null, null, null, null, '{}', '{}', 'http://exemple.sn')$q$, 'secure');
  perform afkit.must_fail('a LinkedIn link that is not https', $q$select public.save_application_file(null, null, null, null, null, '{}', '{}', null, 'linkedin.com/in/ana')$q$, 'secure');
  if exists (select 1 from public.application_files) then raise exception 'FAIL: a refused save created a file'; end if;

  perform public.save_application_file('  Developpeuse full-stack ', 'Je construis des applications web.', 'Dakar', 4, 'within_month',
                                       array['job', 'freelance', 'job'], array['Python', ' python ', 'Django'], 'https://ana.sn', 'https://linkedin.com/in/ana');
  select * into r from public.my_application_file();
  if r.headline <> 'Developpeuse full-stack' then raise exception 'FAIL: the headline should be trimmed'; end if;
  if r.skills <> array['python', 'django'] then raise exception 'FAIL: skills should be cleaned, got %', r.skills; end if;
  if r.work_kinds <> array['job', 'freelance'] then raise exception 'FAIL: kinds should have no repeats, got %', r.work_kinds; end if;
  if r.completion <> 40 then raise exception 'FAIL: headline, text, place, experience and availability make 40, got %', r.completion; end if;
  if r.missing <> array['skills', 'portfolio', 'cv'] then raise exception 'FAIL: skills, portfolio and cv missing, got %', r.missing; end if;

  perform public.save_application_file('Developpeuse full-stack', 'Je construis des applications web.', 'Dakar', 4, 'within_month', '{}', array['python', 'django', 'sql']);
  select * into r from public.my_application_file();
  if r.completion <> 60 then raise exception 'FAIL: three skills add 20, got %', r.completion; end if;
  if r.website is not null or r.work_kinds <> '{}' then raise exception 'FAIL: saving sends the whole form, so earlier extras are replaced'; end if;

  perform public.save_application_file('  ', '', null, null, null, null, null);
  select * into r from public.my_application_file();
  if r.completion <> 0 then raise exception 'FAIL: blank parts do not count, got %', r.completion; end if;
  perform public.save_application_file('Developpeuse full-stack', 'Je construis des applications web.', 'Dakar', 0, 'immediate', '{}', array['python', 'django', 'sql']);
  reset role;
  if (select count(*) from public.application_files where user_id = afkit.uid(1)) <> 1 then raise exception 'FAIL: one file per member'; end if;
  raise notice 'OK 2: the written parts are checked and cleaned; the percentage follows (zero years of experience still counts)';
end $$;

-- ---- 3. Portfolio ----------------------------------------------------------------------------------------------------
do $$
declare a uuid; b uuid; mine uuid := (select id from public.projects where github_repo = 'outil-ana'); theirs uuid := (select id from public.projects where github_repo = 'outil-bara');
begin
  perform afkit.as_user(1);
  perform afkit.must_fail('a short title', $q$select public.add_portfolio_item('a', null, 'https://exemple.sn')$q$, 'at least 2');
  perform afkit.must_fail('a link that is not https', $q$select public.add_portfolio_item('Mon site', null, 'http://exemple.sn')$q$, 'secure');
  perform afkit.must_fail('no link and no project', $q$select public.add_portfolio_item('Mon site')$q$, 'Add a link');
  perform afkit.must_fail('someone else''s project', format('select public.add_portfolio_item(%L, null, null, %L)', 'Pas a moi', theirs), 'only add your own');
  perform afkit.must_fail('a long description', format('select public.add_portfolio_item(%L, %L, %L)', 'Mon site', repeat('a', 501), 'https://exemple.sn'), 'too long');
  a := public.add_portfolio_item('Mon site', 'Un site vitrine', 'https://ana.sn');
  b := public.add_portfolio_item('Mon outil', null, null, mine);
  if (select count(*) from public.portfolio_items) <> 2 then raise exception 'FAIL: ana should see her 2 items'; end if;
  if (select completion from public.my_application_file()) <> 80 then raise exception 'FAIL: the portfolio adds 20, got %', (select completion from public.my_application_file()); end if;
  if (select portfolio_count from public.my_application_file()) <> 2 then raise exception 'FAIL: portfolio count'; end if;

  perform public.update_portfolio_item(a, 'Mon site web', 'Nouveau texte', 'https://ana.sn/new');
  perform afkit.must_fail('an update with a bad link', format('select public.update_portfolio_item(%L, %L, null, %L)', a, 'Mon site web', 'http://x.sn'), 'secure');
  if (select title from public.portfolio_items where id = a) <> 'Mon site web' then raise exception 'FAIL: the update did not apply'; end if;
  reset role;

  perform afkit.as_user(2);
  if exists (select 1 from public.portfolio_items) then raise exception 'FAIL: bara sees ana''s portfolio'; end if;
  perform afkit.must_fail('editing someone else''s item', format('select public.update_portfolio_item(%L, %L, null, %L)', a, 'Pirate', 'https://x.sn'), 'not found');
  perform afkit.must_fail('deleting someone else''s item', format('select public.delete_portfolio_item(%L)', a), 'not found');
  reset role;

  perform afkit.set_config('portfolio_max_items', '2');
  perform afkit.as_user(1);
  perform afkit.must_fail('a full portfolio', $q$select public.add_portfolio_item('Trop', null, 'https://exemple.sn')$q$, 'portfolio is full');
  perform public.delete_portfolio_item(b);
  perform public.add_portfolio_item('Autre', null, 'https://exemple.sn');
  reset role;
  perform afkit.set_config('portfolio_max_items', '10');
  raise notice 'OK 3: portfolio items need a link or an own project; the limit holds; others cannot see or touch them';
end $$;

-- ---- 4. The CV ------------------------------------------------------------------------------------------------------------
do $$
declare p1 text := afkit.cv(1, 1); p2 text := afkit.cv(1, 2); other text := afkit.cv(2, 1); old text;
begin
  perform afkit.as_user(1);
  perform afkit.must_fail('a CV that was never uploaded', format('select public.set_cv(%L, %L, 1000)', p1, 'cv.pdf'), 'not uploaded');
  -- the bucket lets a member upload only into her own folder
  insert into storage.objects (bucket_id, name) values ('cv-files', p1);
  perform afkit.must_fail('uploading into someone else''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'cv-files', other), 'row-level security');
  perform afkit.must_fail('uploading into the root', $q$insert into storage.objects (bucket_id, name) values ('cv-files', 'vrac.pdf')$q$, 'row-level security');
  reset role;
  perform afkit.as_user(2);
  insert into storage.objects (bucket_id, name) values ('cv-files', other);
  reset role;

  perform afkit.as_user(1);
  perform afkit.must_fail('another member''s file', format('select public.set_cv(%L, %L, 1000)', other, 'cv.pdf'), 'in your own folder');
  perform afkit.must_fail('a path with the wrong shape', format('select public.set_cv(%L, %L, 1000)', afkit.uid(1)::text || '/cv.pdf', 'cv.pdf'), 'in your own folder');
  perform afkit.must_fail('a path that is not a PDF', format('select public.set_cv(%L, %L, 1000)', afkit.uid(1)::text || '/00000009-0000-0000-0000-000000000000.png', 'cv.pdf'), 'in your own folder');
  perform afkit.must_fail('a file name that is not a PDF', format('select public.set_cv(%L, %L, 1000)', p1, 'cv.docx'), 'must be a PDF');
  perform afkit.must_fail('an empty name', format('select public.set_cv(%L, %L, 1000)', p1, '  '), 'must be a PDF');
  perform afkit.must_fail('a size of zero', format('select public.set_cv(%L, %L, 0)', p1, 'cv.pdf'), 'too large');
  perform afkit.must_fail('a CV over 5 MB', format('select public.set_cv(%L, %L, 5242881)', p1, 'cv.pdf'), '5 MB');
  if (select completion from public.my_application_file()) <> 80 then raise exception 'FAIL: refused CVs must not count'; end if;

  old := public.set_cv(p1, ' Mon CV.PDF ', 120000);
  if old is not null then raise exception 'FAIL: nothing to replace yet'; end if;
  if (select cv_name from public.my_application_file()) <> 'Mon CV.PDF' or (select cv_size from public.my_application_file()) <> 120000 then raise exception 'FAIL: the CV details were not saved'; end if;
  if (select completion from public.my_application_file()) <> 100 then raise exception 'FAIL: the CV adds 20, got %', (select completion from public.my_application_file()); end if;
  if (select missing from public.my_application_file()) <> '{}' then raise exception 'FAIL: nothing should be missing'; end if;
  if public.set_cv(p1, 'cv.pdf', 1000) is not null then raise exception 'FAIL: recording the same file again replaces nothing'; end if;

  insert into storage.objects (bucket_id, name) values ('cv-files', p2);
  if public.set_cv(p2, 'cv v2.pdf', 130000) <> p1 then raise exception 'FAIL: the old path should be returned'; end if;
  if (select cv_name from public.my_application_file()) <> 'cv v2.pdf' then raise exception 'FAIL: the new CV should be recorded'; end if;
  reset role;

  -- the files are private
  perform afkit.as_user(2);
  if exists (select 1 from storage.objects where name in (p1, p2)) then raise exception 'FAIL: bara can see ana''s CV files'; end if;
  delete from storage.objects where name = p2;
  delete from storage.objects; -- no filter at all: still only her own files
  reset role;
  if not exists (select 1 from storage.objects where name = p2) then raise exception 'FAIL: bara deleted ana''s CV file'; end if;
  if exists (select 1 from storage.objects where name = other) then raise exception 'FAIL: an unfiltered delete should remove bara''s own file'; end if;
  perform afkit.as_anon();
  perform afkit.must_fail('a visitor opens a CV', 'select * from storage.objects', 'permission denied');
  reset role;
  perform afkit.as_user(1);
  if (select count(*) from storage.objects where bucket_id = 'cv-files') <> 2 then raise exception 'FAIL: ana should see her own 2 files'; end if;
  delete from storage.objects where name = p1; -- she can delete her old file
  reset role;
  if exists (select 1 from storage.objects where name = p1) then raise exception 'FAIL: ana should be able to delete her own file'; end if;

  perform afkit.as_user(1);
  if public.remove_cv() <> p2 then raise exception 'FAIL: removing returns the path to delete'; end if;
  if public.remove_cv() is not null then raise exception 'FAIL: nothing left to remove'; end if;
  if (select completion from public.my_application_file()) <> 80 then raise exception 'FAIL: without the CV it is 80'; end if;
  if (select cv_name from public.my_application_file()) is not null then raise exception 'FAIL: the CV record should be gone'; end if;
  delete from storage.objects where name = p2;
  reset role;
  raise notice 'OK 4: a CV must be a small PDF really uploaded in the member''s own folder; replacing and removing return the old path; files are private';
end $$;

-- ---- 5. The file is private --------------------------------------------------------------------------------------
do $$
begin
  perform afkit.as_user(2);
  if exists (select 1 from public.application_files) then raise exception 'FAIL: bara sees ana''s file'; end if;
  if (select completion from public.my_application_file()) <> 0 then raise exception 'FAIL: bara has her own empty file'; end if;
  perform afkit.must_fail('writing a file directly', format('insert into public.application_files (user_id, headline) values (%L, %L)', afkit.uid(2), 'x'), 'permission denied');
  perform afkit.must_fail('editing a file directly', format('update public.application_files set headline = %L where user_id = %L', 'pirate', afkit.uid(1)), 'permission denied');
  perform afkit.must_fail('writing a portfolio item directly', format('insert into public.portfolio_items (user_id, title, url) values (%L, %L, %L)', afkit.uid(2), 'xx', 'https://x.sn'), 'permission denied');
  perform afkit.must_fail('deleting a file directly', format('delete from public.application_files where user_id = %L', afkit.uid(1)), 'permission denied');
  reset role;
  perform afkit.as_anon();
  perform afkit.must_fail('a visitor reads files', 'select count(*) from public.application_files', 'permission denied');
  perform afkit.must_fail('a visitor reads portfolios', 'select count(*) from public.portfolio_items', 'permission denied');
  reset role;
  raise notice 'OK 5: nobody reads or writes another member''s file, directly or otherwise';
end $$;

-- ---- 6. Erasing the whole file --------------------------------------------------------------------------------------
do $$
declare p text := afkit.cv(1, 3);
begin
  perform afkit.as_user(1);
  insert into storage.objects (bucket_id, name) values ('cv-files', p);
  perform public.set_cv(p, 'cv.pdf', 1000);
  if public.delete_application_file() <> p then raise exception 'FAIL: erasing returns the CV path to delete'; end if;
  if exists (select 1 from public.application_files) or exists (select 1 from public.portfolio_items) then raise exception 'FAIL: erasing should remove the file and the portfolio'; end if;
  if public.delete_application_file() is not null then raise exception 'FAIL: nothing left to erase'; end if;
  if (select completion from public.my_application_file()) <> 0 then raise exception 'FAIL: back to an empty file'; end if;
  delete from storage.objects where name = p;
  reset role;
  perform afkit.as_user(2);
  perform public.add_portfolio_item('Pour bara', null, null, (select id from public.projects where github_repo = 'outil-bara'));
  reset role;
  delete from public.projects where github_repo = 'outil-bara';
  perform afkit.as_user(2);
  if exists (select 1 from public.portfolio_items) then raise exception 'FAIL: an item that points to a deleted project should go with it'; end if;
  reset role;
  raise notice 'OK 6: erasing removes the file and the portfolio and returns the CV path; an item pointing to a deleted project goes with it';
end $$;

-- ---- Clean up ----------------------------------------------------------------------------------------------------------------
delete from storage.objects where bucket_id = 'cv-files';
delete from public.projects where github_repo in ('outil-ana', 'outil-bara');
delete from public.profiles where id::text like 'b8b8b8b8-%';
delete from auth.users where id::text like 'b8b8b8b8-%';
drop schema afkit cascade;

do $$
begin
  if exists (select 1 from public.application_files) or exists (select 1 from public.portfolio_items) then raise exception 'FAIL: files left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'portfolio_max_items') <> '10'
     or (select value #>> '{}' from public.game_config where key = 'cv_max_mb') <> '5' then
    raise exception 'FAIL: a limit was left changed';
  end if;
  if (select public from storage.buckets where id = 'cv-files') then raise exception 'FAIL: the CV bucket is public'; end if;
  if (select file_size_limit from storage.buckets where id = 'cv-files') <> 5242880 then raise exception 'FAIL: the CV bucket size limit is wrong'; end if;
  if (select allowed_mime_types from storage.buckets where id = 'cv-files') <> array['application/pdf'] then raise exception 'FAIL: the CV bucket should accept only PDFs'; end if;
  raise notice 'OK 7: the test left nothing behind; the bucket is private, 5 MB, PDF only';
end $$;

select 'ALL JOBS (APPLICATION FILE) TESTS PASSED' as result;
