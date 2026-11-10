-- Tests for learning paths. Run AFTER all migrations.
-- People: ama (1) and bou (2), both members.

create schema lpt;
grant usage on schema lpt to public;
create function lpt.uid(p_n int) returns uuid language sql immutable as $$ select ('c5d6e7f8-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function lpt.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', lpt.uid(p_n)::text, true); end $$;
create function lpt.as_anon() returns void language plpgsql as $$
begin set local role anon; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function lpt.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (lpt.uid(1), 'ama-lp@exemple.sn', '{"provider":"email"}', '{}'),
  (lpt.uid(2), 'bou-lp@exemple.sn', '{"provider":"email"}', '{}');

insert into public.quests (id, slug, title, clan, mastery, language, est_minutes, xp_reward, published) values
  ('c5d6e7f8-aaaa-0000-0000-000000000001', 'lp-quete-un', 'Quete un', 'griot_du_code', 'ndongo', 'python', 10, 100, true);

insert into public.learning_paths (id, slug, clan, title, summary, published) values
  ('c5d6e7f8-bbbb-0000-0000-000000000001', 'lp-griot', 'griot_du_code', 'Griot', 'Un parcours', true),
  ('c5d6e7f8-bbbb-0000-0000-000000000002', 'lp-brouillon', 'forgeron', 'Brouillon', null, false);
insert into public.learning_steps (id, path_id, position, title, lesson_md, quest_id) values
  ('c5d6e7f8-cccc-0000-0000-000000000001', 'c5d6e7f8-bbbb-0000-0000-000000000001', 1, 'Lire', '# Bienvenue', null),
  ('c5d6e7f8-cccc-0000-0000-000000000002', 'c5d6e7f8-bbbb-0000-0000-000000000001', 2, 'Pratiquer', '# Une boucle', 'c5d6e7f8-aaaa-0000-0000-000000000001'),
  ('c5d6e7f8-cccc-0000-0000-000000000003', 'c5d6e7f8-bbbb-0000-0000-000000000002', 1, 'Cache', 'secret', null);

do $$
declare
  s1 uuid := 'c5d6e7f8-cccc-0000-0000-000000000001';
  s2 uuid := 'c5d6e7f8-cccc-0000-0000-000000000002';
  s3 uuid := 'c5d6e7f8-cccc-0000-0000-000000000003';
  q uuid := 'c5d6e7f8-aaaa-0000-0000-000000000001';
  r record; n int; e text;
begin
  -- 1. A member sees the published path with 0 of 2 done, and not the draft.
  perform lpt.as_user(1);
  select count(*) into n from public.list_learning_paths() where slug = 'lp-brouillon';
  select * into r from public.list_learning_paths() where slug = 'lp-griot';
  reset role;
  if n <> 0 then raise exception 'FAIL: a draft path is listed'; end if;
  if r.steps_total <> 2 or r.steps_done <> 0 then raise exception 'FAIL: expected 0 of 2, got % of %', r.steps_done, r.steps_total; end if;
  raise notice 'OK 1: published path listed with progress, draft hidden';

  -- 2. Steps come in order with the quest details.
  perform lpt.as_user(1);
  select * into r from public.list_learning_steps('lp-griot') where step_no = 2;
  reset role;
  if r.quest_slug <> 'lp-quete-un' or r.quest_xp <> 100 or r.done then raise exception 'FAIL: step 2 details wrong'; end if;
  raise notice 'OK 2: steps carry their quest';

  -- 3. Reading a lesson without a quest finishes that step, for me only.
  perform lpt.as_user(1);
  perform public.mark_step_read(s1);
  perform public.mark_step_read(s1);
  select * into r from public.list_learning_paths() where slug = 'lp-griot';
  reset role;
  if r.steps_done <> 1 then raise exception 'FAIL: reading should finish step 1, got %', r.steps_done; end if;
  perform lpt.as_user(2);
  select * into r from public.list_learning_paths() where slug = 'lp-griot';
  reset role;
  if r.steps_done <> 0 then raise exception 'FAIL: bou should not see ama progress'; end if;
  raise notice 'OK 3: reading finishes a lesson-only step, privately';

  -- 4. Reading a step that has a quest does not finish it; solving the quest does.
  perform lpt.as_user(1);
  perform public.mark_step_read(s2);
  select * into r from public.list_learning_steps('lp-griot') where step_no = 2;
  reset role;
  if r.done then raise exception 'FAIL: reading must not finish a quest step'; end if;
  insert into public.quest_attempts (user_id, quest_id, status, solved_at) values (lpt.uid(1), q, 'solved', now());
  perform lpt.as_user(1);
  select * into r from public.list_learning_steps('lp-griot') where step_no = 2;
  reset role;
  if not r.done or r.quest_status <> 'solved' then raise exception 'FAIL: solving the quest should finish the step'; end if;
  raise notice 'OK 4: a quest step is finished by solving the quest';

  -- 5. A draft step cannot be marked read; visitors get nothing.
  perform lpt.as_user(1);
  e := lpt.error_of('select public.mark_step_read(''' || s3 || ''')');
  reset role;
  if e is distinct from 'step_not_found' then raise exception 'FAIL: draft step accepted (%)', e; end if;
  perform lpt.as_anon();
  e := lpt.error_of('select * from public.list_learning_paths()');
  reset role;
  if e is null then raise exception 'FAIL: visitor can list paths'; end if;
  raise notice 'OK 5: drafts and visitors are kept out';

  -- 6. Nobody can write straight into the tables.
  perform lpt.as_user(1);
  e := lpt.error_of('insert into public.learning_reads (user_id, step_id) values (lpt.uid(1), ''' || s2 || ''')');
  reset role;
  if e is null then raise exception 'FAIL: direct write into learning_reads allowed'; end if;
  perform lpt.as_user(1);
  e := lpt.error_of('update public.learning_paths set title = ''x''');
  reset role;
  if e is null then raise exception 'FAIL: direct write into learning_paths allowed'; end if;
  raise notice 'OK 6: no direct writes';
end $$;

-- Clean up.
delete from public.quest_attempts where user_id in (lpt.uid(1), lpt.uid(2));
delete from public.learning_paths where id::text like 'c5d6e7f8-%';
delete from public.quests where id::text like 'c5d6e7f8-%';
delete from auth.users where id in (lpt.uid(1), lpt.uid(2));
drop schema lpt cascade;
