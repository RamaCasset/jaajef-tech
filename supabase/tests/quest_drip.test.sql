-- Tests for the quest drip: one new quest a day from each member's own join date.
-- Run AFTER all migrations. Everything created here is deleted at the end.
-- People: ana (1) joined today, bara (2) joined 2 days ago, coumba (3) joined 10 days ago.
-- Quests: dp-1 .. dp-4 (drip days 1 to 4), dp-path (drip day 9, a step of a published path), dp-free (no drip day).
create schema if not exists tg;
create or replace function tg.submit_quest(p_quest uuid, p_code text, p_passed integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public.record_graded_attempt(auth.uid(), p_quest, p_code, p_passed, p_total); end $$;
grant usage on schema tg to authenticated, anon, service_role;
grant execute on function tg.submit_quest(uuid, text, integer, integer) to authenticated, anon, service_role;

create schema dpt;
grant usage on schema dpt to public;
create function dpt.uid(p_n int) returns uuid language sql immutable as $$ select ('d9d9d9d9-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function dpt.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', dpt.uid(p_n)::text, true);
end $$;
create function dpt.as_anon() returns void language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function dpt.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function dpt.quest(p_slug text) returns uuid language sql stable security definer as $$ select id from public.quests where slug = p_slug $$;
create function dpt.seen() returns text language sql stable as $$
  select coalesce(string_agg(slug, ',' order by slug), '') from public.quests where slug like 'dp-%'
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (dpt.uid(1), 'ana-dp@exemple.sn', '{"provider":"email"}', '{}'),
  (dpt.uid(2), 'bara-dp@exemple.sn', '{"provider":"email"}', '{}'),
  (dpt.uid(3), 'coumba-dp@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set created_at = now() where id = dpt.uid(1);
update public.profiles set created_at = now() - interval '2 days' where id = dpt.uid(2);
update public.profiles set created_at = now() - interval '10 days' where id = dpt.uid(3);

insert into public.quests (slug, title, summary, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published, drip_day) values
  ('dp-1', 'Jour un', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, 1),
  ('dp-2', 'Jour deux', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, 2),
  ('dp-3', 'Jour trois', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, 3),
  ('dp-4', 'Jour quatre', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, 4),
  ('dp-path', 'Quete de parcours', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, 9),
  ('dp-free', 'Quete libre', 'x', 'saltigue', 'ndongo', 'python', 5, 100, 10, true, null);
insert into public.quest_tests (quest_id, position, name, input, expected)
select id, 1, 't', '1'::jsonb, '1'::jsonb from public.quests where slug like 'dp-%';
insert into public.learning_paths (slug, clan, title, published) values ('dp-path-one', 'saltigue', 'Parcours', true);
insert into public.learning_steps (path_id, position, title, quest_id)
select p.id, 1, 'Etape', q.id from public.learning_paths p, public.quests q where p.slug = 'dp-path-one' and q.slug = 'dp-path';

-- ---- 1. A member sees the quests up to their own day; a path quest and a free quest are always open --------------------
do $$
declare s text;
begin
  perform dpt.as_user(1); s := dpt.seen(); reset role;
  if s <> 'dp-1,dp-free,dp-path' then raise exception 'FAIL: day 1 sees %', s; end if;
  perform dpt.as_user(2); s := dpt.seen(); reset role;
  if s <> 'dp-1,dp-2,dp-3,dp-free,dp-path' then raise exception 'FAIL: day 3 sees %', s; end if;
  perform dpt.as_user(3); s := dpt.seen(); reset role;
  if s <> 'dp-1,dp-2,dp-3,dp-4,dp-free,dp-path' then raise exception 'FAIL: day 11 sees %', s; end if;
  raise notice 'OK 1: each member sees the quests of their own day';
end $$;

-- ---- 2. A visitor sees day 1 -------------------------------------------------------------------------------------------------
do $$
declare s text;
begin
  perform dpt.as_anon(); s := dpt.seen(); reset role;
  if s <> 'dp-1,dp-free,dp-path' then raise exception 'FAIL: a visitor sees %', s; end if;
  raise notice 'OK 2: a visitor sees day 1';
end $$;

-- ---- 3. A closed quest cannot be started ------------------------------------------------------------------------------------
do $$
declare e text;
begin
  perform dpt.as_user(1);
  e := dpt.error_of('select public.start_quest(dpt.quest(''dp-3''))');
  if e is null or e not ilike '%quest not available%' then raise exception 'FAIL: a closed quest was started (%)', e; end if;
  perform public.start_quest(dpt.quest('dp-1'));
  perform public.start_quest(dpt.quest('dp-path'));
  reset role;
  raise notice 'OK 3: a closed quest cannot be started, an open one and a path quest can';
end $$;

-- ---- 4. Each member has their own quest of the day, and it starts again after the last day ----------------------------------
do $$
declare a text; b text; c text;
begin
  perform dpt.as_user(1); select slug into a from public.quest_of_the_day(); reset role;
  perform dpt.as_user(2); select slug into b from public.quest_of_the_day(); reset role;
  perform dpt.as_user(3); select slug into c from public.quest_of_the_day(); reset role;
  if a <> 'dp-1' then raise exception 'FAIL: day 1 daily quest is %', a; end if;
  if b <> 'dp-3' then raise exception 'FAIL: day 3 daily quest is %', b; end if;
  -- day 11 with 9 days in the cycle is day 2 of the next round, and day 2 has dp-2
  if c <> 'dp-2' then raise exception 'FAIL: day 11 daily quest is %', c; end if;
  raise notice 'OK 4: the quest of the day follows the member';
end $$;

-- ---- 5. My progress and the earlier days -------------------------------------------------------------------------------------
do $$
declare p jsonb; n integer; first_slug text;
begin
  perform dpt.as_user(1); p := public.my_quest_drip(); reset role;
  if p <> '{"day": 1, "total": 9}'::jsonb then raise exception 'FAIL: progress is %', p; end if;
  perform dpt.as_user(2);
  select count(*), min(slug) filter (where day = current_date - 1) into n, first_slug from public.list_past_daily_quests(30);
  reset role;
  if n <> 2 or first_slug <> 'dp-2' then raise exception 'FAIL: past days % %', n, first_slug; end if;
  perform dpt.as_user(1);
  select count(*) into n from public.list_past_daily_quests(30);
  reset role;
  if n <> 0 then raise exception 'FAIL: a new member has no earlier day'; end if;
  raise notice 'OK 5: progress and earlier days follow the member''s clock';
end $$;

-- ---- 6. The daily bonus belongs to the member's own quest of the day ---------------------------------------------------------
do $$
declare r jsonb;
begin
  perform dpt.as_user(1);
  perform public.start_quest(dpt.quest('dp-free'));
  reset role;
  update public.quest_attempts set started_at = now() - interval '2 minutes' where user_id = dpt.uid(1);
  perform dpt.as_user(1);
  r := tg.submit_quest(dpt.quest('dp-1'), 'solution', 1, 1);
  if not (r ->> 'solved')::boolean or not (r ->> 'daily_quest')::boolean then raise exception 'FAIL: the quest of the day is not flagged %', r; end if;
  r := tg.submit_quest(dpt.quest('dp-free'), 'solution', 1, 1);
  if not (r ->> 'solved')::boolean or (r ->> 'daily_quest')::boolean then raise exception 'FAIL: another quest is flagged as the quest of the day %', r; end if;
  reset role;
  raise notice 'OK 6: only the member''s own quest of the day counts as the daily quest';
end $$;

-- ---- 7. With no drip configured, everything works as before --------------------------------------------------------------------
do $$
declare s text;
begin
  update public.quests set drip_day = null where slug like 'dp-%';
  if public.drip_total() is not null and exists (select 1 from public.quests where drip_day is not null and slug not like 'dp-%') then
    raise notice 'SKIP 7: other drip quests exist';
    return;
  end if;
  perform dpt.as_user(1); s := dpt.seen(); reset role;
  if s <> 'dp-1,dp-2,dp-3,dp-4,dp-free,dp-path' then raise exception 'FAIL: without a drip everything is open, saw %', s; end if;
  raise notice 'OK 7: without a drip every quest is open';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------------------
delete from public.learning_paths where slug = 'dp-path-one';
delete from public.quests where slug like 'dp-%';
delete from public.profiles where id::text like 'd9d9d9d9-%';
delete from auth.users where id::text like 'd9d9d9d9-%';
drop schema dpt cascade;

do $$
begin
  if exists (select 1 from public.quests where slug like 'dp-%') then raise exception 'FAIL: data left behind'; end if;
  raise notice 'OK 8: the test left nothing behind';
end $$;

select 'ALL QUEST DRIP TESTS PASSED' as result;
