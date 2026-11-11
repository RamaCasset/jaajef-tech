-- Tests for the reward at the end of a learning path. Run AFTER all migrations.
-- People: ama (1) finishes the path; bou (2) does not.

create schema lrt;
grant usage on schema lrt to public;
create function lrt.uid(p_n int) returns uuid language sql immutable as $$ select ('c7d8e9f0-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function lrt.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', lrt.uid(p_n)::text, true); end $$;
create function lrt.as_anon() returns void language plpgsql as $$
begin set local role anon; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function lrt.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (lrt.uid(1), 'ama-lr@exemple.sn', '{"provider":"email"}', '{}'),
  (lrt.uid(2), 'bou-lr@exemple.sn', '{"provider":"email"}', '{}');

insert into public.learning_paths (id, slug, clan, title, published) values
  ('c7d8e9f0-bbbb-0000-0000-000000000001', 'lr-griot', 'griot_du_code', 'Griot', true),
  ('c7d8e9f0-bbbb-0000-0000-000000000002', 'lr-vide', 'forgeron', 'Vide', true),
  ('c7d8e9f0-bbbb-0000-0000-000000000003', 'lr-brouillon', 'saltigue', 'Brouillon', false);
insert into public.learning_steps (id, path_id, position, title, lesson_md) values
  ('c7d8e9f0-cccc-0000-0000-000000000001', 'c7d8e9f0-bbbb-0000-0000-000000000001', 1, 'Un', 'a'),
  ('c7d8e9f0-cccc-0000-0000-000000000002', 'c7d8e9f0-bbbb-0000-0000-000000000001', 2, 'Deux', 'b'),
  ('c7d8e9f0-cccc-0000-0000-000000000003', 'c7d8e9f0-bbbb-0000-0000-000000000003', 1, 'Cache', 'c');

do $$
declare
  s1 uuid := 'c7d8e9f0-cccc-0000-0000-000000000001';
  s2 uuid := 'c7d8e9f0-cccc-0000-0000-000000000002';
  r record; k0 bigint; x0 integer; e text;
begin
  -- 1. Not finished: no reward.
  perform lrt.as_user(1);
  perform public.mark_step_read(s1);
  select * into r from public.learning_path_reward_state('lr-griot');
  if r.complete or r.claimed then raise exception 'FAIL: half a path is not complete'; end if;
  if r.xp <> 200 or r.kopeks <> 100 then raise exception 'FAIL: the reward amounts come from the settings'; end if;
  e := lrt.error_of($q$select * from public.claim_learning_path_reward('lr-griot')$q$);
  if e is null or e not like '%path_not_finished%' then raise exception 'FAIL: claiming early should be refused, got %', e; end if;
  reset role;
  raise notice 'OK 1: a half-finished path cannot be claimed';

  -- 2. Finished: claim once, paid once.
  select xp into x0 from public.profiles where id = lrt.uid(1);
  select kopeks into k0 from public.wallets where user_id = lrt.uid(1);
  perform lrt.as_user(1);
  perform public.mark_step_read(s2);
  select * into r from public.learning_path_reward_state('lr-griot');
  if not r.complete or r.claimed then raise exception 'FAIL: finished, not claimed yet'; end if;
  select * into r from public.claim_learning_path_reward('lr-griot');
  if not r.granted then raise exception 'FAIL: the first claim pays'; end if;
  select * into r from public.claim_learning_path_reward('lr-griot');
  if r.granted then raise exception 'FAIL: the second claim does not pay again'; end if;
  select * into r from public.learning_path_reward_state('lr-griot');
  if not r.claimed then raise exception 'FAIL: it shows as claimed'; end if;
  reset role;
  if (select xp from public.profiles where id = lrt.uid(1)) <> x0 + 200 then raise exception 'FAIL: XP paid once'; end if;
  if (select kopeks from public.wallets where user_id = lrt.uid(1)) <> k0 + 100 then raise exception 'FAIL: Kopeks paid once'; end if;
  raise notice 'OK 2: a finished path pays XP and Kopeks exactly once';

  -- 3. Others, empty and draft paths, visitors.
  perform lrt.as_user(2);
  select * into r from public.learning_path_reward_state('lr-griot');
  if r.complete or r.claimed then raise exception 'FAIL: bou has not finished'; end if;
  e := lrt.error_of($q$select * from public.claim_learning_path_reward('lr-vide')$q$);
  if e is null or e not like '%path_not_finished%' then raise exception 'FAIL: an empty path pays nothing, got %', e; end if;
  e := lrt.error_of($q$select * from public.claim_learning_path_reward('lr-brouillon')$q$);
  if e is null or e not like '%path_not_found%' then raise exception 'FAIL: a draft path cannot be claimed, got %', e; end if;
  reset role;
  perform lrt.as_anon();
  e := lrt.error_of($q$select * from public.claim_learning_path_reward('lr-griot')$q$);
  if e is null or e not like '%permission denied%' then raise exception 'FAIL: visitors cannot claim, got %', e; end if;
  reset role;
  raise notice 'OK 3: only a member who finished a published path can claim';
end $$;

delete from public.learning_path_rewards where user_id::text like 'c7d8e9f0-%';
delete from public.xp_events where user_id::text like 'c7d8e9f0-%';
delete from public.kopek_transactions where user_id::text like 'c7d8e9f0-%';
delete from public.learning_paths where id::text like 'c7d8e9f0-%';
delete from public.profiles where id::text like 'c7d8e9f0-%';
delete from auth.users where id::text like 'c7d8e9f0-%';
drop schema lrt cascade;

do $$
begin
  if exists (select 1 from public.learning_path_rewards) or exists (select 1 from public.learning_paths) then raise exception 'FAIL: data left behind'; end if;
  raise notice 'OK 4: the test left nothing behind';
end $$;

select 'ALL LEARNING PATH REWARD TESTS PASSED' as result;
