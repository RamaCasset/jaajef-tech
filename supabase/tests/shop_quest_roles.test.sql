-- Tests for the quest writer, shop manager and shop owner roles.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f shop_quest_roles.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: dame (1) admin; qui (2) quest writer; sam (3) shop manager; olu (4) shop owner;
-- modi (5) moderator only; eli (6) ordinary member.

create schema brkit;
grant usage on schema brkit to public;

create function brkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('a1a1a1a1-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function brkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', brkit.uid(p_n)::text, true);
end $$;

create function brkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function brkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function brkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := brkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function brkit.item(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where slug = p_slug $$;

create function brkit.quest(p_slug text) returns uuid
language sql stable security definer as $$ select id from public.quests where slug = p_slug $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (brkit.uid(1), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (brkit.uid(2), 'qui@exemple.sn', '{"provider":"email"}', '{}'),
  (brkit.uid(3), 'sam@exemple.sn', '{"provider":"email"}', '{}'),
  (brkit.uid(4), 'olu@exemple.sn', '{"provider":"email"}', '{}'),
  (brkit.uid(5), 'modi@exemple.sn', '{"provider":"email"}', '{}'),
  (brkit.uid(6), 'eli@exemple.sn', '{"provider":"email"}', '{}');

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published) values
  ('br-q', 'Quete roles', 'x', 'saltigue', 'ndongo', 'python', 5, 10, 1, true);
insert into public.souk_items (slug, kind, name, price_kopeks, is_active) values
  ('br-item', 'theme', 'Theme roles', 10, true);

-- ---- Setup ------------------------------------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform public.make_admin(brkit.uid(1));
  reset role;
  perform brkit.as_user(1);
  perform public.set_moderator(brkit.uid(5), true);
  reset role;
end $$;

-- ---- 1. Only an admin grants roles ------------------------------------------------------------------------------
do $$
declare n_before bigint;
begin
  perform brkit.as_anon();
  perform brkit.must_fail('a visitor grants', format('select public.set_back_office_role(%L, %L, true)', brkit.uid(2), 'quest_writer'), 'permission denied');
  reset role;
  perform brkit.as_user(5);
  perform brkit.must_fail('a moderator grants', format('select public.set_back_office_role(%L, %L, true)', brkit.uid(2), 'quest_writer'), 'Only an admin');
  reset role;
  perform brkit.as_user(6);
  perform brkit.must_fail('a member grants', format('select public.set_back_office_role(%L, %L, true)', brkit.uid(6), 'shop_owner'), 'Only an admin');
  reset role;

  perform brkit.as_user(1);
  perform brkit.must_fail('an unknown role', format('select public.set_back_office_role(%L, %L, true)', brkit.uid(2), 'boss'), 'Unknown role');
  perform brkit.must_fail('an unknown member', format('select public.set_back_office_role(%L, %L, true)', gen_random_uuid(), 'quest_writer'), 'Member not found');
  perform brkit.must_fail('no on/off', format('select public.set_back_office_role(%L, %L, null)', brkit.uid(2), 'quest_writer'), 'give or remove');
  select count(*) into n_before from public.admin_audit_log;
  perform public.set_back_office_role(brkit.uid(2), 'quest_writer', true);
  perform public.set_back_office_role(brkit.uid(2), 'quest_writer', true); -- again: no second log
  perform public.set_back_office_role(brkit.uid(3), 'shop_manager', true);
  perform public.set_back_office_role(brkit.uid(4), 'shop_owner', true);
  perform public.set_back_office_role(brkit.uid(6), 'shop_manager', false); -- nothing to remove: no log
  if (select count(*) from public.admin_audit_log) <> n_before + 3 then raise exception 'FAIL: three audit entries expected, got %', (select count(*) from public.admin_audit_log) - n_before; end if;
  if (select count(*) from public.list_back_office_team()) <> 3 then raise exception 'FAIL: three people on the team'; end if;
  if (select count(*) from public.back_office_roles) <> 3 then raise exception 'FAIL: the admin reads the table'; end if;
  reset role;

  perform brkit.as_user(2);
  if (select count(*) from public.back_office_roles) <> 1 then raise exception 'FAIL: a role holder sees only their own role'; end if;
  perform brkit.must_fail('a role holder lists the team', 'select * from public.list_back_office_team()', 'Only an admin');
  perform brkit.must_fail('direct insert', format('insert into public.back_office_roles (user_id, role) values (%L, %L)', brkit.uid(2), 'shop_owner'), 'permission denied');
  perform brkit.must_fail('direct delete', 'delete from public.back_office_roles', 'permission denied');
  reset role;
  perform brkit.as_user(6);
  if exists (select 1 from public.back_office_roles) then raise exception 'FAIL: a member sees no roles'; end if;
  reset role;
  raise notice 'OK 1: only admins grant roles, each change is logged once, and the table is read-only';
end $$;

-- ---- 2. What each person can see about themselves --------------------------------------------------------
do $$
declare r record;
begin
  perform brkit.as_user(2);
  select * into r from public.my_back_office_access();
  if not r.quest_writer or r.shop_manager or r.shop_owner then raise exception 'FAIL: quest writer flags %', r; end if;
  reset role;
  perform brkit.as_user(3);
  select * into r from public.my_back_office_access();
  if r.quest_writer or not r.shop_manager or r.shop_owner then raise exception 'FAIL: shop manager flags %', r; end if;
  reset role;
  perform brkit.as_user(4);
  select * into r from public.my_back_office_access();
  if r.quest_writer or not r.shop_manager or not r.shop_owner then raise exception 'FAIL: shop owner flags (a shop owner is also a manager) %', r; end if;
  reset role;
  perform brkit.as_user(1);
  select * into r from public.my_back_office_access();
  if not (r.quest_writer and r.shop_manager and r.shop_owner) then raise exception 'FAIL: an admin has every access %', r; end if;
  reset role;
  perform brkit.as_user(5);
  select * into r from public.my_back_office_access();
  if r.quest_writer or r.shop_manager or r.shop_owner then raise exception 'FAIL: a moderator has none of these %', r; end if;
  reset role;
  perform brkit.as_user(6);
  select * into r from public.my_back_office_access();
  if r.quest_writer or r.shop_manager or r.shop_owner then raise exception 'FAIL: a member has none of these %', r; end if;
  reset role;
  perform brkit.as_anon();
  perform brkit.must_fail('a visitor asks', 'select * from public.my_back_office_access()', 'permission denied');
  reset role;
  raise notice 'OK 2: each person sees the right access flags';
end $$;

-- ---- 3. Quest of the day is for quest writers ------------------------------------------------------------------
do $$
declare q uuid := brkit.quest('br-q');
begin
  foreach q in array array[]::uuid[] loop end loop;
  q := brkit.quest('br-q');
  perform brkit.as_user(3);
  perform brkit.must_fail('a shop manager schedules a quest', format('select public.schedule_daily_quest(%L, current_date + 30)', q), 'Only an admin or a quest writer');
  perform brkit.must_fail('a shop manager lists the quest schedule', 'select * from public.list_daily_quests()', 'Only staff');
  reset role;
  perform brkit.as_user(4);
  perform brkit.must_fail('a shop owner schedules a quest', format('select public.schedule_daily_quest(%L, current_date + 30)', q), 'Only an admin or a quest writer');
  reset role;
  perform brkit.as_user(5);
  perform brkit.must_fail('a moderator schedules a quest', format('select public.schedule_daily_quest(%L, current_date + 30)', q), 'Only an admin or a quest writer');
  reset role;
  perform brkit.as_user(6);
  perform brkit.must_fail('a member schedules a quest', format('select public.schedule_daily_quest(%L, current_date + 30)', q), 'Only an admin or a quest writer');
  reset role;
  perform brkit.as_user(2);
  perform public.schedule_daily_quest(q, current_date + 30);
  if (select count(*) from public.list_daily_quests(current_date + 30, 1) where source = 'scheduled') <> 1 then raise exception 'FAIL: scheduled by the quest writer'; end if;
  perform public.unschedule_daily_quest(current_date + 30);
  reset role;
  if exists (select 1 from public.quests where id = q and daily_on is not null) then raise exception 'FAIL: unscheduled'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'daily_quest_scheduled' and actor_id = brkit.uid(2)) then raise exception 'FAIL: the action is logged with the quest writer as actor'; end if;
  raise notice 'OK 3: quest writers (and admins) run the quest of the day; nobody else can';
