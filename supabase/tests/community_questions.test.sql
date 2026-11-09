-- Tests for questions that belong to a community. Run AFTER all migrations.
-- People: rama (1) owns both communities; sala (2) is a member of the public one; tida (3) is not a member of any.

create schema cqt;
grant usage on schema cqt to public;
create function cqt.uid(p_n int) returns uuid language sql immutable as $$ select ('d1e2f3a4-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function cqt.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', cqt.uid(p_n)::text, true); end $$;
create function cqt.as_anon() returns void language plpgsql as $$
begin set local role anon; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function cqt.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function cqt.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := cqt.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (cqt.uid(1), 'rama-cq@exemple.sn', '{"provider":"email"}', '{}'),
  (cqt.uid(2), 'sala-cq@exemple.sn', '{"provider":"email"}', '{}'),
  (cqt.uid(3), 'tida-cq@exemple.sn', '{"provider":"email"}', '{}');

insert into public.communities (id, slug, name, is_private, owner_id) values
  ('d1e2f3a4-aaaa-0000-0000-000000000001', 'cq-publique', 'Communauté publique', false, cqt.uid(1)),
  ('d1e2f3a4-aaaa-0000-0000-000000000002', 'cq-privee', 'Communauté privée', true, cqt.uid(1));
insert into public.community_members (community_id, user_id, role) values
  ('d1e2f3a4-aaaa-0000-0000-000000000001', cqt.uid(1), 'owner'),
  ('d1e2f3a4-aaaa-0000-0000-000000000002', cqt.uid(1), 'owner'),
  ('d1e2f3a4-aaaa-0000-0000-000000000001', cqt.uid(2), 'member');

do $$
declare
  pub uuid := 'd1e2f3a4-aaaa-0000-0000-000000000001';
  prv uuid := 'd1e2f3a4-aaaa-0000-0000-000000000002';
  q_city uuid; q_pub uuid; q_prv uuid; n int; a bigint;
begin
  -- 1. Asking in a community needs to be a member of it; a question for the whole City needs nothing
  perform cqt.as_user(3);
  perform cqt.must_fail('asking in a community you are not in', format($q$select public.ask_question('Un titre assez long', 'Un texte assez long pour passer', '{}', %L)$q$, pub), 'must be a member');
  q_city := public.ask_question('Question pour toute la Cité ?', 'Un texte assez long pour passer', '{}');
  perform cqt.as_user(2);
  q_pub := public.ask_question('Question de la communauté publique', 'Un texte assez long pour passer', '{}', pub);
  perform cqt.must_fail('asking in a private community you are not in', format($q$select public.ask_question('Un titre assez long', 'Un texte assez long pour passer', '{}', %L)$q$, prv), 'must be a member');
  perform cqt.as_user(1);
  q_prv := public.ask_question('Question de la communauté privée', 'Un texte assez long pour passer', '{}', prv);
  reset role;
  raise notice 'OK 1: only members ask inside a community';

  -- 2. The big list: City questions and public-community questions for everyone, private ones only for members
  perform cqt.as_anon();
  select count(*) into n from public.list_questions() where id in (q_city, q_pub, q_prv);
  if n <> 2 then raise exception 'FAIL: a visitor sees % of the 3 (expected 2)', n; end if;
  if exists (select 1 from public.list_questions() where id = q_prv) then raise exception 'FAIL: a visitor sees a private question'; end if;
  perform cqt.as_user(3);
  if exists (select 1 from public.list_questions() where id = q_prv) then raise exception 'FAIL: an outsider sees a private question'; end if;
  perform cqt.as_user(1);
  if not exists (select 1 from public.list_questions() where id = q_prv) then raise exception 'FAIL: a member does not see the private question'; end if;
  if (select community_name from public.list_questions() where id = q_pub) <> 'Communauté publique' then raise exception 'FAIL: the community name is missing'; end if;
  reset role;
  raise notice 'OK 2: private questions stay with their members';

  -- 3. The room of one community lists only its own questions
  perform cqt.as_user(2);
  select count(*) into n from public.list_questions(p_community => pub);
  if n <> 1 or not exists (select 1 from public.list_questions(p_community => pub) where id = q_pub) then raise exception 'FAIL: the public room shows % questions', n; end if;
  select count(*) into n from public.list_questions(p_community => prv);
  if n <> 0 then raise exception 'FAIL: a non-member sees the private room (% questions)', n; end if;
  reset role;
  raise notice 'OK 3: a community room shows its own questions';

  -- 4. Reading, answering and voting on a private question: members only
  perform cqt.as_user(3);
  if exists (select 1 from public.get_question(q_prv)) then raise exception 'FAIL: an outsider reads a private question'; end if;
  perform cqt.must_fail('answering a private question', format($q$select public.post_answer(%L, 'Une réponse')$q$, q_prv), 'does not exist');
  perform cqt.must_fail('voting a private question', format($q$select public.vote_question(%L)$q$, q_prv), 'does not exist');
  perform cqt.as_user(1);
  a := public.post_answer(q_prv, 'Une réponse du propriétaire');
  if (select count(*) from public.list_answers(q_prv)) <> 1 then raise exception 'FAIL: a member does not see the answer'; end if;
  perform cqt.as_user(3);
  if exists (select 1 from public.list_answers(q_prv)) then raise exception 'FAIL: an outsider reads the answers of a private question'; end if;
  perform cqt.must_fail('voting an answer of a private question', format($q$select public.vote_answer(%L)$q$, a), 'does not exist');
  -- ... while a public question takes answers from anyone signed in
  perform public.post_answer(q_pub, 'Une réponse venue de dehors');
  reset role;
  raise notice 'OK 4: private questions are closed to outsiders';

  -- 5. Deleting the community deletes its questions
  delete from public.communities where id = prv;
  if exists (select 1 from public.questions where id = q_prv) then raise exception 'FAIL: the question of a deleted community stayed'; end if;
  raise notice 'OK 5: questions leave with their community';

  -- clean up, so other tests that count questions are not disturbed
  delete from public.questions where id in (q_city, q_pub);
  delete from public.communities where id = pub;
  delete from public.notifications where user_id in (cqt.uid(1), cqt.uid(2), cqt.uid(3));
end $$;

drop schema cqt cascade;
