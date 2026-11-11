-- Tests for Jobs part 1 (employers and job offers).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f jobs_employers.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) runs a company; coumba (...3) is an individual who hires freelancers;
-- dame (...4) is an admin; eli (...5) is a moderator; fatou (...6) has a company and gets
-- suspended; guest (...7) has no employer profile. (...2) is not used.

create schema jbkit;
grant usage on schema jbkit to public;

create function jbkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('9a9a9a9a-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function jbkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', jbkit.uid(p_n)::text, true);
end $$;

create function jbkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function jbkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function jbkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function jbkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := jbkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function jbkit.emp(p_n int) returns uuid
language sql stable security definer as $$ select id from public.employers where owner_id = jbkit.uid(p_n) $$;

create function jbkit.off(p_title text) returns uuid
language sql stable security definer as $$ select id from public.job_offers where title = p_title $$;

create function jbkit.status_of(p_title text) returns text
language sql stable security definer as $$ select status from public.job_offers where title = p_title $$;

create function jbkit.on_board(p_title text) returns boolean
language sql stable as $$ select exists (select 1 from public.search_job_offers(null, null, null, null, null, null, null, null, 'recent', 50) where title = p_title) $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (jbkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}'),
  (jbkit.uid(7), 'guest@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  perform jbkit.as_server();
  perform public.make_admin(jbkit.uid(4));
  reset role;
  perform jbkit.as_user(4);
  perform public.set_moderator(jbkit.uid(5), true);
  reset role;
end $$;

-- ---- 1. Creating an employer profile ---------------------------------------------------------------------------
do $$
declare e uuid;
begin
  perform jbkit.as_user(1);
  perform jbkit.must_fail('a bad kind', $q$select public.create_employer('agence', 'Nom valide')$q$, 'company or individual');
  perform jbkit.must_fail('a name that is too short', $q$select public.create_employer('company', 'A')$q$, 'at least 2');
  perform jbkit.must_fail('a website that is not https', $q$select public.create_employer('company', 'Nom valide', null, 'http://exemple.sn')$q$, 'secure');
  perform jbkit.must_fail('a logo that is not https', $q$select public.create_employer('company', 'Nom valide', null, null, 'ftp://exemple.sn/a.png')$q$, 'secure');
  perform jbkit.must_fail('a description that is too long', format('select public.create_employer(%L, %L, %L)', 'company', 'Nom valide', repeat('a', 1001)), 'too long');
  e := public.create_employer('company', '  Teranga Tech  ', 'Une agence', 'https://teranga.sn', 'https://teranga.sn/logo.png', 'Dakar');
  perform jbkit.must_fail('a second profile', $q$select public.create_employer('individual', 'Autre')$q$, 'already have');
  if (select status from public.employers where id = e) <> 'pending' then raise exception 'FAIL: a new company waits for approval'; end if;
  if (select name from public.employers where id = e) <> 'Teranga Tech' then raise exception 'FAIL: the name should be trimmed'; end if;
  reset role;
  perform jbkit.as_anon();
  perform jbkit.must_fail('a visitor creates a profile', $q$select public.create_employer('company', 'Nom valide')$q$, 'permission denied');
  reset role;
  perform jbkit.as_user(3);
  perform public.create_employer('individual', 'Coumba Freelance', null, null, null, 'Thies');
  reset role;
  raise notice 'OK 1: an employer profile needs a clean name and https addresses; one per member; visitors cannot create one';
end $$;

-- ---- 2. Old employer profiles: staff can still approve them ------------------------------------------------
-- The app no longer asks for an employer profile (see jobs_open_posting), but the old functions still work.
do $$
declare e uuid := jbkit.emp(1);
begin
  perform jbkit.as_user(1);
  perform jbkit.must_fail('approving yourself', format('select public.review_employer(%L, true)', e), 'Only staff');
  reset role;
  perform jbkit.as_anon();
  perform jbkit.must_fail('a visitor reviews', format('select public.review_employer(%L, true)', e), 'permission denied');
  reset role;
  perform jbkit.as_user(5);
  perform jbkit.must_fail('rejecting without a reason', format('select public.review_employer(%L, false)', e), 'reason');
  perform jbkit.must_fail('an unknown employer', format('select public.review_employer(%L, true)', gen_random_uuid()), 'not found');
  perform public.review_employer(e, true);
  perform public.review_employer(e, true);
  perform public.review_employer(jbkit.emp(3), true);
  reset role;
  if (select count(*) from public.admin_audit_log where action = 'employer_approved' and target_id = e::text) <> 1 then raise exception 'FAIL: the approval should be logged once'; end if;
  perform jbkit.as_anon();
  if (select count(*) from public.employers where id = e) <> 1 then raise exception 'FAIL: an approved employer is public'; end if;
  if (select review_note from public.employers where id = e) is not null then raise exception 'FAIL: no staff note on a public row'; end if;
  reset role;
  raise notice 'OK 2: staff can still approve an old employer profile, once, and it is logged';
end $$;

-- ---- 3. Drafts are private --------------------------------------------------------------------------------------------------
do $$
declare o uuid;
begin
  perform jbkit.as_user(1);
  o := public.create_job_offer('Developpeur Python', 'job', 'On cherche un developpeur', 'full_time', 'Dakar', 'hybrid', 300000, 500000, 'month', false, array['Python', 'django']);
  if (select count(*) from public.job_offers) <> 1 then raise exception 'FAIL: the owner sees her own draft'; end if;
  reset role;

  perform jbkit.as_anon();
  if exists (select 1 from public.job_offers) then raise exception 'FAIL: visitors see a draft offer'; end if;
  reset role;
  perform jbkit.as_user(3);
  if exists (select 1 from public.job_offers where id = o) then raise exception 'FAIL: members see another member''s draft'; end if;
  perform jbkit.must_fail('publishing someone else''s offer', format('select public.publish_job_offer(%L)', o), 'Offer not found');
  reset role;
  perform jbkit.as_user(2);
  perform jbkit.must_fail('the review queue as a member', 'select * from public.list_review_queue()', 'Only staff');
  reset role;
  perform jbkit.as_user(5);
  if (select count(*) from public.employers) <> 2 then raise exception 'FAIL: staff should see every profile'; end if;
  if exists (select 1 from public.list_review_queue()) then raise exception 'FAIL: nothing waits for review any more'; end if;
  reset role;
  raise notice 'OK 3: a draft is seen only by its owner and staff; staff have an empty queue';
end $$;

-- ---- 4. Checking an offer ---------------------------------------------------------------------------------------------
do $$
begin
  perform jbkit.as_user(1);
  perform jbkit.must_fail('a short title', $q$select public.create_job_offer('ab', 'job', 'desc', 'full_time')$q$, 'at least 3');
  perform jbkit.must_fail('a bad kind', $q$select public.create_job_offer('Un titre', 'stage', 'desc')$q$, 'job or freelance');
  perform jbkit.must_fail('no description', $q$select public.create_job_offer('Un titre', 'job', '  ', 'full_time')$q$, 'description');
  perform jbkit.must_fail('a long description', format('select public.create_job_offer(%L, %L, %L, %L)', 'Un titre', 'job', repeat('a', 10001), 'full_time'), 'too long');
  perform jbkit.must_fail('a job without a type', $q$select public.create_job_offer('Un titre', 'job', 'desc')$q$, 'type of job');
  perform jbkit.must_fail('a freelance gig with a job type', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', 'full_time')$q$, 'no job type');
  perform jbkit.must_fail('a bad remote option', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'partout')$q$, 'onsite, hybrid or remote');
  perform jbkit.must_fail('pay with no unit', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', 1000, 2000)$q$, 'what the pay is for');
  perform jbkit.must_fail('highest pay below lowest', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', 2000, 1000, 'month')$q$, 'cannot be below');
  perform jbkit.must_fail('negative pay', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', -5, 1000, 'month')$q$, 'out of range');
  perform jbkit.must_fail('a closing day in the past', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', null, null, null, false, '{}', current_date - 1)$q$, 'within the next year');
  perform jbkit.must_fail('a closing day too far ahead', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', null, null, null, false, '{}', current_date + 400)$q$, 'within the next year');
  perform jbkit.must_fail('nine tags', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', null, null, null, false, array['aa','bb','cc','dd','ee','ff','gg','hh','ii'])$q$, 'At most 8 tags');
  perform jbkit.must_fail('a bad tag', $q$select public.create_job_offer('Un titre', 'freelance', 'desc', null, null, 'remote', null, null, null, false, array['a b'])$q$, 'Tags use');
  if (select tags from public.job_offers where title = 'Developpeur Python') <> array['python', 'django'] then raise exception 'FAIL: tags should be cleaned'; end if;
  if exists (select 1 from public.job_offers where title = 'Un titre') then raise exception 'FAIL: a refused offer was saved'; end if;
  reset role;
  raise notice 'OK 4: offers need a clear title, kind, description, type, pay range with its unit, dates and tags';
end $$;

-- ---- 5. Publishing, limits and the board --------------------------------------------------------------------------
do $$
declare a uuid := jbkit.off('Developpeur Python'); b uuid; c uuid; d uuid;
begin
  perform jbkit.as_server();
  update public.game_config set value = '2' where key = 'job_offers_max_per_day';
  reset role;
  perform jbkit.as_user(1);
  if public.publish_job_offer(a) <> 'published' then raise exception 'FAIL: an approved company publishes straight away'; end if;
  if public.publish_job_offer(a) <> 'published' then raise exception 'FAIL: publishing twice is harmless'; end if;
  b := public.create_job_offer('Designer UI', 'freelance', 'Maquettes', null, 'Dakar', 'remote', 100000, 200000, 'project', true, array['figma'], current_date + 30, true);
  c := public.create_job_offer('Support client', 'job', 'Support', 'part_time', 'Thies', 'onsite');
  perform jbkit.must_fail('a third first publication in a day', format('select public.publish_job_offer(%L)', c), 'too fast');
  perform public.unpublish_job_offer(a);
  if public.publish_job_offer(a) <> 'published' then raise exception 'FAIL: republishing an offer already published once does not count again'; end if;
  reset role;
  perform jbkit.as_server();
  update public.game_config set value = '3' where key = 'job_offers_max_per_day';
  update public.game_config set value = '3' where key = 'job_offers_max_open';
  reset role;
  perform jbkit.as_user(1);
  perform jbkit.must_fail('too many open offers', $q$select public.create_job_offer('Quatrieme', 'freelance', 'desc')$q$, 'too many open offers');
  perform public.delete_job_offer(c);
  d := public.create_job_offer('Quatrieme', 'freelance', 'desc');
  reset role;
  perform jbkit.as_server();
  update public.game_config set value = '3' where key = 'job_offers_max_per_day';
  update public.game_config set value = '20' where key = 'job_offers_max_open';
  reset role;
  perform jbkit.as_anon();
  if not jbkit.on_board('Developpeur Python') or not jbkit.on_board('Designer UI') then raise exception 'FAIL: published offers are on the board for visitors'; end if;
  if jbkit.on_board('Quatrieme') then raise exception 'FAIL: a draft is on the board'; end if;
  if (select count(*) from public.job_offers) <> 2 then raise exception 'FAIL: visitors read only the 2 published offers directly'; end if;
  reset role;
  perform jbkit.as_user(7);
  perform jbkit.must_fail('closing someone else''s offer', format('select public.close_job_offer(%L)', a), 'Only your own');
  perform jbkit.must_fail('editing someone else''s offer', format('select public.update_job_offer(%L, %L, %L, %L, %L)', a, 'Pirate', 'job', 'desc', 'full_time'), 'Offer not found');
  perform jbkit.must_fail('deleting someone else''s offer', format('select public.delete_job_offer(%L)', a), 'Offer not found');
  perform jbkit.must_fail('unpublishing someone else''s offer', format('select public.unpublish_job_offer(%L)', a), 'Offer not found');
  reset role;
  raise notice 'OK 5: an approved company publishes straight away; limits per day and per open offers; strangers cannot touch an offer';
end $$;

do $$
begin
  perform jbkit.as_user(1);
  perform public.delete_job_offer(jbkit.off('Quatrieme'));
  reset role;
end $$;

-- ---- 6. Anyone can post, and it goes live straight away ------------------------------------------------------
do $$
declare o uuid;
begin
  -- bara (2) has never had an employer profile
  perform jbkit.as_user(2);
  o := public.create_job_offer('Offre de bara', 'freelance', 'Une mission courte', null, 'Dakar', 'remote');
  if public.publish_job_offer(o) <> 'published' then raise exception 'FAIL: a new member publishes straight away'; end if;
  reset role;
  if (select status from public.employers where owner_id = jbkit.uid(2)) <> 'approved' then raise exception 'FAIL: the hidden poster record is approved'; end if;
  if (select kind from public.employers where owner_id = jbkit.uid(2)) <> 'individual' then raise exception 'FAIL: the hidden poster record is an individual'; end if;
  perform jbkit.as_anon();
  if not jbkit.on_board('Offre de bara') then raise exception 'FAIL: the offer is on the board'; end if;
  reset role;
  perform jbkit.as_user(2);
  perform public.delete_job_offer(o);
  reset role;

  perform jbkit.as_user(3);
  o := public.create_job_offer('Site vitrine', 'freelance', 'Un site pour mon commerce', null, 'Thies', 'remote', 150000, 250000, 'project', true, array['wordpress']);
  if public.publish_job_offer(o) <> 'published' then raise exception 'FAIL: coumba publishes straight away'; end if;
  if public.publish_job_offer(public.create_job_offer('Logo', 'freelance', 'Un logo')) <> 'published' then raise exception 'FAIL: later offers go out freely'; end if;
  reset role;
  raise notice 'OK 6: any member can post, and the offer is published straight away';
end $$;

-- ---- 7. The company name shown on a member's offers ---------------------------------------------------------------
do $$
begin
  perform jbkit.as_user(1);
  perform jbkit.must_fail('a one letter name', $q$select public.set_my_company_name('A')$q$, '2 to 100');
  perform public.set_my_company_name('  Teranga Studio  ');
  reset role;
  if (select name from public.employers where owner_id = jbkit.uid(1)) <> 'Teranga Studio' then raise exception 'FAIL: the company name is set and trimmed'; end if;
  perform jbkit.as_anon();
  if not exists (select 1 from public.search_job_offers('python') where employer_name = 'Teranga Studio') then raise exception 'FAIL: the board shows the company name'; end if;
  perform jbkit.must_fail('a visitor sets a company name', $q$select public.set_my_company_name('Pirate')$q$, 'permission denied');
  reset role;
  perform jbkit.as_user(1);
  perform public.set_my_company_name(null);
  reset role;
  if (select name from public.employers where owner_id = jbkit.uid(1)) = 'Teranga Studio' then raise exception 'FAIL: an empty name goes back to the member name'; end if;
  perform jbkit.as_user(1);
  perform public.set_my_company_name('Teranga Tech');
  reset role;
  perform jbkit.as_anon();
  if not jbkit.on_board('Developpeur Python') then raise exception 'FAIL: still on the board'; end if;
  reset role;
  raise notice 'OK 7: a member can show a company name on offers, or go back to their own name';
end $$;

-- ---- 8. Staff hide an offer ----------------------------------------------------------------------------------------------
do $$
declare o uuid := jbkit.off('Designer UI');
begin
  perform jbkit.as_user(7);
  perform jbkit.must_fail('a member hides an offer', format('select public.set_job_offer_hidden(%L, true, %L)', o, 'raison'), 'Only staff');
  reset role;
  perform jbkit.as_user(5);
  perform jbkit.must_fail('hiding without a reason', format('select public.set_job_offer_hidden(%L, true)', o), 'reason');
  perform jbkit.must_fail('hiding an unknown offer', format('select public.set_job_offer_hidden(%L, true, %L)', gen_random_uuid(), 'raison'), 'not found');
  perform public.set_job_offer_hidden(o, true, 'Offre trompeuse');
  perform public.set_job_offer_hidden(o, true, 'Offre trompeuse'); -- again: nothing changes
  reset role;
  perform jbkit.as_anon();
  if jbkit.on_board('Designer UI') then raise exception 'FAIL: a hidden offer is on the board'; end if;
  if exists (select 1 from public.job_offers where id = o) then raise exception 'FAIL: visitors read a hidden offer'; end if;
  reset role;
  perform jbkit.as_user(1);
  if not exists (select 1 from public.job_offers where id = o) then raise exception 'FAIL: the owner should still see her hidden offer'; end if;
  perform jbkit.must_fail('editing a hidden offer', format('select public.update_job_offer(%L, %L, %L, %L)', o, 'Nouveau titre', 'freelance', 'desc'), 'hidden by staff');
  perform public.unpublish_job_offer(o);
  perform jbkit.must_fail('publishing a hidden offer', format('select public.publish_job_offer(%L)', o), 'hidden by staff');
  reset role;
  if (select count(*) from public.admin_audit_log where action = 'job_offer_hidden' and target_id = o::text) <> 1 then raise exception 'FAIL: hiding should be logged exactly once'; end if;
  perform jbkit.as_user(5);
  perform public.set_job_offer_hidden(o, false);
  perform public.set_job_offer_hidden(o, false);
  reset role;
  if (select count(*) from public.admin_audit_log where action = 'job_offer_unhidden' and target_id = o::text) <> 1 then raise exception 'FAIL: unhiding should be logged exactly once'; end if;
  perform jbkit.as_user(1);
  perform public.publish_job_offer(o);
  reset role;
  perform jbkit.as_anon();
  if not jbkit.on_board('Designer UI') then raise exception 'FAIL: the offer should be back'; end if;
  reset role;
  raise notice 'OK 8: staff can hide and restore an offer; the owner still sees it; every change is logged once';
end $$;

-- ---- 9. Closing, closing day, deleting -------------------------------------------------------------------------------
do $$
declare o uuid := jbkit.off('Designer UI'); l uuid := jbkit.off('Logo');
begin
  perform jbkit.as_user(1);
  perform public.close_job_offer(o);
  perform jbkit.must_fail('closing twice', format('select public.close_job_offer(%L)', o), 'Only your own published');
  reset role;
  perform jbkit.as_anon();
  if jbkit.on_board('Designer UI') then raise exception 'FAIL: a closed offer is on the board'; end if;
  reset role;
  perform jbkit.as_user(1);
  if public.publish_job_offer(o) <> 'published' then raise exception 'FAIL: a closed offer can be published again'; end if;
  reset role;
  perform jbkit.as_anon();
  if not jbkit.on_board('Designer UI') then raise exception 'FAIL: back on the board'; end if;
  reset role;

  update public.job_offers set closes_on = current_date - 1 where id = l; -- its closing day passed
  perform jbkit.as_anon();
  if jbkit.on_board('Logo') then raise exception 'FAIL: an offer past its closing day is on the board'; end if;
  if exists (select 1 from public.job_offers where id = l) then raise exception 'FAIL: visitors read an offer past its closing day'; end if;
  reset role;
  perform jbkit.as_user(3);
  perform jbkit.must_fail('keeping a past closing day', format('select public.update_job_offer(%L, %L, %L, %L, null, null, %L, null, null, null, false, %L, current_date - 1)', l, 'Logo', 'freelance', 'Un logo', 'onsite', '{}'), 'within the next year');
  perform public.update_job_offer(l, 'Logo', 'freelance', 'Un logo', null, null, 'onsite', null, null, null, false, '{}', current_date + 10);
  reset role;
  perform jbkit.as_anon();
  if not jbkit.on_board('Logo') then raise exception 'FAIL: a new closing day brings it back'; end if;
  reset role;

  -- deleting the profile deletes its offers
  perform jbkit.as_user(7);
  perform jbkit.must_fail('deleting a profile that does not exist', 'select public.delete_employer()', 'no employer profile');
  perform jbkit.must_fail('updating a profile that does not exist', $q$select public.update_employer('Nom valide')$q$, 'no employer profile');
  perform public.create_employer('individual', 'Guest Studio');
  perform public.create_job_offer('Offre de guest', 'freelance', 'Description');
  perform public.delete_employer();
  reset role;
  if exists (select 1 from public.job_offers where title = 'Offre de guest') then raise exception 'FAIL: deleting a profile should delete its offers'; end if;
  raise notice 'OK 9: closing, reopening, closing day and deleting work as expected';
end $$;

-- ---- 10. Searching the board -----------------------------------------------------------------------------------------
do $$
declare t text[];
begin
  update public.job_offers set published_at = now() - interval '3 days' where title = 'Developpeur Python';
  update public.job_offers set published_at = now() - interval '2 days' where title = 'Designer UI';
  update public.job_offers set published_at = now() - interval '1 day' where title = 'Site vitrine';
  update public.job_offers set published_at = now() where title = 'Logo';

  perform jbkit.as_anon();
  if (select array_agg(title) from public.search_job_offers()) <> array['Logo', 'Site vitrine', 'Designer UI', 'Developpeur Python'] then raise exception 'FAIL: newest first, got %', (select array_agg(title) from public.search_job_offers()); end if;
  if (select count(*) from public.search_job_offers('PYTHON')) <> 1 then raise exception 'FAIL: search by title or tag'; end if;
  if (select count(*) from public.search_job_offers(' django ')) <> 1 then raise exception 'FAIL: search by tag'; end if;
  if (select count(*) from public.search_job_offers('vitrine')) <> 1 then raise exception 'FAIL: search by title only'; end if;
  if (select count(*) from public.search_job_offers('terang')) <> 2 then raise exception 'FAIL: search by employer name'; end if;
  if (select count(*) from public.search_job_offers('%')) <> 0 then raise exception 'FAIL: a percent sign must not match everything'; end if;
  if (select count(*) from public.search_job_offers('_')) <> 0 then raise exception 'FAIL: an underscore must not match everything'; end if;
  if (select count(*) from public.search_job_offers(null, 'freelance')) <> 3 then raise exception 'FAIL: kind filter freelance'; end if;
  if (select count(*) from public.search_job_offers(null, 'job')) <> 1 then raise exception 'FAIL: kind filter job'; end if;
  if (select count(*) from public.search_job_offers(null, null, 'full_time')) <> 1 then raise exception 'FAIL: job type filter'; end if;
  if (select array_agg(title order by title) from public.search_job_offers(null, null, null, 'remote')) <> array['Designer UI', 'Site vitrine'] then raise exception 'FAIL: remote filter'; end if;
  if (select array_agg(title) from public.search_job_offers(null, null, null, 'hybrid')) <> array['Developpeur Python'] then raise exception 'FAIL: hybrid filter'; end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, 'thi')) <> 1 then raise exception 'FAIL: place filter'; end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, null, ' Figma ')) <> 1 then raise exception 'FAIL: tag filter'; end if;
  if (select array_agg(title) from public.search_job_offers(null, null, null, null, null, null, 400000, 'month')) <> array['Developpeur Python'] then raise exception 'FAIL: pay filter per month'; end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, null, null, 200000, 'project')) <> 2 then raise exception 'FAIL: pay filter per project'; end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, null, null, 900000, 'project')) <> 0 then raise exception 'FAIL: nothing pays that much'; end if;
  perform jbkit.must_fail('a pay filter without a unit', $q$select * from public.search_job_offers(null, null, null, null, null, null, 1000)$q$, 'what the pay is for');
  perform jbkit.must_fail('an unknown sort', $q$select * from public.search_job_offers(null, null, null, null, null, null, null, null, 'random')$q$, 'Unknown sort');
  if (select array_agg(title) from public.search_job_offers(null, null, null, null, null, null, null, null, 'pay')) <> array['Developpeur Python', 'Site vitrine', 'Designer UI', 'Logo'] then raise exception 'FAIL: highest pay first, no pay last, got %', (select array_agg(title) from public.search_job_offers(null, null, null, null, null, null, null, null, 'pay')); end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, null, null, null, null, 'recent', 0)) <> 1 then raise exception 'FAIL: limit 0 becomes 1'; end if;
  if (select count(*) from public.search_job_offers(null, null, null, null, null, null, null, null, 'recent', 1000)) > 50 then raise exception 'FAIL: limit capped at 50'; end if;
  if (select title from public.search_job_offers(null, null, null, null, null, null, null, null, 'recent', 1, 1)) <> 'Site vitrine' then raise exception 'FAIL: offset'; end if;
  if (select employer_name from public.search_job_offers('python')) <> 'Teranga Tech' then raise exception 'FAIL: employer name missing'; end if;
  reset role;
  raise notice 'OK 10: the board can be searched and filtered by text, kind, type, remote, place, tag and pay, and sorted';
