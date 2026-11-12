-- Tests for server-side grading. Run AFTER all migrations, including "server_grading".
-- psql -v ON_ERROR_STOP=1 -f server_grading.test.sql

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('ee000000-0000-0000-0000-000000000001', 'sg1@exemple.sn', '{"provider":"email"}', '{}'),
  ('ee000000-0000-0000-0000-000000000002', 'sg2@exemple.sn', '{"provider":"email"}', '{}');

insert into public.quests (slug, title, clan, mastery, language, entry_point, est_minutes, xp_reward, kopek_reward, min_seconds, published)
values ('sg-quest', 'SG', 'griot_du_code', 'ndongo', 'python', 'solve', 5, 100, 10, 0, true),
       ('sg-draft', 'SG draft', 'griot_du_code', 'ndongo', 'python', 'solve', 5, 100, 10, 0, false);
insert into public.quest_tests (quest_id, position, name, input, expected)
select id, 2, 'second', '[2]'::jsonb, '2'::jsonb from public.quests where slug = 'sg-quest';
insert into public.quest_tests (quest_id, position, name, input, expected)
select id, 1, 'first', '[1]'::jsonb, '1'::jsonb from public.quests where slug = 'sg-quest';

-- ---- 1. Members cannot reach the grading functions or the old report ------------------------------------------
do $$
declare q uuid; ok boolean;
begin
  select id into q from public.quests where slug = 'sg-quest';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-000000000001', true);
  ok := false;
  begin perform public.record_graded_attempt(auth.uid(), q, 'x', 2, 2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: a member can record a grade'; end if;
  ok := false;
  begin perform public.begin_quest_run(auth.uid(), q);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: a member can start a run'; end if;
  reset role;
  if exists (select 1 from pg_proc where proname = 'submit_quest' and pronamespace = 'public'::regnamespace) then
    raise exception 'FAIL: the old browser report still exists';
  end if;
  set local role anon;
  ok := false;
  begin perform public.begin_quest_run('ee000000-0000-0000-0000-000000000001', q);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: a visitor can start a run'; end if;
  reset role;
  raise notice 'OK 1: only the server can run or grade';
end $$;

-- ---- 2. begin_quest_run: gives tests in order, refuses unfit requests ---------------------------------------
do $$
declare q uuid; d uuid; r jsonb; ok boolean; u1 constant uuid := 'ee000000-0000-0000-0000-000000000001';
begin
  select id into q from public.quests where slug = 'sg-quest';
  select id into d from public.quests where slug = 'sg-draft';

  ok := false;
  begin perform public.begin_quest_run(u1, q); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: run allowed before starting the quest'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform public.start_quest(q);
  reset role;

  set local role service_role;
  r := public.begin_quest_run(u1, q);
  reset role;
  if not (r ->> 'allowed')::boolean then raise exception 'FAIL: run refused: %', r; end if;
  if r ->> 'language' <> 'python' then raise exception 'FAIL: language %', r ->> 'language'; end if;
  if r ->> 'entry_point' <> 'solve' then raise exception 'FAIL: entry point %', r ->> 'entry_point'; end if;
  if jsonb_array_length(r -> 'tests') <> 2 or r -> 'tests' -> 0 ->> 'name' <> 'first' then
    raise exception 'FAIL: tests missing or out of order: %', r -> 'tests';
  end if;

  ok := false;
  begin perform public.begin_quest_run(u1, d); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: run allowed on an unpublished quest'; end if;
  raise notice 'OK 2: run needs a started, published quest and returns the tests in order';
end $$;

-- ---- 3. Run limit: 6 per minute per player, per player ------------------------------------------------------
do $$
declare q uuid; r jsonb; i int; u1 constant uuid := 'ee000000-0000-0000-0000-000000000001'; u2 constant uuid := 'ee000000-0000-0000-0000-000000000002';
begin
  select id into q from public.quests where slug = 'sg-quest';
  -- one run already used above; five more fit
  for i in 1..5 loop
    r := public.begin_quest_run(u1, q);
    if not (r ->> 'allowed')::boolean then raise exception 'FAIL: run % refused too early', i + 1; end if;
  end loop;
  r := public.begin_quest_run(u1, q);
  if (r ->> 'allowed')::boolean or r ->> 'reason' <> 'too_many_runs' then
    raise exception 'FAIL: seventh run in a minute was allowed: %', r;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform public.start_quest(q);
  reset role;
  r := public.begin_quest_run(u2, q);
  if not (r ->> 'allowed')::boolean then raise exception 'FAIL: one player''s limit blocked another'; end if;

  -- older runs stop counting
  update public.quest_runs set ran_at = now() - interval '2 minutes' where user_id = u1;
  r := public.begin_quest_run(u1, q);
  if not (r ->> 'allowed')::boolean then raise exception 'FAIL: runs older than a minute still count'; end if;
  raise notice 'OK 3: run limit per player per minute';
end $$;

-- ---- 4. Grading: partial fails, full pays once, a solved quest can only be practised ---------------------------
do $$
declare q uuid; r jsonb; xp0 bigint; u1 constant uuid := 'ee000000-0000-0000-0000-000000000001'; ok boolean;
begin
  select id into q from public.quests where slug = 'sg-quest';
  select xp into xp0 from public.profiles where id = u1;
  r := public.record_graded_attempt(u1, q, 'half', 1, 2);
  if (r ->> 'solved')::boolean then raise exception 'FAIL: 1 of 2 counted as solved'; end if;
  if (select xp from public.profiles where id = u1) <> xp0 then raise exception 'FAIL: XP paid for a failed run'; end if;
  r := public.record_graded_attempt(u1, q, 'whole', 2, 2);
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: all tests passed but not solved: %', r; end if;
  r := public.record_graded_attempt(u1, q, 'whole', 2, 2);
  if (select xp from public.profiles where id = u1) <> xp0 + 100 then raise exception 'FAIL: paid more than once'; end if;
  r := public.begin_quest_run(u1, q);
  if not (r ->> 'allowed')::boolean or not (r ->> 'practice')::boolean then raise exception 'FAIL: a solved quest is not a practice run: %', r; end if;
  if (select xp from public.profiles where id = u1) <> xp0 + 100 then raise exception 'FAIL: a practice run paid'; end if;
  raise notice 'OK 4: grading pays once and a solved quest can only be practised';
end $$;

-- ---- 5. A code quest with no entry point cannot be run, and the refused request is not counted ---------------------
do $$
declare u2 uuid := 'ee000000-0000-0000-0000-000000000002'; q uuid; ok boolean := false; n_before integer; n_after integer;
begin
  select id into q from public.quests where slug = 'sg-quest';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform public.start_quest(q);
  reset role;
  update public.quests set entry_point = null where id = q;
  select count(*) into n_before from public.quest_runs where user_id = u2;
  set local role service_role;
  begin perform public.begin_quest_run(u2, q); exception when raise_exception then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: a quest without an entry point could be run'; end if;
  select count(*) into n_after from public.quest_runs where user_id = u2;
  if n_after <> n_before then raise exception 'FAIL: the refused request was counted as a run'; end if;
  update public.quests set entry_point = 'solve' where id = q;
  raise notice 'OK 5: no entry point, no run';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------
delete from public.quest_runs where user_id in ('ee000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002');
delete from public.quests where slug in ('sg-quest', 'sg-draft');
delete from auth.users where id in ('ee000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002');

select 'ALL SERVER GRADING TESTS PASSED' as result;
