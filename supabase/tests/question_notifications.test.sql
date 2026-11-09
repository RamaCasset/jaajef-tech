-- Tests for the question and answer notices. Run AFTER all migrations.
-- People: rama (1) asks; sira (2) answers; tidiane (3) answers.

create schema qnt;
grant usage on schema qnt to public;
create function qnt.uid(p_n int) returns uuid language sql immutable as $$ select ('b4c5d6e7-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function qnt.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', qnt.uid(p_n)::text, true); end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (qnt.uid(1), 'rama-qn@exemple.sn', '{"provider":"email"}', '{}'),
  (qnt.uid(2), 'sira-qn@exemple.sn', '{"provider":"email"}', '{}'),
  (qnt.uid(3), 'tidiane-qn@exemple.sn', '{"provider":"email"}', '{}');
update public.profiles set username = 'rama_qn' where id = qnt.uid(1);
update public.profiles set username = 'sira_qn' where id = qnt.uid(2);

do $$
declare q uuid; a1 bigint; a2 bigint; n int; d jsonb;
begin
  perform qnt.as_user(1);
  q := public.ask_question('Comment centrer une div en CSS ?', 'Je cherche la façon la plus simple de centrer.', '{}');
  perform qnt.as_user(2);
  a1 := public.post_answer(q, 'Utilise display grid et place-items center.');
  perform qnt.as_user(3);
  a2 := public.post_answer(q, 'Flexbox avec justify-content et align-items.');
  perform qnt.as_user(1);
  perform public.post_answer(q, 'Je note mes propres essais.');
  reset role;

  -- 1. The asker is told about each answer from someone else, with who, which question and an excerpt; not about their own
  select count(*) into n from public.notifications where user_id = qnt.uid(1) and kind = 'question_answered';
  if n <> 2 then raise exception 'FAIL: the asker got % notices, expected 2', n; end if;
  select data into d from public.notifications where user_id = qnt.uid(1) and kind = 'question_answered' order by id limit 1;
  if d ->> 'actor_username' <> 'sira_qn' or d ->> 'question_id' <> q::text or d ->> 'question_title' <> 'Comment centrer une div en CSS ?' or d ->> 'excerpt' not like 'Utilise display grid%' then
    raise exception 'FAIL: the notice data is wrong: %', d;
  end if;
  if exists (select 1 from public.notifications where user_id <> qnt.uid(1) and kind = 'question_answered') then raise exception 'FAIL: someone else was told about an answer'; end if;
  raise notice 'OK 1: the asker is told about answers from others';

  -- 2. The author of the chosen answer is told, once, even if the choice goes back and forth; the asker is not told about their own choice
  perform qnt.as_user(1);
  perform public.accept_answer(a1);
  perform public.accept_answer(a2);
  perform public.accept_answer(a1);
  reset role;
  select count(*) into n from public.notifications where user_id = qnt.uid(2) and kind = 'answer_accepted';
  if n <> 1 then raise exception 'FAIL: the first author was told % times', n; end if;
  select count(*) into n from public.notifications where user_id = qnt.uid(3) and kind = 'answer_accepted';
  if n <> 1 then raise exception 'FAIL: the second author was told % times', n; end if;
  if exists (select 1 from public.notifications where user_id = qnt.uid(1) and kind = 'answer_accepted') then raise exception 'FAIL: the asker was told about their own choice'; end if;
  raise notice 'OK 2: the author of a chosen answer is told once';

  -- 3. Answering your own question as the asker and choosing it tells nobody
  select id into a2 from public.answers where question_id = q and author_id = qnt.uid(1);
  perform qnt.as_user(1);
  perform public.accept_answer(a2);
  reset role;
  select count(*) into n from public.notifications where kind = 'answer_accepted';
  if n <> 2 then raise exception 'FAIL: % accepted notices, expected 2', n; end if;
  raise notice 'OK 3: no notice for choosing your own answer';

  -- 4. The notice kinds are known (so people can mute them)
  if not ('question_answered' = any (public.notification_kinds()) and 'answer_accepted' = any (public.notification_kinds())) then
    raise exception 'FAIL: the new kinds are not in the list';
  end if;
  raise notice 'OK 4: the kinds are in the list';
end $$;