end $$;

-- ---- 11. Nobody writes the tables directly -----------------------------------------------------------------------
do $$
declare o uuid := jbkit.off('Logo');
begin
  perform jbkit.as_user(7);
  perform jbkit.must_fail('inserting an employer', format('insert into public.employers (owner_id, kind, name) values (%L, %L, %L)', jbkit.uid(7), 'company', 'Pirate'), 'permission denied');
  perform jbkit.must_fail('approving yourself directly', format('update public.employers set status = %L where owner_id = %L', 'approved', jbkit.uid(3)), 'permission denied');
  perform jbkit.must_fail('inserting an offer', format('insert into public.job_offers (employer_id, posted_by, title, kind, description) values (%L, %L, %L, %L, %L)', jbkit.emp(1), jbkit.uid(7), 'Pirate', 'freelance', 'x'), 'permission denied');
  perform jbkit.must_fail('publishing directly', format('update public.job_offers set status = %L where id = %L', 'published', o), 'permission denied');
  perform jbkit.must_fail('deleting directly', format('delete from public.job_offers where id = %L', o), 'permission denied');
  reset role;
  perform jbkit.as_anon();
  perform jbkit.must_fail('a visitor writes an offer', $q$select public.create_job_offer('Un titre', 'freelance', 'desc')$q$, 'permission denied');
  perform jbkit.must_fail('a visitor hides', format('select public.set_job_offer_hidden(%L, true, %L)', o, 'x'), 'permission denied');
  reset role;
  raise notice 'OK 11: employers and offers can only change through the functions';
