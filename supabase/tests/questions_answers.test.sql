-- Tests for questions and answers. Run AFTER all migrations.
-- People: mor (1) asks; nafi (2) and oumy (3) answer; pape (4) only reads.

create schema qat;
grant usage on schema qat to public;
create function qat.uid(p_n int) returns uuid language sql immutable as $$ select ('a3b4c5d6-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function qat.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', qat.uid(p_n)::text, true); end $$;
create function qat.as_anon() returns void language plpgsql as $$
begin set local role anon; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function qat.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function qat.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := qat.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (qat.uid(1), 'mor-qa@exemple.sn', '{"provider":"email"}', '{}'),
  (qat.uid(2), 'nafi-qa@exemple.sn', '{"provider":"email"}', '{}'),
  (qat.uid(3), 'oumy-qa@exemple.sn', '{"provider":"email"}', '{}'),
  (qat.uid(4), 'pape-qa@exemple.sn', '{"provider":"email"}', '{}');

do $$
declare q uuid; a1 bigint; a2 bigint; a3 bigint; n int; rows int; x0 int; k0 bigint; x1 int; k1 bigint; first_id bigint;
begin
  -- 1. Asking: checks on the fields, tags cleaned, visitors refused
  perform qat.as_user(1);
  perform qat.must_fail('a short title', $q$select public.ask_question('court', 'Un texte assez long pour passer', '{}')$q$, 'title needs at least 10');
  perform qat.must_fail('a short text', $q$select public.ask_question('Un titre assez long', 'court', '{}')$q$, 'at least 10');
  perform qat.must_fail('a bad tag', $q$select public.ask_question('Un titre assez long', 'Un texte assez long pour passer', '{"Mauvais Tag!"}')$q$, 'Tags must be');
  perform qat.must_fail('six tags', $q$select public.ask_question('Un titre assez long', 'Un texte assez long pour passer', '{"aa","bb","cc","dd","ee","ff"}')$q$, '5 tags');
  q := public.ask_question('Comment lire un fichier JSON en Python ?', 'Je veux charger un fichier data.json et lire ses clés.', '{"Python","json","python"}');
  reset role;
  if (select tags from public.questions where id = q) <> array['python','json'] then raise exception 'FAIL: tags not cleaned: %', (select tags from public.questions where id = q); end if;
  perform qat.as_anon();
  perform qat.must_fail('a visitor asking', $q$select public.ask_question('Un titre assez long', 'Un texte assez long pour passer', '{}')$q$, 'permission denied');
  reset role;
  raise notice 'OK 1: asking is checked, tags are cleaned';

  -- 2. Nobody reads or writes the tables directly
  perform qat.as_user(2);
  perform qat.must_fail('reading the table', 'select * from public.questions', 'permission denied');
  perform qat.must_fail('writing the table', $q$insert into public.answers (question_id, author_id, body) values (gen_random_uuid(), qat.uid(2), 'x')$q$, 'permission denied');
  reset role;
  raise notice 'OK 2: tables are closed';

  -- 3. Answering; limits; a hidden or unknown question
  perform qat.as_user(2);
  a1 := public.post_answer(q, 'Utilise json.load(open(''data.json'')).');
  perform qat.must_fail('an empty answer', format('select public.post_answer(%L, %L)', q, '   '), 'Write your answer');
  perform qat.must_fail('an unknown question', format('select public.post_answer(%L, %L)', gen_random_uuid(), 'texte'), 'Question not found');
  perform qat.as_user(3);
  a2 := public.post_answer(q, 'Avec pathlib : Path(''data.json'').read_text() puis json.loads.');
  perform qat.as_user(1);
  a3 := public.post_answer(q, 'Je réponds à ma propre question.');
  reset role;
  select answer_count into n from public.questions where id = q;
  if n <> 3 then raise exception 'FAIL: answer_count is %', n; end if;
  raise notice 'OK 3: answers are posted and counted';

  -- 4. Votes: one each, not for yourself, counted, can be taken back
  perform qat.as_user(4);
  perform public.vote_answer(a2);
  perform public.vote_answer(a2);
  perform public.vote_question(q);
  perform qat.as_user(3);
  perform qat.must_fail('voting for your own answer', format('select public.vote_answer(%L)', a2), 'own answer');
  perform public.vote_answer(a1);
  perform qat.as_user(1);
  perform qat.must_fail('voting for your own question', format('select public.vote_question(%L)', q), 'own question');
  reset role;
  if (select vote_count from public.answers where id = a2) <> 1 then raise exception 'FAIL: a vote was counted twice'; end if;
  if (select vote_count from public.questions where id = q) <> 1 then raise exception 'FAIL: question vote not counted'; end if;
  perform qat.as_user(4);
  perform public.unvote_answer(a2);
  reset role;
  if (select vote_count from public.answers where id = a2) <> 0 then raise exception 'FAIL: the vote was not taken back'; end if;
  perform qat.as_user(4);
  perform public.vote_answer(a2);
  reset role;
  raise notice 'OK 4: votes work';

  -- 5. Only the asker marks the solution; the author is rewarded once per question; never for your own answer
  select xp into x0 from public.profiles where id = qat.uid(2);
  select kopeks into k0 from public.wallets where user_id = qat.uid(2);
  perform qat.as_user(3);
  perform qat.must_fail('someone else marking the solution', format('select public.accept_answer(%L)', a1), 'Only the person who asked');
  perform qat.as_user(1);
  perform public.accept_answer(a1);
  reset role;
  select xp into x1 from public.profiles where id = qat.uid(2);
  select kopeks into k1 from public.wallets where user_id = qat.uid(2);
  if x1 - x0 <> 30 or k1 - k0 <> 20 then raise exception 'FAIL: the reward was % XP and % Kopeks', x1 - x0, k1 - k0; end if;
  -- switching to another answer and back never pays again
  perform qat.as_user(1);
  perform public.accept_answer(a2);
  perform public.accept_answer(a1);
  reset role;
  if (select xp from public.profiles where id = qat.uid(2)) <> x1 or (select xp from public.profiles where id = qat.uid(3)) <> (select xp from public.profiles where id = qat.uid(3)) then
    raise exception 'FAIL: the reward was paid again';
  end if;
  if (select count(*) from public.xp_events where idempotency_key = 'qa_accepted:' || q::text) <> 1 then raise exception 'FAIL: more than one reward for the question'; end if;
  -- answering your own question earns nothing
  perform qat.as_user(1);
  perform public.accept_answer(a3);
  reset role;
  if (select count(*) from public.xp_events where user_id = qat.uid(1) and reason = 'qa_accepted') <> 0 then raise exception 'FAIL: rewarded for answering yourself'; end if;
  raise notice 'OK 5: one reward per question, for someone else''s answer only';

  -- 6. Reading is public; the solution comes first; hidden things are not shown
  perform public.accept_answer(a2) from (select qat.as_user(1)) s;
  reset role;
  perform qat.as_anon();
  select count(*) into rows from public.list_questions();
  if rows < 1 then raise exception 'FAIL: a visitor sees no question'; end if;
  select id into first_id from public.list_answers(q) limit 1;
  if first_id <> a2 then raise exception 'FAIL: the solution is not first'; end if;
  if (select solved from public.list_questions() where id = q) is not true then raise exception 'FAIL: not shown as solved'; end if;
  if (select count(*) from public.list_questions('python')) <> 1 then raise exception 'FAIL: the tag filter'; end if;
  if (select count(*) from public.list_questions(null, 'open')) <> 0 then raise exception 'FAIL: the open filter shows a solved question'; end if;
  if (select count(*) from public.get_question(q)) <> 1 then raise exception 'FAIL: get_question'; end if;
  reset role;
  update public.answers set staff_hidden = true where id = a1;
  update public.questions set staff_hidden = true where id = q;
  perform qat.as_anon();
  if (select count(*) from public.list_questions() where id = q) <> 0 then raise exception 'FAIL: a hidden question is listed'; end if;
  if (select count(*) from public.get_question(q)) <> 0 then raise exception 'FAIL: a hidden question can be opened'; end if;
  if (select count(*) from public.list_answers(q)) <> 0 then raise exception 'FAIL: answers of a hidden question are listed'; end if;
  reset role;
  update public.questions set staff_hidden = false where id = q;
  raise notice 'OK 6: public reading, solution first, hidden stays hidden';

  -- 7. Editing and deleting: only the author
  perform qat.as_user(3);
  perform qat.must_fail('editing the question of someone else', format('select public.edit_question(%L, %L, %L, %L)', q, 'Un titre assez long', 'Un texte assez long', '{}'), 'Question not found');
  perform qat.must_fail('deleting the question of someone else', format('select public.delete_question(%L)', q), 'Question not found');
  perform qat.must_fail('deleting the answer of someone else', format('select public.delete_answer(%L)', a1), 'Answer not found');
  perform public.edit_answer(a2, 'Réponse corrigée.');
  perform public.delete_answer(a2);
  reset role;
  select answer_count, accepted_answer_id into n, first_id from public.questions where id = q;
  if n <> 2 then raise exception 'FAIL: answer_count after delete is %', n; end if;
  perform qat.as_user(1);
  perform public.delete_question(q);
  reset role;
  if exists (select 1 from public.answers where question_id = q) then raise exception 'FAIL: answers outlived the question'; end if;
  raise notice 'OK 7: only authors edit and delete';

  -- 8. A limit of questions per day
  perform qat.as_user(1);
  for n in 1..5 loop
    perform public.ask_question('Une question numéro ' || n || ' assez longue', 'Un texte assez long pour passer', '{}');
  end loop;
  perform qat.must_fail('too many questions', $q$select public.ask_question('Une question de trop assez longue', 'Un texte assez long pour passer', '{}')$q$, 'enough questions');
  reset role;
  raise notice 'OK 8: the daily limit works';
end $$;
