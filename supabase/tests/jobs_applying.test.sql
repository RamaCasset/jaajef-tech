-- Tests for Jobs part 3 (applying).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f jobs_applying.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) applies, with a full file and a CV; bara (...2) has a small file;
-- coumba (...3) runs company "Atelier Coumba"; dame (...4) is an admin; guest (...5) runs a second
-- company; fatou (...6) has no file and gets suspended.

create schema apkit;
grant usage on schema apkit to public;

create function apkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('6d6d6d6d-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function apkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', apkit.uid(p_n)::text, true);
end $$;

create function apkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function apkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function apkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function apkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := apkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function apkit.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

create function apkit.cv(p_n int, p_k int) returns text
language sql immutable as $$
  select apkit.uid(p_n)::text || '/0000000' || p_k || '-0000-0000-0000-000000000000.pdf'
$$;

create function apkit.off(p_title text) returns uuid
language sql stable security definer as $$ select id from public.job_offers where title = p_title $$;

-- The id of a member's application to an offer (the latest one).
create function apkit.app(p_n int, p_title text) returns uuid
language sql stable security definer as $$
  select id from public.job_applications where applicant_id = apkit.uid(p_n) and offer_title = p_title order by created_at desc, id limit 1
$$;

create function apkit.notices(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = apkit.uid(p_n) and kind = p_kind
$$;

create function apkit.can_open_cv(p_n int, p_path text) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform apkit.as_user(p_n);
  v := exists (select 1 from storage.objects where bucket_id = 'cv-files' and name = p_path);
  reset role;
  return v;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (apkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(5), 'guest@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- Setup: two approved companies with offers, and applicants with files ----------------------------
do $$
declare e3 uuid; e5 uuid;
begin
  perform apkit.as_server();
  perform public.make_admin(apkit.uid(4));
  reset role;

  perform apkit.as_user(3);
  e3 := public.create_employer('company', 'Atelier Coumba', 'Developpement web', 'https://coumba.sn');
  reset role;
  perform apkit.as_user(5);
  e5 := public.create_employer('company', 'Guest SARL');
  reset role;
  perform apkit.as_user(4);
  perform public.review_employer(e3, true);
  perform public.review_employer(e5, true);
  reset role;

  perform apkit.as_user(3);
  perform public.create_job_offer('Dev backend', 'job', 'Un poste de developpeur backend', 'full_time', 'Dakar', 'hybrid', 300000, 500000, 'month', false, array['python'], null, true);
  perform public.create_job_offer('Dev front', 'freelance', 'Une mission front', null, 'Dakar', 'remote', null, null, null, true, array['react'], null, true);
  perform public.create_job_offer('Brouillon', 'freelance', 'Pas encore publie');
  reset role;
  perform apkit.as_user(5);
  perform public.create_job_offer('Autre offre', 'freelance', 'Chez guest', null, null, 'remote', null, null, null, false, '{}', null, true);
  reset role;

  perform apkit.as_user(1);
  perform public.save_application_file('Developpeuse full-stack', 'Je construis des applications web.', 'Dakar', 4, 'immediate', array['job', 'freelance'], array['python', 'django', 'sql'], 'https://ana.sn');
  perform public.add_portfolio_item('Mon site', 'Un site vitrine', 'https://ana.sn');
  insert into storage.objects (bucket_id, name) values ('cv-files', apkit.cv(1, 1));
  perform public.set_cv(apkit.cv(1, 1), 'ana-cv.pdf', 120000);
  reset role;

  perform apkit.as_user(2);
  perform public.save_application_file('Debutant motive', null, null, null, null, '{}', '{}');
  reset role;
end $$;

-- ---- 1. Applying and its rules ----------------------------------------------------------------------------------
do $$
declare o uuid := apkit.off('Dev backend'); a uuid;
begin
  perform apkit.as_anon();
  perform apkit.must_fail('a visitor applies', format('select public.apply_to_offer(%L)', o), 'permission denied');
  reset role;
  perform apkit.as_user(6);
  perform apkit.must_fail('applying without a file', format('select public.apply_to_offer(%L)', o), 'headline');
  reset role;
  perform apkit.as_user(3);
  perform apkit.must_fail('applying to your own offer', format('select public.apply_to_offer(%L)', o), 'own offer');
  reset role;

  perform apkit.as_user(1);
  perform apkit.must_fail('an offer that does not exist', format('select public.apply_to_offer(%L)', gen_random_uuid()), 'Offer not found');
  perform apkit.must_fail('a draft offer', format('select public.apply_to_offer(%L)', apkit.off('Brouillon')), 'Offer not found');
  perform apkit.must_fail('a message that is too long', format('select public.apply_to_offer(%L, %L)', o, repeat('a', 2001)), 'too long');
  a := public.apply_to_offer(o, '  Bonjour, je suis tres interessee.  ');
  perform apkit.must_fail('applying twice', format('select public.apply_to_offer(%L)', o), 'already applied');
  reset role;
  if (select message from public.job_applications where id = a) <> 'Bonjour, je suis tres interessee.' then raise exception 'FAIL: the message should be trimmed'; end if;
  if (select status from public.job_applications where id = a) <> 'submitted' then raise exception 'FAIL: a new application is submitted'; end if;
  if (select cv_name from public.job_applications where id = a) <> 'ana-cv.pdf' then raise exception 'FAIL: the CV should be included'; end if;
  if (select employer_name from public.job_applications where id = a) <> 'Atelier Coumba' or (select offer_title from public.job_applications where id = a) <> 'Dev backend' then raise exception 'FAIL: the offer and employer names should be kept'; end if;
  if apkit.notices(3, 'new_application') <> 1 then raise exception 'FAIL: the company should get one notice'; end if;
  raise notice 'OK 1: applying needs a file with a headline, a real open offer that is not your own, and happens once per offer';
end $$;

-- ---- 2. The company gets a copy that does not change ---------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev backend'); o uuid := apkit.off('Dev backend'); s jsonb;
begin
  perform apkit.as_user(1);
  perform public.save_application_file('Autre titre', 'Autre texte', 'Thies', 9, 'not_looking', '{}', array['go']);
  reset role;
  perform apkit.as_user(3);
  select profile_snapshot into s from public.job_applications where id = a;
  reset role;
  if s ->> 'headline' <> 'Developpeuse full-stack' or s ->> 'location' <> 'Dakar' then raise exception 'FAIL: the copy must keep the file as it was, got %', s; end if;
  if s -> 'skills' <> '["python", "django", "sql"]'::jsonb then raise exception 'FAIL: skills in the copy, got %', s -> 'skills'; end if;
  if jsonb_array_length(s -> 'portfolio') <> 1 or s -> 'portfolio' -> 0 ->> 'title' <> 'Mon site' then raise exception 'FAIL: the portfolio should be in the copy'; end if;
  if s ->> 'username' is null then raise exception 'FAIL: the applicant''s name should be in the copy'; end if;
  perform apkit.as_user(1);
  perform public.save_application_file('Developpeuse full-stack', 'Je construis des applications web.', 'Dakar', 4, 'immediate', array['job', 'freelance'], array['python', 'django', 'sql'], 'https://ana.sn');
  reset role;

  perform apkit.as_user(3);
  if (select count(*) from public.list_offer_applicants(o)) <> 1 then raise exception 'FAIL: one applicant expected'; end if;
  if (select headline from public.list_offer_applicants(o)) <> 'Developpeuse full-stack' then raise exception 'FAIL: headline in the list'; end if;
  if (select skills from public.list_offer_applicants(o)) <> array['python', 'django', 'sql'] then raise exception 'FAIL: skills in the list'; end if;
  if not (select has_cv from public.list_offer_applicants(o)) then raise exception 'FAIL: has_cv in the list'; end if;
  reset role;
  raise notice 'OK 2: the company gets the file as it was when the member applied';
end $$;

-- ---- 3. Who can see an application -----------------------------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev backend'); o uuid := apkit.off('Dev backend');
begin
  perform apkit.as_user(1);
  if (select count(*) from public.job_applications) <> 1 then raise exception 'FAIL: ana sees her own application'; end if;
  reset role;
  perform apkit.as_user(3);
  if (select count(*) from public.job_applications) <> 1 then raise exception 'FAIL: the company sees the application to its offer'; end if;
  reset role;
  perform apkit.as_user(2);
  if exists (select 1 from public.job_applications) then raise exception 'FAIL: another applicant sees it'; end if;
  reset role;
  perform apkit.as_user(5);
  if exists (select 1 from public.job_applications) then raise exception 'FAIL: another company sees it'; end if;
  perform apkit.must_fail('another company lists the applicants', format('select * from public.list_offer_applicants(%L)', o), 'Offer not found');
  perform apkit.must_fail('another company sets a status', format('select public.set_application_status(%L, %L)', a, 'seen'), 'Application not found');
  reset role;
  perform apkit.as_user(4);
  if exists (select 1 from public.job_applications) then raise exception 'FAIL: not even an admin reads applications'; end if;
  reset role;
  perform apkit.as_user(1);
  perform apkit.must_fail('the applicant lists the applicants', format('select * from public.list_offer_applicants(%L)', o), 'Offer not found');
  perform apkit.must_fail('the applicant sets her own status', format('select public.set_application_status(%L, %L)', a, 'shortlisted'), 'Application not found');
  reset role;
  perform apkit.as_anon();
  perform apkit.must_fail('a visitor reads applications', 'select count(*) from public.job_applications', 'permission denied');
  reset role;
  raise notice 'OK 3: only the applicant and the company applied to see an application';
end $$;

-- ---- 4. Statuses -------------------------------------------------------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev backend');
begin
  perform apkit.as_user(3);
  perform apkit.must_fail('an unknown status', format('select public.set_application_status(%L, %L)', a, 'hired'), 'Choose seen');
  perform apkit.must_fail('setting back to submitted', format('select public.set_application_status(%L, %L)', a, 'submitted'), 'Choose seen');
  perform public.set_application_status(a, 'seen');
  perform public.set_application_status(a, 'seen'); -- again: nothing changes
  perform public.set_application_status(a, 'shortlisted');
  perform apkit.must_fail('a status going back', format('select public.set_application_status(%L, %L)', a, 'seen'), 'cannot go back');
  reset role;
  if apkit.notices(1, 'application_seen') <> 1 or apkit.notices(1, 'application_shortlisted') <> 1 then raise exception 'FAIL: one notice per decision'; end if;
  if (select status from public.job_applications where id = a) <> 'shortlisted' then raise exception 'FAIL: shortlisted expected'; end if;

  perform apkit.as_user(3);
  perform public.set_application_status(a, 'declined');
  perform apkit.must_fail('changing a declined application', format('select public.set_application_status(%L, %L)', a, 'shortlisted'), 'cannot be changed');
  reset role;
  if (select declined_at from public.job_applications where id = a) is null then raise exception 'FAIL: declined_at should be set'; end if;
  if apkit.notices(1, 'application_declined') <> 1 then raise exception 'FAIL: the decline notice'; end if;

  -- a new application going straight to declined
  perform apkit.as_user(2);
  perform public.apply_to_offer(apkit.off('Dev front'), null, false);
  reset role;
  perform apkit.as_user(3);
  perform public.set_application_status(apkit.app(2, 'Dev front'), 'declined');
  reset role;
  raise notice 'OK 4: statuses only move forward, declined is final, and the applicant is told each time';
end $$;

-- ---- 5. Access to the CV ----------------------------------------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev backend'); p text := apkit.cv(1, 1);
begin
  -- declined just now: the company can still open the CV
  if not apkit.can_open_cv(1, p) then raise exception 'FAIL: ana opens her own CV'; end if;
  if not apkit.can_open_cv(3, p) then raise exception 'FAIL: the company applied to opens the CV'; end if;
  if apkit.can_open_cv(5, p) then raise exception 'FAIL: another company opens the CV'; end if;
  if apkit.can_open_cv(2, p) then raise exception 'FAIL: another member opens the CV'; end if;

  update public.job_applications set declined_at = now() - interval '89 days' where id = a;
  if not apkit.can_open_cv(3, p) then raise exception 'FAIL: still open on day 89'; end if;
  update public.job_applications set declined_at = now() - interval '91 days' where id = a;
  if apkit.can_open_cv(3, p) then raise exception 'FAIL: closed after 90 days'; end if;
  perform apkit.as_user(3);
  if exists (select 1 from public.job_applications where id = a) then raise exception 'FAIL: the company no longer sees the application after 90 days'; end if;
  if exists (select 1 from public.list_offer_applicants(apkit.off('Dev backend'))) then raise exception 'FAIL: nor in the list'; end if;
  reset role;
  perform apkit.as_user(1);
  if (select status from public.job_applications where id = a) <> 'declined' then raise exception 'FAIL: ana still sees her own application'; end if;
  reset role;
  -- leave this old application expired so it does not keep the CV open in the next tests
  raise notice 'OK 5: only the company applied to opens the CV, for 90 days after a decline';
end $$;

-- ---- 6. Closing the offer ---------------------------------------------------------------------------------------
do $$
declare p text := apkit.cv(1, 1); o uuid := apkit.off('Dev front'); a uuid;
begin
  perform apkit.as_user(1);
  a := public.apply_to_offer(o, 'Je postule');
  reset role;
  if not apkit.can_open_cv(3, p) then raise exception 'FAIL: the company opens the CV of an application to an open offer'; end if;
  perform apkit.as_user(3);
  perform public.close_job_offer(o);
  reset role;
  if (select offer_closed_at from public.job_applications where id = a) is null then raise exception 'FAIL: closing the offer should start the clock'; end if;
  if not apkit.can_open_cv(3, p) then raise exception 'FAIL: still open right after closing'; end if;
  update public.job_applications set offer_closed_at = now() - interval '91 days' where id = a;
  if apkit.can_open_cv(3, p) then raise exception 'FAIL: closed 90 days after the offer closed'; end if;
  perform apkit.as_user(3);
  perform public.publish_job_offer(o); -- reopened
  reset role;
  if (select offer_closed_at from public.job_applications where id = a) is not null then raise exception 'FAIL: reopening should stop the clock'; end if;
  if not apkit.can_open_cv(3, p) then raise exception 'FAIL: open again after reopening'; end if;
  perform apkit.as_user(1);
  perform apkit.must_fail('applying to a closed offer', format('select public.apply_to_offer(%L)', apkit.off('Brouillon')), 'Offer not found');
  reset role;
  raise notice 'OK 6: the 90 days run from the day the offer closed, and stop if it reopens';
end $$;

-- ---- 7. Withdrawing -----------------------------------------------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev front'); p text := apkit.cv(1, 1); a2 uuid;
begin
  perform apkit.as_user(2);
  perform apkit.must_fail('withdrawing someone else''s application', format('select public.withdraw_application(%L)', a), 'Application not found');
  reset role;
  perform apkit.as_user(1);
  perform public.withdraw_application(a);
  perform public.withdraw_application(a); -- again: harmless
  perform apkit.must_fail('withdrawing an unknown application', format('select public.withdraw_application(%L)', gen_random_uuid()), 'Application not found');
  reset role;
  if (select status from public.job_applications where id = a) <> 'withdrawn' then raise exception 'FAIL: withdrawn expected'; end if;
  if (select message from public.job_applications where id = a) is not null or (select profile_snapshot from public.job_applications where id = a) <> '{}'::jsonb
     or (select cv_path from public.job_applications where id = a) is not null then raise exception 'FAIL: withdrawing should erase the message, the copy and the CV link'; end if;
  perform apkit.as_user(3);
  if exists (select 1 from public.job_applications where id = a) then raise exception 'FAIL: the company still sees a withdrawn application'; end if;
  perform apkit.must_fail('the company changes a withdrawn application', format('select public.set_application_status(%L, %L)', a, 'seen'), 'Application not found');
  reset role;
  -- applying again is allowed after a withdrawal
  perform apkit.as_user(1);
  a2 := public.apply_to_offer(apkit.off('Dev front'));
  if a2 = a then raise exception 'FAIL: a new application should be a new row'; end if;
  if (select count(*) from public.list_my_applications() where offer_title = 'Dev front') <> 2 then raise exception 'FAIL: both applications are in the history'; end if;
  reset role;
  raise notice 'OK 7: withdrawing erases what the application carried and ends the company''s access; applying again is allowed';
end $$;

-- ---- 8. Erasing or replacing the CV --------------------------------------------------------------------------
do $$
declare p1 text := apkit.cv(1, 1); p2 text := apkit.cv(1, 2); old text; a uuid := apkit.app(1, 'Dev front');
begin
  -- the company still has p1 through the live application
  if (select cv_path from public.job_applications where id = a) <> p1 then raise exception 'FAIL: the new application carries the current CV'; end if;
  perform apkit.as_user(1);
  insert into storage.objects (bucket_id, name) values ('cv-files', p2);
  old := public.set_cv(p2, 'ana-cv-2.pdf', 130000);
  if old is not null then raise exception 'FAIL: the old CV is still used by an application, so it must not be deleted yet'; end if;
  if p1 <> all (array(select public.list_unused_cv_files())) is false and exists (select 1 from public.list_unused_cv_files() f where f = p1) then raise exception 'FAIL: the old CV is still in use'; end if;
  reset role;
  if not apkit.can_open_cv(3, p1) then raise exception 'FAIL: the company keeps the CV it was sent'; end if;
  if apkit.can_open_cv(3, p2) then raise exception 'FAIL: the company must not see the new CV it was not sent'; end if;

  perform apkit.as_user(1);
  if public.remove_cv() <> p2 then raise exception 'FAIL: removing the CV returns the current path'; end if;
  reset role;
  if (select cv_path from public.job_applications where id = a) is not null then raise exception 'FAIL: removing the CV takes it from her applications too'; end if;
  if apkit.can_open_cv(3, p1) then raise exception 'FAIL: the company can no longer open the CV after removal'; end if;
  perform apkit.as_user(1);
  if (select count(*) from public.list_unused_cv_files()) <> 2 then raise exception 'FAIL: both CV files are now unused, got %', (select count(*) from public.list_unused_cv_files()); end if;
  delete from storage.objects where name in (p1, p2);
  if (select count(*) from public.list_unused_cv_files()) <> 0 then raise exception 'FAIL: nothing left to delete'; end if;
  reset role;
  raise notice 'OK 8: replacing keeps the CV an application was sent with; removing takes it from every application; unused files are listed';
end $$;

-- ---- 9. My applications and deleted offers ----------------------------------------------------------------
do $$
declare a uuid := apkit.app(1, 'Dev backend'); r record;
begin
  perform apkit.as_user(1);
  select * into r from public.list_my_applications() where offer_title = 'Dev backend';
  if r.status <> 'declined' or r.employer_name <> 'Atelier Coumba' or not r.offer_open or r.has_cv then raise exception 'FAIL: my applications row: %', r; end if;
  if (select count(*) from public.list_my_applications()) <> 3 then raise exception 'FAIL: three applications in the history'; end if;
  reset role;
  perform apkit.as_user(3);
  perform public.unpublish_job_offer(apkit.off('Dev backend'));
  reset role;
  perform apkit.as_user(1);
  if (select offer_open from public.list_my_applications() where offer_title = 'Dev backend') then raise exception 'FAIL: an offer taken off the board is not open'; end if;
  reset role;
  perform apkit.as_user(3);
  perform public.delete_job_offer(apkit.off('Dev backend'));
  reset role;
  perform apkit.as_user(1);
  select * into r from public.list_my_applications() where offer_title = 'Dev backend';
  if r.offer_id is not null or r.id <> a then raise exception 'FAIL: the application stays when its offer is deleted'; end if;
  reset role;
  perform apkit.as_anon();
  perform apkit.must_fail('a visitor lists applications', 'select * from public.list_my_applications()', 'permission denied');
  reset role;
  raise notice 'OK 9: my applications keeps its history, even when the offer is gone';
end $$;

-- ---- 10. Limits, completion and suspension ------------------------------------------------------------------
do $$
declare o1 uuid := apkit.off('Dev front'); o2 uuid := apkit.off('Autre offre');
begin
  perform apkit.set_config('job_applications_max_per_day', '1');
  perform apkit.as_user(2);
  -- bara already applied once today (the declined one), so a second one is over the limit
  perform apkit.must_fail('applying over the daily limit', format('select public.apply_to_offer(%L)', o2), 'too fast');
  reset role;
  perform apkit.set_config('job_applications_max_per_day', '20');

  perform apkit.set_config('application_min_completion', '90');
  perform apkit.as_user(2);
  perform apkit.must_fail('applying with a file that is too empty', format('select public.apply_to_offer(%L)', o2), 'at least 90 percent');
  reset role;
  perform apkit.set_config('application_min_completion', '0');
  perform apkit.as_user(2);
  perform public.apply_to_offer(o2);
  reset role;

  insert into public.member_suspensions (user_id, reason, until) values (apkit.uid(1), 'test', now() + interval '1 day');
  perform apkit.as_user(1);
  perform apkit.must_fail('a suspended member applies', format('select public.apply_to_offer(%L)', o2), 'suspended');
  reset role;
  raise notice 'OK 10: the daily limit, the minimum completion and suspensions hold';
end $$;

-- ---- 11. Nobody writes the table directly ----------------------------------------------------------------
do $$
declare a uuid := apkit.app(2, 'Autre offre');
begin
  perform apkit.as_user(2);
  perform apkit.must_fail('inserting an application', format('insert into public.job_applications (offer_id, applicant_id, offer_title, employer_name) values (%L, %L, %L, %L)', apkit.off('Autre offre'), apkit.uid(2), 'x', 'y'), 'permission denied');
  perform apkit.must_fail('changing a status directly', format('update public.job_applications set status = %L where id = %L', 'shortlisted', a), 'permission denied');
  perform apkit.must_fail('deleting directly', format('delete from public.job_applications where id = %L', a), 'permission denied');
  reset role;
  raise notice 'OK 11: applications can only change through the functions';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from storage.objects where bucket_id = 'cv-files';
delete from public.member_suspensions where user_id::text like '6d6d6d6d-%';
delete from public.profiles where id::text like '6d6d6d6d-%';
delete from auth.users where id::text like '6d6d6d6d-%';
drop schema apkit cascade;

do $$
begin
  if exists (select 1 from public.job_applications) or exists (select 1 from public.job_offers) or exists (select 1 from public.employers)
     or exists (select 1 from public.application_files) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'job_applications_max_per_day') <> '20'
     or (select value #>> '{}' from public.game_config where key = 'application_min_completion') <> '0'
     or (select value #>> '{}' from public.game_config where key = 'application_cv_access_days') <> '90' then
    raise exception 'FAIL: a setting was left changed';
  end if;
  raise notice 'OK 12: the test left nothing behind';
end $$;

select 'ALL JOBS (APPLYING) TESTS PASSED' as result;
