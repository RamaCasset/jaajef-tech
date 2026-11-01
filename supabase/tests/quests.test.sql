-- Tests for migration 2 (quests). Run AFTER migrations 1 and 2.
-- psql -v ON_ERROR_STOP=1 -f quests.test.sql
-- Each rewarded step is its own DO block on purpose: the server measures time
-- with now(), which is frozen inside a single transaction.

-- ---- Setup (as the database owner) ----------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'solver@exemple.sn', '{"provider":"email"}', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@exemple.sn', '{"provider":"email"}', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'idle@exemple.sn', '{"provider":"email"}', '{}');

-- Two extra published quests that pay instantly (min_seconds = 0), used for streak tests
insert into public.quests (slug, title, clan, mastery, kind, language, est_minutes, xp_reward, kopek_reward, min_seconds, published)
values
  ('test-quest-2', 'Test 2', 'griot_du_code', 'ndongo', 'code', 'javascript', 5, 100, 10, 0, true),
  ('test-quest-3', 'Test 3', 'griot_du_code', 'ndongo', 'code', 'javascript', 5, 100, 10, 0, true);
insert into public.quest_tests (quest_id, name, input, expected)
select id, 'only_test', '[1]'::jsonb, '1'::jsonb from public.quests where slug in ('test-quest-2', 'test-quest-3');

-- ---- 1. Visibility: published only -----------------------------------
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.quests;
  if n <> 3 then raise exception 'FAIL: anon sees % quests (expected 3 published)', n; end if;
  if exists (select 1 from public.quests where slug = 'un-peu-de-code-beaucoup-de-racines') then
    raise exception 'FAIL: a draft quest is visible';
  end if;
  select count(*) into n from public.quest_tests t join public.quests q on q.id = t.quest_id
   where q.slug = 'la-malediction-du-loop';
  if n <> 4 then raise exception 'FAIL: expected 4 tests, anon sees %', n; end if;
  select count(*) into n from public.quest_tests t join public.quests q on q.id = t.quest_id
   where q.slug = 'le-gardien-des-mots-de-passe';
  if n <> 0 then raise exception 'FAIL: tests of a draft quest are visible'; end if;
  reset role;
  raise notice 'OK 1: only published quests and their tests are public';
end $$;

-- ---- 2. Members cannot write quest tables directly ---------------------
do $$
declare ok boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);

  ok := false;
  begin
    insert into public.quest_attempts (user_id, quest_id, status, tests_passed, tests_total)
    select 'bbbbbbbb-0000-0000-0000-000000000001', id, 'solved', 4, 4 from public.quests limit 1;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member inserted an attempt directly'; end if;

  ok := false;
  begin
    update public.quests set xp_reward = 999999;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member edited a quest'; end if;

  ok := false;
  begin
    insert into public.quests (slug, title, clan, mastery, est_minutes, xp_reward, language)
    values ('my-own-quest', 'x', 'forgeron', 'ndongo', 5, 5, 'python');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member created a quest'; end if;

  ok := false;
  begin
    perform public.bump_streak('bbbbbbbb-0000-0000-0000-000000000001');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member called bump_streak'; end if;
  reset role;

  set local role anon;
  ok := false;
  begin
    perform public.start_quest((select id from public.quests where slug = 'la-malediction-du-loop'));
  exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: anonymous visitor called start_quest'; end if;
  raise notice 'OK 2: no direct writes, no streak tampering, visitors cannot start quests';
end $$;

-- ---- 3. Starting a quest -----------------------------------------------
do $$
declare q uuid; r1 jsonb; r2 jsonb; ok boolean := false;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  r1 := public.start_quest(q);
  r2 := public.start_quest(q);
  if r1 ->> 'status' <> 'in_progress' then raise exception 'FAIL: status %', r1 ->> 'status'; end if;
  if r1 ->> 'started_at' <> r2 ->> 'started_at' then raise exception 'FAIL: restarting reset the clock'; end if;

  begin
    perform public.start_quest((select id from public.quests where slug = 'le-gardien-des-mots-de-passe'));
  exception when raise_exception then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: a draft quest could be started'; end if;
  raise notice 'OK 3: quest starts once, clock not reset, drafts refused';
end $$;

