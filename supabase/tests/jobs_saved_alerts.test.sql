-- Tests for Jobs part 4 (saved offers, saved searches, alerts, email summary data).
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f jobs_saved_alerts.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) and bara (2) search; coumba (3) runs company "Atelier Coumba" and posts offers;
-- dame (4) is an admin; fatou (5) has an alert and gets suspended.

create schema svkit;
grant usage on schema svkit to public;

create function svkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('7e7e7e7e-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function svkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', svkit.uid(p_n)::text, true);
end $$;

create function svkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function svkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function svkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function svkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := svkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function svkit.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

create function svkit.off(p_title text) returns uuid
language sql stable security definer as $$ select id from public.job_offers where title = p_title $$;

create function svkit.alerts(p_n int) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = svkit.uid(p_n) and kind = 'job_alert'
$$;

-- Post an offer as coumba and publish it.
create function svkit.post(p_title text, p_kind text, p_remote text, p_tags text[], p_min bigint default null, p_unit text default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform svkit.as_user(3);
  v := public.create_job_offer(p_title, p_kind, 'Description de ' || p_title,
         case when p_kind = 'job' then 'full_time' else null end, 'Dakar', p_remote,
         p_min, null, p_unit, false, p_tags, null, true);
  reset role;
  return v;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (svkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (svkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (svkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (svkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (svkit.uid(5), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

-- ---- Setup ------------------------------------------------------------------------------------------------------
do $$
declare e uuid;
begin
  perform svkit.as_server();
  perform public.make_admin(svkit.uid(4));
  reset role;
  perform svkit.as_user(3);
  e := public.create_employer('company', 'Atelier Coumba');
  reset role;
  perform svkit.as_user(4);
  perform public.review_employer(e, true);
  reset role;
  perform svkit.set_config('job_offers_max_per_day', '100');
  perform svkit.post('Offre existante', 'freelance', 'remote', array['python']);
  perform svkit.as_user(3);
  perform public.create_job_offer('Brouillon', 'freelance', 'Pas publie');
  reset role;
end $$;

-- ---- 1. Saved offers ----------------------------------------------------------------------------------------------
do $$
declare o uuid := svkit.off('Offre existante');
begin
  perform svkit.as_anon();
  perform svkit.must_fail('a visitor saves', format('select public.save_offer(%L)', o), 'permission denied');
  reset role;
  perform svkit.as_user(1);
  perform svkit.must_fail('saving an unknown offer', format('select public.save_offer(%L)', gen_random_uuid()), 'Offer not found');
  perform svkit.must_fail('saving a draft', format('select public.save_offer(%L)', svkit.off('Brouillon')), 'Offer not found');
  perform public.save_offer(o);
  perform public.save_offer(o); -- again: harmless
  if (select count(*) from public.list_saved_offers()) <> 1 then raise exception 'FAIL: one saved offer expected'; end if;
  if not (select is_listed from public.list_saved_offers()) or (select employer_name from public.list_saved_offers()) <> 'Atelier Coumba' then
    raise exception 'FAIL: saved offer row';
  end if;
  if (select count(*) from public.saved_offers) <> 1 then raise exception 'FAIL: ana reads her saved offers'; end if;
  reset role;
  perform svkit.as_user(2);
  if exists (select 1 from public.saved_offers) or exists (select 1 from public.list_saved_offers()) then raise exception 'FAIL: bara sees ana''s saved offers'; end if;
  perform svkit.must_fail('direct insert', format('insert into public.saved_offers (user_id, offer_id) values (%L, %L)', svkit.uid(2), o), 'permission denied');
  reset role;

  -- closing the offer keeps it in the list, marked as not listed
  perform svkit.as_user(3);
  perform public.close_job_offer(o);
  reset role;
  perform svkit.as_user(1);
  if (select is_listed from public.list_saved_offers()) then raise exception 'FAIL: a closed offer is not listed'; end if;
  reset role;
  perform svkit.as_user(2);
  perform svkit.must_fail('saving a closed offer', format('select public.save_offer(%L)', o), 'Offer not found');
  reset role;
  perform svkit.as_user(1);
  perform public.unsave_offer(o);
  perform public.unsave_offer(o);
  if exists (select 1 from public.list_saved_offers()) then raise exception 'FAIL: unsaved'; end if;
  reset role;

  -- the limit
  perform svkit.post('Offre B', 'freelance', 'remote', array['go']);
  perform svkit.post('Offre C', 'freelance', 'remote', array['go']);
  perform svkit.post('Offre D', 'freelance', 'remote', array['go']);
  perform svkit.set_config('saved_offers_max', '2');
  perform svkit.as_user(1);
  perform public.save_offer(svkit.off('Offre B'));
  perform public.save_offer(svkit.off('Offre C'));
  perform svkit.must_fail('over the saved limit', format('select public.save_offer(%L)', svkit.off('Offre D')), 'as many offers');
  perform public.save_offer(svkit.off('Offre C')); -- already saved: still fine at the limit
  reset role;
  perform svkit.set_config('saved_offers_max', '200');

  -- an offer deleted by its company leaves the lists
  perform svkit.as_user(3);
  perform public.delete_job_offer(svkit.off('Offre B'));
  reset role;
  perform svkit.as_user(1);
  if (select count(*) from public.list_saved_offers()) <> 1 then raise exception 'FAIL: a deleted offer leaves the saved list'; end if;
  perform public.unsave_offer(svkit.off('Offre C'));
  reset role;
  perform svkit.as_user(3);
  perform public.publish_job_offer(svkit.off('Offre existante'));
  reset role;
  raise notice 'OK 1: saving offers works, is private, has a limit, and follows the offer when it closes or goes';
end $$;

-- ---- 2. Saved searches --------------------------------------------------------------------------------------------
do $$
declare s1 uuid; s2 uuid;
begin
  perform svkit.as_anon();
  perform svkit.must_fail('a visitor saves a search', 'select public.create_saved_search(''x'', ''python'')', 'permission denied');
  reset role;
  perform svkit.as_user(1);
  perform svkit.must_fail('no name', 'select public.create_saved_search('' '', ''python'')', 'name');
  perform svkit.must_fail('no filter', 'select public.create_saved_search(''Tout'')', 'at least one filter');
  perform svkit.must_fail('pay without unit', 'select public.create_saved_search(''Pay'', null, null, null, null, null, null, 1000)', 'what the pay is for');
  perform svkit.must_fail('bad kind', 'select public.create_saved_search(''x'', null, ''gig'')', 'Unknown kind');
  perform svkit.must_fail('bad remote', 'select public.create_saved_search(''x'', null, null, null, ''moon'')', 'Unknown remote');
  perform svkit.must_fail('bad tag', 'select public.create_saved_search(''x'', null, null, null, null, null, ''A B!'')', 'tag');
  perform svkit.must_fail('long name', format('select public.create_saved_search(%L, ''python'')', repeat('a', 61)), 'too long');
  s1 := public.create_saved_search('Python a distance', 'python', null, null, 'remote');
  s2 := public.create_saved_search('Missions go', null, 'freelance', null, null, null, '  GO ', null, null, false);
  if (select tag from public.saved_searches where id = s2) <> 'go' then raise exception 'FAIL: the tag should be cleaned'; end if;
  if (select count(*) from public.list_saved_searches()) <> 2 then raise exception 'FAIL: two saved searches'; end if;
  if (select alerts_on from public.saved_searches where id = s2) then raise exception 'FAIL: alerts off at creation'; end if;
  reset role;

  perform svkit.as_user(2);
  if exists (select 1 from public.saved_searches) then raise exception 'FAIL: bara sees ana''s searches'; end if;
  perform svkit.must_fail('toggling someone else''s search', format('select public.set_saved_search_alerts(%L, false)', s1), 'Search not found');
  perform svkit.must_fail('running someone else''s search', format('select * from public.run_saved_search(%L)', s1), 'Search not found');
  perform public.delete_saved_search(s1); -- not hers: nothing happens
  perform svkit.must_fail('direct update', format('update public.saved_searches set alerts_on = false where id = %L', s1), 'permission denied');
  reset role;
  if not exists (select 1 from public.saved_searches where id = s1) then raise exception 'FAIL: bara deleted ana''s search'; end if;

  perform svkit.as_user(1);
  perform public.set_saved_search_alerts(s2, true);
  perform public.set_saved_search_alerts(s2, true);
  if not (select alerts_on from public.saved_searches where id = s2) then raise exception 'FAIL: alerts turned on'; end if;
  perform svkit.must_fail('unknown value', format('select public.set_saved_search_alerts(%L, null)', s2), 'on or off');
  -- running a search returns the board's results with those filters
  if (select count(*) from public.run_saved_search(s1)) <> 1 then raise exception 'FAIL: python remote search should find the one offer, got %', (select count(*) from public.run_saved_search(s1)); end if;
  if (select count(*) from public.run_saved_search(s2)) <> 2 then raise exception 'FAIL: go freelance search should find 2 offers, got %', (select count(*) from public.run_saved_search(s2)); end if;
  perform public.delete_saved_search(s2);
  if (select count(*) from public.list_saved_searches()) <> 1 then raise exception 'FAIL: deleted search'; end if;

  perform svkit.set_config('saved_searches_max', '1');
  perform svkit.must_fail('over the search limit', 'select public.create_saved_search(''Encore'', ''react'')', 'as many searches');
  reset role;
  perform svkit.set_config('saved_searches_max', '10');
  perform svkit.as_user(1);
  perform public.delete_saved_search(s1);
  reset role;
  raise notice 'OK 2: saved searches are private, validated, limited, and run like the job board';
end $$;

-- ---- 3. Alerts ----------------------------------------------------------------------------------------------------
do $$
declare o uuid; o2 uuid;
begin
  -- ana: python + remote (alerts on) and a second search that also matches; bara: freelance (alerts off);
  -- coumba: has a search that matches her own offers; fatou: a search, then suspended.
  perform svkit.as_user(1);
  perform public.create_saved_search('Python distance', 'python', null, null, 'remote');
  perform public.create_saved_search('Missions', null, 'freelance');
  reset role;
  perform svkit.as_user(2);
  perform public.create_saved_search('Freelance', null, 'freelance', null, null, null, null, null, null, false);
  reset role;
  perform svkit.as_user(3);
  perform public.create_saved_search('Mes offres', 'python');
  reset role;
  perform svkit.as_user(5);
  perform public.create_saved_search('Fatou', null, 'freelance');
  reset role;
  insert into public.member_suspensions (user_id, reason, until) values (svkit.uid(5), 'test', now() + interval '1 day');

  o := svkit.post('Dev Python remote', 'freelance', 'remote', array['python']);
  if svkit.alerts(1) <> 1 then raise exception 'FAIL: ana gets one notice even though two of her searches match, got %', svkit.alerts(1); end if;
  if svkit.alerts(2) <> 0 then raise exception 'FAIL: bara has alerts off'; end if;
  if svkit.alerts(3) <> 0 then raise exception 'FAIL: the company is not alerted about its own offer'; end if;
  if svkit.alerts(5) <> 0 then raise exception 'FAIL: a suspended member is not alerted'; end if;
  if (select data ->> 'offer_title' from public.notifications where user_id = svkit.uid(1) and kind = 'job_alert') <> 'Dev Python remote' then raise exception 'FAIL: notice content'; end if;
  if (select count(*) from public.job_alert_matches where user_id = svkit.uid(1)) <> 1 then raise exception 'FAIL: one match row for ana'; end if;

  -- an offer that matches only the second search
  o2 := svkit.post('Mission design', 'freelance', 'onsite', array['figma']);
  if svkit.alerts(1) <> 2 then raise exception 'FAIL: the second offer matches the Missions search'; end if;
  -- an offer that matches nothing
  perform svkit.post('Poste CDI', 'job', 'onsite', array['java']);
  if svkit.alerts(1) <> 2 then raise exception 'FAIL: a job offer matches none of ana''s searches'; end if;
  -- a draft does not alert
  perform svkit.as_user(3);
  perform public.create_job_offer('Mission en brouillon', 'freelance', 'brouillon');
  reset role;
  if svkit.alerts(1) <> 2 then raise exception 'FAIL: a draft does not alert'; end if;
  -- publishing a draft later does
  perform svkit.as_user(3);
  perform public.publish_job_offer(svkit.off('Mission en brouillon'));
  reset role;
  if svkit.alerts(1) <> 3 then raise exception 'FAIL: publishing the draft alerts'; end if;
  -- unpublishing and publishing again does not alert twice
  perform svkit.as_user(3);
  perform public.unpublish_job_offer(o2);
  perform public.publish_job_offer(o2);
  reset role;
  if svkit.alerts(1) <> 3 then raise exception 'FAIL: the same offer must not alert twice, got %', svkit.alerts(1); end if;
  -- turning alerts off stops them
  perform svkit.as_user(1);
  perform public.set_saved_search_alerts(id, false) from public.saved_searches;
  reset role;
  perform svkit.post('Autre mission', 'freelance', 'remote', array['python']);
  if svkit.alerts(1) <> 3 then raise exception 'FAIL: alerts off means no more notices'; end if;
  raise notice 'OK 3: alerts go to the right members, once per offer, and not for drafts, own offers, suspended members or alerts that are off';
end $$;

-- ---- 4. Pay in alerts --------------------------------------------------------------------------------------------
do $$
begin
  perform svkit.as_user(2);
  perform public.create_saved_search('Bien paye', null, null, null, null, null, null, 400000, 'month', true);
  reset role;
  perform svkit.post('Mission mal payee', 'freelance', 'remote', array['x1'], 200000, 'month');
  perform svkit.post('Mission autre unite', 'freelance', 'remote', array['x2'], 900000, 'year');
  if svkit.alerts(2) <> 0 then raise exception 'FAIL: low pay and a different unit do not match'; end if;
  perform svkit.post('Mission bien payee', 'freelance', 'remote', array['x3'], 500000, 'month');
  if svkit.alerts(2) <> 1 then raise exception 'FAIL: good pay in the same unit matches'; end if;
  raise notice 'OK 4: pay filters in alerts follow the same rule as the job board';
end $$;

-- ---- 5. Email summary data ---------------------------------------------------------------------------------------
do $$
declare r record;
begin
  perform svkit.as_user(1);
  if (select email_digest from public.my_job_alert_settings()) is not true then raise exception 'FAIL: email on by default'; end if;
  if (select unread_matches from public.my_job_alert_settings()) <> 3 then raise exception 'FAIL: three waiting matches for ana, got %', (select unread_matches from public.my_job_alert_settings()); end if;
  perform svkit.must_fail('a member reads the pending list', 'select * from public.job_digest_pending()', 'permission denied');
  perform svkit.must_fail('a member marks sent', 'select public.mark_job_digest_sent(array[null::uuid])', 'permission denied');
  perform svkit.must_fail('direct read of matches', 'select * from public.job_alert_matches', 'permission denied');
  reset role;
  perform svkit.as_anon();
  perform svkit.must_fail('a visitor reads the pending list', 'select * from public.job_digest_pending()', 'permission denied');
  reset role;

  perform svkit.as_server();
  select * into r from public.job_digest_pending() where user_id = svkit.uid(1);
  reset role;
  if r.email <> 'ana@exemple.sn' or jsonb_array_length(r.offers) <> 3 then raise exception 'FAIL: digest for ana: %', r; end if;
  perform svkit.as_server();
  if exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(5)) then raise exception 'FAIL: fatou had no match'; end if;
  reset role;

  -- email off: no digest for bara
  perform svkit.as_user(2);
  perform public.set_job_alert_email(false);
  reset role;
  perform svkit.as_server();
  if exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(2)) then raise exception 'FAIL: bara turned the email off'; end if;
  reset role;
  perform svkit.as_user(2);
  perform public.set_job_alert_email(true);
  reset role;
  perform svkit.as_server();
  if not exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(2)) then raise exception 'FAIL: email back on'; end if;
  -- an offer closed since the match is left out
  reset role;
  perform svkit.as_user(3);
  perform public.close_job_offer(svkit.off('Mission bien payee'));
  reset role;
  perform svkit.as_server();
  if exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(2)) then raise exception 'FAIL: a closed offer should not be in the email'; end if;
  reset role;

  -- sending: mark ana as sent
  perform svkit.as_server();
  if public.mark_job_digest_sent(array[svkit.uid(1)]) <> 3 then raise exception 'FAIL: three matches marked'; end if;
  if exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(1)) then raise exception 'FAIL: nothing left for ana'; end if;
  reset role;
  -- old matches are not emailed
  update public.job_alert_matches set created_at = now() - interval '4 days' where user_id = svkit.uid(2);
  perform svkit.as_server();
  if exists (select 1 from public.job_digest_pending() where user_id = svkit.uid(2)) then raise exception 'FAIL: matches older than 3 days are not emailed'; end if;
  perform public.mark_job_digest_sent('{}');
  reset role;
  if exists (select 1 from public.job_alert_matches where emailed_at is null and user_id = svkit.uid(2)) then raise exception 'FAIL: old matches should be closed off'; end if;
  raise notice 'OK 5: the email summary data respects the member''s choice, the 3-day window and closed offers';
end $$;

-- ---- 6. When a member goes ----------------------------------------------------------------------------------------
do $$
begin
  perform svkit.as_user(2);
  perform public.save_offer(svkit.off('Offre existante'));
  reset role;
  delete from public.profiles where id = svkit.uid(2);
  if exists (select 1 from public.saved_offers where user_id = svkit.uid(2)) or exists (select 1 from public.saved_searches where user_id = svkit.uid(2))
     or exists (select 1 from public.job_alert_matches where user_id = svkit.uid(2)) then
    raise exception 'FAIL: deleting a profile should remove its saved items';
  end if;
  raise notice 'OK 6: saved items go with the profile';
end $$;

select svkit.set_config('job_offers_max_per_day', '3');

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.member_suspensions where user_id::text like '7e7e7e7e-%';
delete from public.profiles where id::text like '7e7e7e7e-%';
delete from auth.users where id::text like '7e7e7e7e-%';
drop schema svkit cascade;

do $$
begin
  if exists (select 1 from public.saved_offers) or exists (select 1 from public.saved_searches)
     or exists (select 1 from public.job_alert_matches) or exists (select 1 from public.job_alert_settings)
     or exists (select 1 from public.job_offers) or exists (select 1 from public.employers) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'saved_offers_max') <> '200'
     or (select value #>> '{}' from public.game_config where key = 'saved_searches_max') <> '10'
     or (select value #>> '{}' from public.game_config where key = 'job_offers_max_per_day') <> '3' then
    raise exception 'FAIL: a setting was left changed';
  end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL JOBS (SAVED AND ALERTS) TESTS PASSED' as result;
