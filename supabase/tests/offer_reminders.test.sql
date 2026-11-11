-- Tests for offer applicant counts and stale-offer reminders.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f offer_reminders.test.sql
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) posts offers; bara (...2) applies; coumba (...3) is a stranger.

create schema orkit;
grant usage on schema orkit to public;

create function orkit.uid(p_n int) returns uuid language sql immutable as $$ select ('9d9d9d9d-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function orkit.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', orkit.uid(p_n)::text, true);
end $$;
create function orkit.as_anon() returns void language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function orkit.as_server() returns void language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function orkit.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function orkit.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := orkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (orkit.uid(1), 'ana-or@exemple.sn', '{"provider":"email"}', '{}'),
  (orkit.uid(2), 'bara-or@exemple.sn', '{"provider":"email"}', '{}'),
  (orkit.uid(3), 'coumba-or@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Applicant counts ---------------------------------------------------------------------------------------------------
do $$
declare a uuid; b uuid;
begin
  perform orkit.as_user(1);
  a := public.create_job_offer('Offre A', 'freelance', 'Une mission', null, 'Dakar', 'remote', null, null, null, false, '{}', null, true);
  b := public.create_job_offer('Offre B', 'freelance', 'Une autre mission', null, 'Dakar', 'remote', null, null, null, false, '{}', null, true);
  reset role;
  perform orkit.as_user(2);
  perform public.save_application_file('Developpeuse', null, 'Dakar', 3, 'immediate', array['job'], array['python']);
  perform public.apply_to_offer(a, 'Bonjour', false);
  reset role;
  perform orkit.as_user(1);
  if (select total from public.my_offer_applicant_counts() where offer_id = a) <> 1 then raise exception 'FAIL: one application on A'; end if;
  if (select unseen from public.my_offer_applicant_counts() where offer_id = a) <> 1 then raise exception 'FAIL: it is not seen yet'; end if;
  if (select total from public.my_offer_applicant_counts() where offer_id = b) <> 0 then raise exception 'FAIL: none on B'; end if;
  perform public.set_application_status((select id from public.list_offer_applicants(a) limit 1), 'shortlisted');
  if (select unseen from public.my_offer_applicant_counts() where offer_id = a) <> 0 then raise exception 'FAIL: it is not new any more'; end if;
  reset role;
  perform orkit.as_user(3);
  if exists (select 1 from public.my_offer_applicant_counts()) then raise exception 'FAIL: a stranger sees no counts'; end if;
  reset role;
  perform orkit.as_anon();
  perform orkit.must_fail('a visitor asks for counts', 'select * from public.my_offer_applicant_counts()', 'permission denied');
  reset role;
  raise notice 'OK 1: an owner sees how many applied and how many are new; nobody else sees them';
end $$;

-- ---- 2. Reminders ------------------------------------------------------------------------------------------------------------------
do $$
declare a uuid; b uuid; n integer;
begin
  select id into a from public.job_offers where title = 'Offre A';
  select id into b from public.job_offers where title = 'Offre B';
  perform orkit.as_user(1);
  perform orkit.must_fail('a member runs the reminders', 'select public.send_stale_offer_reminders()', 'permission denied');
  reset role;
  perform orkit.as_server();
  if public.send_stale_offer_reminders() <> 0 then raise exception 'FAIL: fresh offers are not reminded'; end if;
  reset role;

  -- Offer A has been open for 95 days; offer B for 20.
  update public.job_offers set published_at = now() - interval '95 days' where id = a;
  update public.job_offers set published_at = now() - interval '20 days' where id = b;
  perform orkit.as_server();
  if public.send_stale_offer_reminders() <> 1 then raise exception 'FAIL: only the old offer is reminded'; end if;
  perform public.send_stale_offer_reminders();
  reset role;
  select count(*) into n from public.notifications where user_id = orkit.uid(1) and kind = 'job_offer_stale';
  if n <> 1 then raise exception 'FAIL: one reminder per 30-day period, got %', n; end if;
  if (select data ->> 'offer_title' from public.notifications where user_id = orkit.uid(1) and kind = 'job_offer_stale') <> 'Offre A' then raise exception 'FAIL: the reminder names the offer'; end if;

  -- Thirty days later, still open: a second reminder.
  update public.job_offers set published_at = now() - interval '125 days' where id = a;
  perform orkit.as_server();
  perform public.send_stale_offer_reminders();
  reset role;
  select count(*) into n from public.notifications where user_id = orkit.uid(1) and kind = 'job_offer_stale';
  if n <> 2 then raise exception 'FAIL: a new period brings a new reminder, got %', n; end if;

  -- A closed offer is not reminded.
  perform orkit.as_user(1);
  perform public.close_job_offer(a);
  reset role;
  update public.job_offers set published_at = now() - interval '155 days' where id = a;
  perform orkit.as_server();
  perform public.send_stale_offer_reminders();
  reset role;
  select count(*) into n from public.notifications where user_id = orkit.uid(1) and kind = 'job_offer_stale';
  if n <> 2 then raise exception 'FAIL: a closed offer is not reminded, got %', n; end if;
  raise notice 'OK 2: offers open for 90 days remind their owner once per 30 days; closed or recent ones do not';
end $$;

-- ---- Clean up -------------------------------------------------------------------------------------------------------------------------
delete from public.application_files where user_id::text like '9d9d9d9d-%';
delete from public.notifications where user_id::text like '9d9d9d9d-%';
delete from public.profiles where id::text like '9d9d9d9d-%';
delete from auth.users where id::text like '9d9d9d9d-%';
drop schema orkit cascade;

do $$
begin
  if exists (select 1 from public.job_offers) or exists (select 1 from public.employers) then raise exception 'FAIL: offers or employers left behind'; end if;
  if exists (select 1 from public.job_applications) then raise exception 'FAIL: applications left behind'; end if;
  raise notice 'OK 3: the test left nothing behind';
end $$;

select 'ALL OFFER REMINDER TESTS PASSED' as result;