-- ---- 4. Failing tests pays nothing ---------------------------------------
do $$
declare q uuid; r jsonb; xp0 bigint;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  select xp into xp0 from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);

  r := public.submit_quest(q, 'partial', 3, 4);
  if (r ->> 'solved')::boolean then raise exception 'FAIL: 3 of 4 tests counted as solved'; end if;
  if r ->> 'reason' <> 'tests_not_passed' then raise exception 'FAIL: reason %', r ->> 'reason'; end if;

  -- a report that does not cover every test is refused too
  r := public.submit_quest(q, 'sneaky', 1, 1);
  if (r ->> 'solved')::boolean then raise exception 'FAIL: partial report counted as solved'; end if;
  reset role;

  if (select xp from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000001') <> xp0 then
    raise exception 'FAIL: XP changed without solving';
  end if;
  raise notice 'OK 4: failing or partial test reports pay nothing';
end $$;

-- ---- 5. Solving instantly is refused (server clock) ---------------------
do $$
declare q uuid; r jsonb;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  r := public.submit_quest(q, 'cheat', 4, 4);
  reset role;
  if (r ->> 'solved')::boolean then raise exception 'FAIL: instant solve accepted'; end if;
  if r ->> 'reason' <> 'too_fast' then raise exception 'FAIL: reason %', r ->> 'reason'; end if;
  raise notice 'OK 5: an implausibly fast solve is refused';
end $$;

-- ---- 6. A real solve pays once -------------------------------------------
-- pretend the member started two minutes ago
update public.quest_attempts set started_at = now() - interval '2 minutes'
 where user_id = 'bbbbbbbb-0000-0000-0000-000000000001'
   and quest_id = (select id from public.quests where slug = 'la-malediction-du-loop');

do $$
declare q uuid; r jsonb; p record; w bigint; n int;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  r := public.submit_quest(q, 'solution', 4, 4);
  reset role;

  if not (r ->> 'solved')::boolean then raise exception 'FAIL: valid solve refused: %', r; end if;
  if (r ->> 'xp')::int <> 250 or (r ->> 'kopeks')::int <> 50 then raise exception 'FAIL: reward %', r; end if;
  if (r ->> 'duration_ms')::int not between 119000 and 130000 then
    raise exception 'FAIL: duration %', r ->> 'duration_ms';
  end if;
  if (r ->> 'streak_days')::int <> 1 then raise exception 'FAIL: streak %', r ->> 'streak_days'; end if;

  select * into p from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select kopeks into w from public.wallets where user_id = p.id;
  if p.xp <> 250 then raise exception 'FAIL: xp %', p.xp; end if;
  if w <> 150 then raise exception 'FAIL: wallet % (100 welcome + 50)', w; end if;
  select count(*) into n from public.kopek_transactions where user_id = p.id and reason = 'quest_solved';
  if n <> 1 then raise exception 'FAIL: % ledger rows', n; end if;
  raise notice 'OK 6: solve pays 250 XP and 50 Kopeks, server-measured time, streak starts';
end $$;

-- ---- 7. Submitting again pays nothing more ---------------------------------
do $$
declare q uuid; r jsonb;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  r := public.submit_quest(q, 'again', 4, 4);
  r := public.submit_quest(q, 'and again', 4, 4);
  reset role;
  if not (r ->> 'already_solved')::boolean then raise exception 'FAIL: not flagged already solved'; end if;
  if (select xp from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000001') <> 250 then
    raise exception 'FAIL: replay paid again';
  end if;
  if (select count(*) from public.kopek_transactions
       where user_id = 'bbbbbbbb-0000-0000-0000-000000000001' and reason = 'quest_solved') <> 1 then
    raise exception 'FAIL: replay wrote another ledger row';
  end if;
  raise notice 'OK 7: replays pay nothing';
end $$;

-- ---- 8. Streak chest on day 7 --------------------------------------------
update public.profiles set streak_days = 6, last_active_on = current_date - 1
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

do $$
declare q uuid; r jsonb; w bigint; n int;
begin
  select id into q from public.quests where slug = 'test-quest-2';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  perform public.start_quest(q);
  r := public.submit_quest(q, 'x', 1, 1);
  reset role;
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: quest 2 not solved: %', r; end if;
  if (r ->> 'streak_days')::int <> 7 then raise exception 'FAIL: streak %', r ->> 'streak_days'; end if;

  select kopeks into w from public.wallets where user_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if w <> 260 then raise exception 'FAIL: wallet % (150 + 10 reward + 100 chest)', w; end if;
  select count(*) into n from public.kopek_transactions
   where user_id = 'bbbbbbbb-0000-0000-0000-000000000001' and reason = 'streak_chest';
  if n <> 1 then raise exception 'FAIL: % streak chests', n; end if;
  raise notice 'OK 8: day-7 streak pays the chest once';
end $$;

-- A second solve the same day does not add a day or a second chest
do $$
declare q uuid; r jsonb;
begin
  select id into q from public.quests where slug = 'test-quest-3';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000001', true);
  perform public.start_quest(q);
  r := public.submit_quest(q, 'x', 1, 1);
  reset role;
  if (r ->> 'streak_days')::int <> 7 then raise exception 'FAIL: same-day streak %', r ->> 'streak_days'; end if;
  if (select count(*) from public.kopek_transactions
       where user_id = 'bbbbbbbb-0000-0000-0000-000000000001' and reason = 'streak_chest') <> 1 then
    raise exception 'FAIL: second chest paid the same day';
  end if;
  raise notice 'OK 8b: same-day solve does not extend the streak or pay a second chest';
end $$;

-- ---- 9. A missed day resets the streak -------------------------------------
update public.profiles set streak_days = 5, last_active_on = current_date - 3
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

do $$
declare q uuid; r jsonb;
begin
  select id into q from public.quests where slug = 'test-quest-2';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  perform public.start_quest(q);
  r := public.submit_quest(q, 'x', 1, 1);
  reset role;
  if (r ->> 'streak_days')::int <> 1 then raise exception 'FAIL: streak after a gap %', r ->> 'streak_days'; end if;
  raise notice 'OK 9: a gap resets the streak to 1';
end $$;

-- ---- 10. Leaderboards ----------------------------------------------------
do $$
declare q uuid; s uuid; n int; r record;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  select id into s from public.seasons where slug = 'saison-04';

  set local role anon;
  select count(*) into n from public.quest_leaderboard(q);
  if n <> 1 then raise exception 'FAIL: quest leaderboard rows %', n; end if;
  select * into r from public.quest_leaderboard(q) limit 1;
  if r.rank <> 1 or r.username <> 'solver' then raise exception 'FAIL: leaderboard %', r; end if;

  select * into r from public.season_leaderboard(s) limit 1;
  if r.username <> 'solver' or r.points <> 250 or r.quests_solved <> 1 then
    raise exception 'FAIL: season board %', r;
  end if;
  reset role;
  raise notice 'OK 10: quest and season leaderboards work and are public';
end $$;

-- ---- 11. Attempts are private; saving progress works ------------------------
do $$
declare q uuid; n int; ok boolean := false;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);

  -- member 2 sees only their own attempts
  if exists (select 1 from public.quest_attempts where user_id = 'bbbbbbbb-0000-0000-0000-000000000001') then
    raise exception 'FAIL: member sees another member''s attempt';
  end if;

  perform public.start_quest(q);
  perform public.save_attempt(q, 'partial code', 3);
  perform public.save_attempt(q, 'more code', 99);   -- clamped to the number of tests
  select tests_passed into n from public.quest_attempts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and quest_id = q;
  if n <> 4 then raise exception 'FAIL: progress not clamped to 4, got %', n; end if;
  if (select code from public.quest_attempts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and quest_id = q) <> 'more code' then
    raise exception 'FAIL: code not saved';
  end if;

  -- cannot save to a quest that was solved (member 2 solved test-quest-2)
  begin
    perform public.save_attempt((select id from public.quests where slug = 'test-quest-2'), 'x', 1);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: saved progress on a solved quest'; end if;
  reset role;
  raise notice 'OK 11: attempts are private, progress saves and is clamped';
end $$;

-- ---- 12. Input limits and order of steps -----------------------------------
do $$
declare q uuid; ok boolean;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;

  -- never started this quest
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000003', true);
  ok := false;
  begin perform public.submit_quest(q, 'x', 4, 4);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: submit without starting was accepted'; end if;

  -- oversized code
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  ok := false;
  begin perform public.submit_quest(q, repeat('x', 50001), 4, 4);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: oversized code accepted'; end if;
  reset role;
  raise notice 'OK 12: must start first, oversized code refused';
end $$;

select 'ALL QUEST TESTS PASSED' as result;
