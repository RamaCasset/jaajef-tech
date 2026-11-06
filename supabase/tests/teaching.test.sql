-- Tests for migration 3 (teaching: hints, explanations, order, languages).
-- Run AFTER migrations 1, 2 and 3. psql -v ON_ERROR_STOP=1 -f teaching.test.sql
-- Steps that depend on the server clock are separate DO blocks on purpose:
-- now() is frozen inside one transaction.
-- Stand-in for the old browser report: players can no longer call submit_quest, so the tests grade
-- through the server-only function, as the server would, for the signed-in test player.
create schema if not exists tg;
create or replace function tg.submit_quest(p_quest uuid, p_code text, p_passed integer, p_total integer)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public.record_graded_attempt(auth.uid(), p_quest, p_code, p_passed, p_total); end $$;
grant usage on schema tg to authenticated, anon, service_role;
grant execute on function tg.submit_quest(uuid, text, integer, integer) to authenticated, anon, service_role;



insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'learner-a@exemple.sn', '{"provider":"email"}', '{}'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'learner-b@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Sample lesson is loaded ----------------------------------------
do $$
declare q record;
begin
  select * into q from public.quests where slug = 'la-malediction-du-loop';
  if q.position <> 1 or q.topic <> 'Boucles et ensembles' then raise exception 'FAIL: order or topic missing'; end if;
  if (select count(*) from public.quest_hints where quest_id = q.id) <> 3 then raise exception 'FAIL: expected 3 hints'; end if;
  if (select count(*) from public.quest_explanations where quest_id = q.id) <> 1 then raise exception 'FAIL: explanation missing'; end if;
  raise notice 'OK 1: sample lesson has an order, a topic, 3 hints and an explanation';
end $$;

-- ---- 2. Hints and explanations are not public ----------------------------
do $$
declare ok boolean;
begin
  set local role anon;
  ok := false;
  begin perform count(*) from public.quest_hints;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: anon can read hints'; end if;

  ok := false;
  begin perform count(*) from public.quest_explanations;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: anon can read explanations'; end if;

  ok := false;
  begin perform public.use_hint((select id from public.quests where slug = 'la-malediction-du-loop'));
  exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: anon called use_hint'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', true);
  ok := false;
  begin perform count(*) from public.quest_hints;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: a member can read the hints table directly'; end if;
  reset role;
  raise notice 'OK 2: hints and explanations are closed to visitors and to direct reads';
end $$;

-- ---- 3. Hints come one at a time, in order -----------------------------------
do $$
declare q uuid; ok boolean := false;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);

  -- cannot ask for a hint before starting
  begin perform public.use_hint(q);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: hint given before starting the quest'; end if;

  perform public.start_quest(q);
  reset role;
end $$;

do $$
declare q uuid; r jsonb;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);

  r := public.use_hint(q);
  if (r ->> 'level')::int <> 1 or (r ->> 'hints_used')::int <> 1 or (r ->> 'hints_total')::int <> 3 then
    raise exception 'FAIL: first hint %', r;
  end if;
  r := public.use_hint(q);
  if (r ->> 'level')::int <> 2 then raise exception 'FAIL: second hint %', r; end if;
  r := public.use_hint(q);
  if (r ->> 'level')::int <> 3 then raise exception 'FAIL: third hint %', r; end if;
  r := public.use_hint(q);
  if not (r ->> 'no_more_hints')::boolean then raise exception 'FAIL: a 4th hint appeared %', r; end if;
  if (r ->> 'hints_used')::int <> 3 then raise exception 'FAIL: hints_used should stay 3, got %', r ->> 'hints_used'; end if;
  reset role;
  raise notice 'OK 3: hints come in order, 3 in total, then no more';
end $$;

