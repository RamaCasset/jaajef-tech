-- Tests for the file cleanup migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f file_cleanup.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- Files are created in the stand-in storage table, old ones aged by hand.

create schema fckit;
grant usage on schema fckit to public;

create function fckit.uid(p_n int) returns uuid
language sql immutable as $$ select ('c4c4c4c4-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function fckit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', fckit.uid(p_n)::text, true);
end $$;

create function fckit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function fckit.as_service() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function fckit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function fckit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := fckit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- The leftovers named in this test, as 'bucket:file,bucket:file'.
create function fckit.left(p_limit int default 500) returns text
language plpgsql as $$
begin
  return coalesce((select string_agg(bucket_id || ':' || regexp_replace(name, '^.*/', ''), ',' order by name)
                     from public.files_to_clean(p_limit) where name like 'c4c4c4c4-%'), '');
end $$;

create function fckit.age(p_name text, p_hours int) returns void
language sql as $$ update storage.objects set created_at = now() - make_interval(hours => p_hours) where name = p_name $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (fckit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (fckit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}');

-- Files: CV in use by the file, CV in use by an application, CV nobody uses, a fresh CV nobody uses,
-- Souk image of a waiting submission, of a shop item, one nobody uses, a fresh unused one.
insert into storage.objects (bucket_id, name) values
  ('cv-files', 'c4c4c4c4-0000-0000-0000-000000000001/cv-current'),
  ('cv-files', 'c4c4c4c4-0000-0000-0000-000000000001/cv-sent'),
  ('cv-files', 'c4c4c4c4-0000-0000-0000-000000000001/cv-old'),
  ('cv-files', 'c4c4c4c4-0000-0000-0000-000000000001/cv-fresh'),
  ('souk-images', 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000a.png'),
  ('souk-images', 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000b.png'),
  ('souk-images', 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000c.png'),
  ('souk-images', 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000d.png'),
  ('dm-files', 'c4c4c4c4-0000-0000-0000-000000000001/dm-old');

select fckit.age(name, 100) from storage.objects where name like 'c4c4c4c4-%' and name not like '%-fresh' and name not like '%00d.png';

-- Make the references. These tables are written directly here, as the test database owner.
insert into public.application_files (user_id, cv_path, cv_name, cv_size, cv_uploaded_at)
values (fckit.uid(1), 'c4c4c4c4-0000-0000-0000-000000000001/cv-current', 'cv.pdf', 1000, now());

insert into public.job_applications (applicant_id, offer_title, employer_name, cv_path, cv_name, cv_size)
values (fckit.uid(1), 'Offre', 'Entreprise', 'c4c4c4c4-0000-0000-0000-000000000001/cv-sent', 'cv.pdf', 1000);

insert into public.souk_items (slug, kind, name, price_kopeks, data, creator_id)
values ('fc-item', 'avatar_frame', 'fc-item', 10, jsonb_build_object('image_path', 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000b.png'), fckit.uid(2));

insert into public.souk_submissions (creator_id, kind, name, proposed_price, image_path)
values (fckit.uid(2), 'avatar_frame', 'fc-sub', 10, 'c4c4c4c4-0000-0000-0000-000000000002/c4c4c4c4-1111-0000-0000-00000000000a.png');

-- ---- 1. Only the service role may ask ---------------------------------------------------------------------------
do $$
begin
  perform fckit.as_anon();
  perform fckit.must_fail('a visitor', $q$select * from public.files_to_clean()$q$, 'permission denied');
  reset role;
  perform fckit.as_user(1);
  perform fckit.must_fail('a member', $q$select * from public.files_to_clean()$q$, 'permission denied');
  reset role;
  raise notice 'OK 1: members and visitors cannot list files to delete';
end $$;

-- ---- 2. What is listed ----------------------------------------------------------------------------------------------
do $$
declare got text;
begin
  perform fckit.as_service();
  got := fckit.left();
  reset role;
  if got <> 'cv-files:cv-old,souk-images:c4c4c4c4-1111-0000-0000-00000000000c.png' then
    raise exception 'FAIL: only the two unused old files should be listed, got %', got;
  end if;
  raise notice 'OK 2: unused old CV and Souk image are listed; used, fresh and message files are not';
end $$;

-- ---- 3. Each reason to keep a file ------------------------------------------------------------------------------------
do $$
begin
  -- the current CV stops being the current one: it becomes unused
  update public.application_files set cv_path = null, cv_name = null, cv_size = null, cv_uploaded_at = null where user_id = fckit.uid(1);
  perform fckit.as_service();
  if fckit.left() <> 'cv-files:cv-current,cv-files:cv-old,souk-images:c4c4c4c4-1111-0000-0000-00000000000c.png' then raise exception 'FAIL: a replaced CV should be listed, got %', fckit.left(); end if;
  reset role;
  -- the CV sent with an application is still kept while the application exists
  delete from public.job_applications where applicant_id = fckit.uid(1);
  perform fckit.as_service();
  if fckit.left() <> 'cv-files:cv-current,cv-files:cv-old,cv-files:cv-sent,souk-images:c4c4c4c4-1111-0000-0000-00000000000c.png' then raise exception 'FAIL: a CV nothing uses should be listed, got %', fckit.left(); end if;
  reset role;
  -- a waiting submission stops waiting
  update public.souk_submissions set status = 'withdrawn' where creator_id = fckit.uid(2);
  perform fckit.as_service();
  if fckit.left() not like '%souk-images:c4c4c4c4-1111-0000-0000-00000000000a.png%' then raise exception 'FAIL: the image of a withdrawn submission should be listed, got %', fckit.left(); end if;
  reset role;
  -- an item leaves the shop: its image is not needed by the shop any more
  delete from public.souk_items where slug = 'fc-item';
  perform fckit.as_service();
  if fckit.left() not like '%souk-images:c4c4c4c4-1111-0000-0000-00000000000b.png%' then raise exception 'FAIL: the image of a deleted item should be listed, got %', fckit.left(); end if;
  reset role;
  raise notice 'OK 3: a file is kept while it is the current CV, sent with an application, on a waiting submission or on a shop item';
end $$;

-- ---- 4. Grace period and limit --------------------------------------------------------------------------------------------
do $$
begin
  perform fckit.age('c4c4c4c4-0000-0000-0000-000000000001/cv-fresh', 23);
  perform fckit.as_service();
  if fckit.left() like '%cv-fresh%' then raise exception 'FAIL: a file younger than 24 hours was listed'; end if;
  reset role;
  perform fckit.age('c4c4c4c4-0000-0000-0000-000000000001/cv-fresh', 25);
  perform fckit.as_service();
  if fckit.left() not like '%cv-fresh%' then raise exception 'FAIL: a file older than 24 hours was not listed'; end if;
  reset role;
  -- the grace period is a setting
  update public.game_config set value = '48' where key = 'file_cleanup_grace_hours';
  perform fckit.as_service();
  if fckit.left() like '%cv-fresh%' then raise exception 'FAIL: the grace period setting is ignored'; end if;
  reset role;
  -- a setting of 0 still waits an hour
  insert into storage.objects (bucket_id, name, created_at) values ('cv-files', 'c4c4c4c4-0000-0000-0000-000000000001/cv-minutes', now() - interval '30 minutes');
  update public.game_config set value = '0' where key = 'file_cleanup_grace_hours';
  perform fckit.as_service();
  if fckit.left() like '%cv-minutes%' then raise exception 'FAIL: a file 30 minutes old was listed with a grace setting of 0'; end if;
  reset role;
  update public.game_config set value = '24' where key = 'file_cleanup_grace_hours';
  perform fckit.as_service();
  if (select count(*) from public.files_to_clean(1)) > 1 then raise exception 'FAIL: the limit is ignored'; end if;
  if (select count(*) from public.files_to_clean(0)) > 1 then raise exception 'FAIL: a limit of 0 should become 1'; end if;
  reset role;
  raise notice 'OK 4: a file must be older than the grace period (a setting, at least 1 hour); the limit is respected';
end $$;

-- ---- 5. Private message files are never listed ------------------------------------------------------------------------------
do $$
begin
  perform fckit.as_service();
  if exists (select 1 from public.files_to_clean(500) where bucket_id = 'dm-files') then raise exception 'FAIL: a private message file was listed'; end if;
  reset role;
  raise notice 'OK 5: private message files are left alone';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------------------------
delete from storage.objects where name like 'c4c4c4c4-%';
delete from public.souk_submissions where creator_id::text like 'c4c4c4c4-%';
delete from public.souk_items where slug = 'fc-item';
delete from public.job_applications where applicant_id::text like 'c4c4c4c4-%';
delete from public.application_files where user_id::text like 'c4c4c4c4-%';
delete from public.profiles where id::text like 'c4c4c4c4-%';
delete from auth.users where id::text like 'c4c4c4c4-%';
update public.game_config set value = '24' where key = 'file_cleanup_grace_hours';
drop schema fckit cascade;

do $$
begin
  if exists (select 1 from storage.objects where name like 'c4c4c4c4-%') then raise exception 'FAIL: files left behind'; end if;
  raise notice 'OK 6: the test left nothing behind';
end $$;

select 'ALL FILE CLEANUP TESTS PASSED' as result;
