-- Tests for Souk creator submissions.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk_submissions.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) creator; bara (2) another creator; sam (3) shop manager; olu (4) shop owner;
-- dame (5) admin; eli (6) ordinary member, also a moderator-less bystander.

create schema ssk;
grant usage on schema ssk to public;

create function ssk.uid(p_n int) returns uuid
language sql immutable as $$ select ('b2b2b2b2-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function ssk.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', ssk.uid(p_n)::text, true);
end $$;

create function ssk.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function ssk.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function ssk.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := ssk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function ssk.set_config(p_key text, p_value text) returns void
language plpgsql as $$
begin
  set local role service_role;
  update public.game_config set value = p_value::jsonb where key = p_key;
  reset role;
end $$;

create function ssk.notices(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = ssk.uid(p_n) and kind = p_kind
$$;

create function ssk.sub(p_name text) returns uuid
language sql stable security definer as $$ select id from public.souk_submissions where name = p_name order by created_at desc limit 1 $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (ssk.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (ssk.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (ssk.uid(3), 'sam@exemple.sn', '{"provider":"email"}', '{}'),
  (ssk.uid(4), 'olu@exemple.sn', '{"provider":"email"}', '{}'),
  (ssk.uid(5), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (ssk.uid(6), 'eli@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  set local role service_role;
  perform public.make_admin(ssk.uid(5));
  reset role;
  perform ssk.as_user(5);
  perform public.set_back_office_role(ssk.uid(3), 'shop_manager', true);
  perform public.set_back_office_role(ssk.uid(4), 'shop_owner', true);
  reset role;
end $$;

-- ---- 1. Submitting ------------------------------------------------------------------------------------------------
do $$
declare s uuid;
begin
  perform ssk.as_anon();
  perform ssk.must_fail('a visitor submits', 'select public.submit_souk_item(''theme'', ''x'', null, ''{}'', 10)', 'permission denied');
  reset role;
  perform ssk.as_user(1);
  perform ssk.must_fail('no name', 'select public.submit_souk_item(''theme'', '' '', null, ''{}'', 10)', 'name');
  perform ssk.must_fail('a long name', format('select public.submit_souk_item(%L, %L, null, ''{}'', 10)', 'theme', repeat('a', 61)), 'too long');
  perform ssk.must_fail('a long description', format('select public.submit_souk_item(%L, %L, %L, ''{}'', 10)', 'theme', 'x', repeat('a', 301)), 'too long');
  perform ssk.must_fail('a free item', 'select public.submit_souk_item(''theme'', ''x'', null, ''{}'', 0)', 'between 1 and');
  perform ssk.must_fail('an item too expensive', 'select public.submit_souk_item(''theme'', ''x'', null, ''{}'', 1000001)', 'between 1 and');
  perform ssk.must_fail('a look that is not an object', 'select public.submit_souk_item(''theme'', ''x'', null, ''[1]''::jsonb, 10)', 'object');
  perform ssk.must_fail('a look that is too large', format('select public.submit_souk_item(%L, %L, null, jsonb_build_object(%L, %L), 10)', 'theme', 'x', 'k', repeat('a', 4100)), 'too large');
  perform ssk.must_fail('an unknown kind', 'select public.submit_souk_item(''hat'', ''x'', null, ''{}'', 10)', 'invalid input value');
  s := public.submit_souk_item('theme', '  Theme Teranga  ', 'Chaleureux', '{"primary":"#c0392b"}', 120);
  if (select status from public.souk_submissions where id = s) <> 'pending' or (select name from public.souk_submissions where id = s) <> 'Theme Teranga' then raise exception 'FAIL: a new submission is pending, with a clean name'; end if;
  if (select count(*) from public.list_my_souk_submissions()) <> 1 then raise exception 'FAIL: it is in my list'; end if;
  reset role;
  raise notice 'OK 1: submitting checks the name, description, look and price';
end $$;

-- ---- 2. Privacy and limits ------------------------------------------------------------------------------------------
do $$
begin
  perform ssk.as_user(2);
  if exists (select 1 from public.souk_submissions) or exists (select 1 from public.list_my_souk_submissions()) then raise exception 'FAIL: bara sees ana''s submission'; end if;
  perform ssk.must_fail('a member lists the queue', 'select * from public.list_souk_submissions()', 'Only shop staff');
  perform ssk.must_fail('direct insert', format('insert into public.souk_submissions (creator_id, kind, name, proposed_price) values (%L, %L, %L, 5)', ssk.uid(2), 'theme', 'x'), 'permission denied');
  perform ssk.must_fail('direct update', 'update public.souk_submissions set status = ''approved''', 'permission denied');
  reset role;
  perform ssk.as_user(3);
  if (select count(*) from public.list_souk_submissions()) <> 1 then raise exception 'FAIL: the shop manager sees the queue'; end if;
  if (select creator_username from public.list_souk_submissions()) is null then raise exception 'FAIL: creator name in the queue'; end if;
  perform ssk.must_fail('an unknown status', 'select * from public.list_souk_submissions(''done'')', 'Unknown status');
  reset role;
  perform ssk.as_anon();
  perform ssk.must_fail('a visitor lists the queue', 'select * from public.list_souk_submissions()', 'permission denied');
  reset role;

  -- limits
  perform ssk.set_config('souk_submissions_max_per_day', '2');
  perform ssk.as_user(2);
  perform public.submit_souk_item('avatar_frame', 'Cadre 1', null, '{}', 10);
  perform public.submit_souk_item('avatar_frame', 'Cadre 2', null, '{}', 10);
  perform ssk.must_fail('over the daily limit', 'select public.submit_souk_item(''avatar_frame'', ''Cadre 3'', null, ''{}'', 10)', 'too fast');
  reset role;
  perform ssk.set_config('souk_submissions_max_per_day', '3');
  perform ssk.set_config('souk_submissions_max_pending', '2');
  perform ssk.as_user(2);
  perform ssk.must_fail('over the waiting limit', 'select public.submit_souk_item(''avatar_frame'', ''Cadre 3'', null, ''{}'', 10)', 'waiting for review');
  reset role;
  perform ssk.set_config('souk_submissions_max_pending', '5');

  -- a suspended member
  insert into public.member_suspensions (user_id, reason, until) values (ssk.uid(6), 'test', now() + interval '1 day');
  perform ssk.as_user(6);
  perform ssk.must_fail('a suspended member submits', 'select public.submit_souk_item(''theme'', ''x'', null, ''{}'', 10)', 'suspended');
  reset role;
  delete from public.member_suspensions where user_id = ssk.uid(6);
  raise notice 'OK 2: submissions are private, the queue is for shop staff, and limits and suspensions hold';
end $$;

-- ---- 3. Editing and withdrawing ---------------------------------------------------------------------------
do $$
declare s uuid := ssk.sub('Cadre 2'); keep uuid := ssk.sub('Cadre 1');
begin
  perform ssk.as_user(1);
  perform ssk.must_fail('editing someone else''s submission', format('select public.update_souk_submission(%L, %L, %L, null, ''{}'', 10)', s, 'theme', 'x'), 'not found');
  perform ssk.must_fail('withdrawing someone else''s', format('select public.withdraw_souk_submission(%L)', s), 'Submission not found');
  reset role;
  perform ssk.as_user(2);
  perform public.update_souk_submission(s, 'avatar_frame', 'Cadre 2 bis', 'Mieux', '{"border":"gold"}', 40);
  if (select proposed_price from public.souk_submissions where id = s) <> 40 or (select name from public.souk_submissions where id = s) <> 'Cadre 2 bis' then raise exception 'FAIL: edited'; end if;
  perform ssk.must_fail('editing with a bad price', format('select public.update_souk_submission(%L, %L, %L, null, ''{}'', 0)', s, 'avatar_frame', 'x'), 'between 1 and');
  perform public.withdraw_souk_submission(s);
  perform public.withdraw_souk_submission(s);
  perform ssk.must_fail('editing a withdrawn one', format('select public.update_souk_submission(%L, %L, %L, null, ''{}'', 10)', s, 'avatar_frame', 'x'), 'no longer waiting');
  reset role;
  perform ssk.as_user(3);
  perform ssk.must_fail('reviewing a withdrawn one', format('select public.review_souk_submission(%L, true)', s), 'already been handled');
  if (select count(*) from public.list_souk_submissions('pending')) <> 2 then raise exception 'FAIL: two still waiting (ana''s and bara''s first)'; end if;
  reset role;
  raise notice 'OK 3: creators edit and withdraw only their own waiting submissions';
end $$;

-- ---- 4. Reviewing ------------------------------------------------------------------------------------------------
do $$
declare a uuid := ssk.sub('Theme Teranga'); b uuid := ssk.sub('Cadre 1'); item uuid; n_before bigint;
begin
  select count(*) into n_before from public.admin_audit_log;
  perform ssk.as_user(6);
  perform ssk.must_fail('a member reviews', format('select public.review_souk_submission(%L, true)', a), 'Only shop staff');
  reset role;
  perform ssk.as_user(1);
  perform ssk.must_fail('a creator approves her own', format('select public.review_souk_submission(%L, true)', a), 'Only shop staff');
  reset role;
  perform ssk.as_user(3);
  perform ssk.must_fail('no choice', format('select public.review_souk_submission(%L, null)', a), 'approve or reject');
  perform ssk.must_fail('rejecting without a reason', format('select public.review_souk_submission(%L, false)', b), 'why');
  perform ssk.must_fail('a long note', format('select public.review_souk_submission(%L, false, %L)', b, repeat('a', 501)), 'too long');
  perform ssk.must_fail('an unknown submission', format('select public.review_souk_submission(%L, true)', gen_random_uuid()), 'not found');
  perform ssk.must_fail('a bad price', format('select public.review_souk_submission(%L, true, null, 0)', a), 'between 1 and');
  item := public.review_souk_submission(a, true, 'Joli travail', 150);
  reset role;
  if (select price_kopeks from public.souk_items where id = item) <> 150 then raise exception 'FAIL: the manager changed the price'; end if;
  if (select creator_id from public.souk_items where id = item) <> ssk.uid(1) or not (select is_active from public.souk_items where id = item) then raise exception 'FAIL: the item is on sale with its creator'; end if;
  if (select slug from public.souk_items where id = item) !~ '^theme-teranga-[0-9a-f]{8}$' then raise exception 'FAIL: slug %', (select slug from public.souk_items where id = item); end if;
  if (select status from public.souk_submissions where id = a) <> 'approved' or (select item_id from public.souk_submissions where id = a) <> item then raise exception 'FAIL: submission marked approved'; end if;
  if ssk.notices(1, 'souk_submission_approved') <> 1 then raise exception 'FAIL: the creator is told'; end if;
  if (select count(*) from public.admin_audit_log) <> n_before + 1 then raise exception 'FAIL: one audit entry'; end if;

  perform ssk.as_user(3);
  perform ssk.must_fail('reviewing twice', format('select public.review_souk_submission(%L, false, %L)', a, 'non'), 'already been handled');
  perform public.review_souk_submission(b, false, 'Trop proche d''un autre cadre');
  reset role;
  if (select status from public.souk_submissions where id = b) <> 'rejected' or ssk.notices(2, 'souk_submission_rejected') <> 1 then raise exception 'FAIL: rejected and told'; end if;
  if (select data ->> 'note' from public.notifications where user_id = ssk.uid(2) and kind = 'souk_submission_rejected') is null then raise exception 'FAIL: the reason is in the notice'; end if;
  if exists (select 1 from public.souk_items where name = 'Cadre 1') then raise exception 'FAIL: a rejected item must not be on sale'; end if;
  raise notice 'OK 4: approving puts the item on sale with its creator and price; rejecting needs a reason; both tell the creator';
end $$;

-- ---- 5. The approved item is a normal shop item ----------------------------------------------------------------------
do $$
declare item uuid := (select item_id from public.souk_submissions where name = 'Theme Teranga');
begin
  perform ssk.as_anon();
  if not exists (select 1 from public.souk_shop() where id = item) then raise exception 'FAIL: the item shows in the shop'; end if;
  reset role;
  -- a buyer
  set local role service_role;
  perform public.grant_reward(ssk.uid(6), 0, 500, 'test_credit', 'ssk:credit', null, null);
  reset role;
  perform ssk.as_user(6);
  perform public.buy_item(item);
  reset role;
  if not exists (select 1 from public.member_items where user_id = ssk.uid(6) and item_id = item) then raise exception 'FAIL: bought'; end if;
  -- a manager cannot approve her own: olu submits, olu reviews
  perform ssk.as_user(4);
  perform public.submit_souk_item('status_badge', 'Badge Olu', null, '{}', 30);
  perform ssk.must_fail('a shop owner approves her own', format('select public.review_souk_submission(%L, true)', ssk.sub('Badge Olu')), 'your own submission');
  reset role;
  perform ssk.as_user(5);
  perform public.review_souk_submission(ssk.sub('Badge Olu'), true);
  reset role;
  raise notice 'OK 5: approved items sell like any other; nobody reviews their own submission, but an admin can review a shop owner''s';
end $$;

-- ---- 6. When a creator leaves ----------------------------------------------------------------------------------------
do $$
declare item uuid := (select item_id from public.souk_submissions where name = 'Theme Teranga');
begin
  delete from public.profiles where id = ssk.uid(1);
  if not exists (select 1 from public.souk_items where id = item and creator_id is null) then raise exception 'FAIL: the item stays, without a creator'; end if;
  if exists (select 1 from public.souk_submissions where creator_id = ssk.uid(1)) then raise exception 'FAIL: her submissions go with her'; end if;
  raise notice 'OK 6: deleting a creator keeps the item that people own';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.member_items where user_id::text like 'b2b2b2b2-%';
delete from public.souk_items where creator_id::text like 'b2b2b2b2-%' or name in ('Theme Teranga', 'Badge Olu');
delete from public.wallets where user_id::text like 'b2b2b2b2-%';
delete from public.profiles where id::text like 'b2b2b2b2-%';
delete from auth.users where id::text like 'b2b2b2b2-%';
drop schema ssk cascade;

do $$
begin
  if exists (select 1 from public.souk_submissions) or exists (select 1 from public.souk_items where creator_id is not null or name in ('Theme Teranga', 'Badge Olu')) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.back_office_roles) or exists (select 1 from public.staff_roles) then raise exception 'FAIL: roles left behind'; end if;
  if (select value #>> '{}' from public.game_config where key = 'souk_submissions_max_per_day') <> '3'
     or (select value #>> '{}' from public.game_config where key = 'souk_submissions_max_pending') <> '5' then
    raise exception 'FAIL: a setting was left changed';
  end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL SOUK SUBMISSIONS TESTS PASSED' as result;