end $$;

-- ---- 12. Suspended members -------------------------------------------------------------------------------------------
do $$
declare o uuid;
begin
  perform jbkit.as_user(6);
  perform public.create_employer('individual', 'Fatou Services');
  o := public.create_job_offer('Offre de fatou', 'freelance', 'Description');
  reset role;
  insert into public.member_suspensions (user_id, reason, until) values (jbkit.uid(6), 'test', now() + interval '1 day'), (jbkit.uid(7), 'test', now() + interval '1 day');
  perform jbkit.as_user(6);
  perform jbkit.must_fail('a suspended member creates an offer', $q$select public.create_job_offer('Un titre', 'freelance', 'desc')$q$, 'suspended');
  perform jbkit.must_fail('a suspended member edits an offer', format('select public.update_job_offer(%L, %L, %L, %L)', o, 'Nouveau titre', 'freelance', 'desc'), 'suspended');
  perform jbkit.must_fail('a suspended member publishes', format('select public.publish_job_offer(%L)', o), 'suspended');
  perform jbkit.must_fail('a suspended member edits the profile', $q$select public.update_employer('Nouveau nom')$q$, 'suspended');
  reset role;
  perform jbkit.as_user(7);
  perform jbkit.must_fail('a suspended member creates a profile', $q$select public.create_employer('company', 'Nom valide')$q$, 'suspended');
  reset role;
  raise notice 'OK 12: suspended members cannot create, edit or publish';
end $$;

-- ---- Clean up --------------------------------------------------------------------------------------------------------------------
delete from public.member_suspensions where user_id::text like '9a9a9a9a-%';
delete from public.profiles where id::text like '9a9a9a9a-%';
delete from auth.users where id::text like '9a9a9a9a-%';
drop schema jbkit cascade;

do $$
begin
  if exists (select 1 from public.employers) or exists (select 1 from public.job_offers) then raise exception 'FAIL: employers or offers left behind'; end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'job_offers_max_per_day') <> '3'
     or (select value #>> '{}' from public.game_config where key = 'job_offers_max_open') <> '20' then
    raise exception 'FAIL: a limit was left changed';
  end if;
  raise notice 'OK 13: the test left nothing behind';
end $$;

select 'ALL JOBS (EMPLOYERS AND OFFERS) TESTS PASSED' as result;