-- ---- 4. A member sees only the hints they unlocked ----------------------------
do $$
declare q uuid; n int;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;

  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  select count(*) into n from public.get_unlocked_hints(q);
  if n <> 3 then raise exception 'FAIL: A should see 3 unlocked hints, saw %', n; end if;

  -- B has not started: sees nothing
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', true);
  select count(*) into n from public.get_unlocked_hints(q);
  if n <> 0 then raise exception 'FAIL: B saw % hints without starting', n; end if;

  perform public.start_quest(q);
  select count(*) into n from public.get_unlocked_hints(q);
  if n <> 0 then raise exception 'FAIL: B saw % hints without asking', n; end if;

  perform public.use_hint(q);
  select count(*) into n from public.get_unlocked_hints(q);
  if n <> 1 then raise exception 'FAIL: B should see exactly 1 hint, saw %', n; end if;
  reset role;
  raise notice 'OK 4: members see only the hints they unlocked themselves';
end $$;

-- ---- 5. Hint count cannot be reset by the member ------------------------------
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  begin update public.quest_attempts set hints_used = 0;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: member could reset their hint count'; end if;
  raise notice 'OK 5: hint count cannot be tampered with';
end $$;

-- ---- 6. Explanation stays locked until solved ----------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  select count(*) into n from public.quest_explanations;
  if n <> 0 then raise exception 'FAIL: A read the explanation before solving'; end if;
  reset role;
  raise notice 'OK 6: explanation is locked before solving';
end $$;

-- A pretends to have started two minutes ago, then solves
update public.quest_attempts set started_at = now() - interval '2 minutes'
 where user_id = 'eeeeeeee-0000-0000-0000-000000000001';

do $$
declare q uuid; r jsonb; n int; ok boolean := false;
begin
  select id into q from public.quests where slug = 'la-malediction-du-loop';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  r := tg.submit_quest(q, 'solution', 4, 4);
  if not (r ->> 'solved')::boolean then raise exception 'FAIL: solve refused %', r; end if;
  if (r ->> 'hints_used')::int <> 3 then raise exception 'FAIL: hints_used in result %', r; end if;

  -- now the explanation opens for A
  select count(*) into n from public.quest_explanations;
  if n <> 1 then raise exception 'FAIL: explanation did not open after solving'; end if;

  -- no more hints once solved
  begin perform public.use_hint(q);
  exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: hint given after solving'; end if;

  -- B has not solved: still locked
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', true);
  select count(*) into n from public.quest_explanations;
  reset role;
  if n <> 0 then raise exception 'FAIL: B read an explanation without solving'; end if;
  raise notice 'OK 7: explanation opens only for the member who solved; hints stop after solving';
end $$;

-- ---- 8. Structure rules -----------------------------------------------------------
do $$
declare ok boolean;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'quests' and column_name = 'kind') then
    raise exception 'FAIL: the kind column still exists';
  end if;

  -- a language is required
  ok := false;
  begin
    insert into public.quests (slug, title, clan, mastery, est_minutes, xp_reward)
    values ('no-language', 'x', 'forgeron', 'ndongo', 5, 5);
  exception when not_null_violation then ok := true; end;
  if not ok then raise exception 'FAIL: a quest without a language was accepted'; end if;

  -- html_css is allowed, other languages are not
  insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward)
  values ('css-ok', 'x', 'forgeron', 'ndongo', 'html_css', 5, 5);
  ok := false;
  begin
    insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward)
    values ('cobol-no', 'x', 'forgeron', 'ndongo', 'cobol', 5, 5);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: an unsupported language was accepted'; end if;

  -- position must be positive
  ok := false;
  begin update public.quests set position = 0 where slug = 'css-ok';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: position 0 accepted'; end if;

  -- the two former design quests are now coding quests
  if (select count(*) from public.quests where slug in ('un-car-rapide-haut-en-couleur', 'le-petit-atelier-du-souk')
                                          and language = 'html_css') <> 2 then
    raise exception 'FAIL: design quests were not converted to html_css';
  end if;
  raise notice 'OK 8: every quest needs a supported language; the design quests are now HTML and CSS';
end $$;

select 'ALL TEACHING TESTS PASSED' as result;