end $$;

-- ---- 4. The featured item is for shop managers and owners -----------------------------------------------
do $$
declare i uuid := brkit.item('br-item');
begin
  perform brkit.as_user(2);
  perform brkit.must_fail('a quest writer features an item', format('select public.set_featured_item(%L, current_date + 21)', i), 'Only an admin or a shop manager');
  perform brkit.must_fail('a quest writer lists the shop schedule', 'select * from public.list_featured_schedule()', 'Only staff');
  reset role;
  perform brkit.as_user(5);
  perform brkit.must_fail('a moderator features an item', format('select public.set_featured_item(%L, current_date + 21)', i), 'Only an admin or a shop manager');
  reset role;
  perform brkit.as_user(6);
  perform brkit.must_fail('a member features an item', format('select public.set_featured_item(%L, current_date + 21)', i), 'Only an admin or a shop manager');
  reset role;
  perform brkit.as_user(3);
  perform public.set_featured_item(i, current_date + 21);
  if (select count(*) from public.list_featured_schedule(8) where source = 'chosen' and item_id = i) <> 1 then raise exception 'FAIL: chosen by the shop manager'; end if;
  perform public.clear_featured_item(current_date + 21);
  reset role;
  perform brkit.as_user(4);
  perform public.set_featured_item(i, current_date + 21);
  perform public.clear_featured_item(current_date + 21);
  reset role;
  if not exists (select 1 from public.admin_audit_log where action = 'souk_featured_set' and actor_id = brkit.uid(3)) then raise exception 'FAIL: logged with the shop manager as actor'; end if;
  raise notice 'OK 4: shop managers and owners run the featured item; quest writers, moderators and members cannot';
end $$;

-- ---- 5. The new roles are NOT moderation staff -----------------------------------------------------------------
do $$
begin
  perform brkit.as_user(2);
  if public.staff_role() is not null then raise exception 'FAIL: a quest writer is not in the staff table'; end if;
  perform brkit.must_fail('a quest writer reads the review queue', 'select * from public.list_review_queue()', 'Only staff');
  perform brkit.must_fail('a quest writer hides a post', format('select public.set_blog_post_hidden(%L, true, %L)', gen_random_uuid(), 'x'), 'Only staff');
  perform brkit.must_fail('a quest writer reads reports', 'select * from public.list_reports()', 'Only staff');
  reset role;
  perform brkit.as_user(4);
  perform brkit.must_fail('a shop owner reads the review queue', 'select * from public.list_review_queue()', 'Only staff');
  perform brkit.must_fail('a shop owner hides an offer', format('select public.set_job_offer_hidden(%L, true, %L)', gen_random_uuid(), 'x'), 'Only staff');
  perform brkit.must_fail('a shop owner lists the staff', 'select * from public.list_staff()', 'Only an admin');
  if exists (select 1 from public.admin_audit_log) then raise exception 'FAIL: a shop owner must not read the audit log'; end if;
  reset role;
  raise notice 'OK 5: the new roles give no moderation or admin powers';
end $$;

-- ---- 6. Removing a role removes the power -------------------------------------------------------------------
do $$
declare q uuid := brkit.quest('br-q'); i uuid := brkit.item('br-item');
begin
  perform brkit.as_user(1);
  perform public.set_back_office_role(brkit.uid(2), 'quest_writer', false);
  perform public.set_back_office_role(brkit.uid(3), 'shop_manager', false);
  reset role;
  perform brkit.as_user(2);
  perform brkit.must_fail('a former quest writer schedules', format('select public.schedule_daily_quest(%L, current_date + 30)', q), 'Only an admin or a quest writer');
  reset role;
  perform brkit.as_user(3);
  perform brkit.must_fail('a former shop manager features', format('select public.set_featured_item(%L, current_date + 21)', i), 'Only an admin or a shop manager');
  reset role;
  -- an admin can still do both
  perform brkit.as_user(1);
  perform public.schedule_daily_quest(q, current_date + 30);
  perform public.unschedule_daily_quest(current_date + 30);
  perform public.set_featured_item(i, current_date + 21);
  perform public.clear_featured_item(current_date + 21);
  reset role;
  -- deleting a profile removes its roles
  delete from public.profiles where id = brkit.uid(4);
  if exists (select 1 from public.back_office_roles where user_id = brkit.uid(4)) then raise exception 'FAIL: roles go with the profile'; end if;
  raise notice 'OK 6: removing a role removes the power; admins keep theirs; roles go with the profile';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.quests where slug = 'br-q';
delete from public.souk_items where slug = 'br-item';
delete from public.profiles where id::text like 'a1a1a1a1-%';
delete from auth.users where id::text like 'a1a1a1a1-%';
drop schema brkit cascade;

do $$
begin
  if exists (select 1 from public.back_office_roles) or exists (select 1 from public.souk_featured) then raise exception 'FAIL: data left behind'; end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL SHOP AND QUEST ROLES TESTS PASSED' as result;
