-- jaajef.tech - Questions and answers (database part)
--
-- Members ask a technical question (title, text, up to 5 tags). Others answer. Anyone can say a question or an
-- answer was useful (one vote each, not for your own). The asker marks the answer that solved it: its author earns
-- XP and Kopeks, once per question. Everything is public to read; writing goes through the functions below.
--
-- The reward amounts and limits are guesses, stored in game_config with status 'tbc' so they can be changed
-- without code. Moderation (reports, hiding) and notices come in the next steps; `staff_hidden` is ready for them.

begin;

insert into public.game_config (key, value, status, description) values
  ('qa_questions_per_day', '5', 'tbc', 'Most questions one member can ask per day'),
  ('qa_answers_per_hour', '20', 'tbc', 'Most answers one member can post per hour'),
  ('qa_accepted_xp', '30', 'tbc', 'XP earned by the author of the answer the asker marks as the solution'),
  ('qa_accepted_kopeks', '20', 'tbc', 'Kopeks earned by the author of the answer the asker marks as the solution');

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 10 and 150),
  body text not null check (char_length(btrim(body)) between 10 and 8000),
  tags text[] not null default '{}',
  accepted_answer_id bigint,
  answer_count integer not null default 0,
  vote_count integer not null default 0,
  staff_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index questions_recent on public.questions (created_at desc);
create index questions_author on public.questions (author_id, created_at desc);
create index questions_tags on public.questions using gin (tags);

create table public.answers (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.questions (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  vote_count integer not null default 0,
  staff_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index answers_question on public.answers (question_id, created_at);
create index answers_author on public.answers (author_id, created_at desc);

alter table public.questions
  add constraint questions_accepted_answer foreign key (accepted_answer_id) references public.answers (id) on delete set null;

create table public.question_votes (
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (question_id, user_id)
);
create index question_votes_user on public.question_votes (user_id);

create table public.answer_votes (
  answer_id bigint not null references public.answers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (answer_id, user_id)
);
create index answer_votes_user on public.answer_votes (user_id);

-- Counters kept by triggers, so a client can never set them.
create function public.qa_count_answers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.questions set answer_count = answer_count + 1 where id = new.question_id;
  else
    update public.questions set answer_count = greatest(answer_count - 1, 0) where id = old.question_id;
  end if;
  return null;
end $$;
create trigger answers_count after insert or delete on public.answers
  for each row execute function public.qa_count_answers();

create function public.qa_count_question_votes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.questions set vote_count = vote_count + 1 where id = new.question_id;
  else
    update public.questions set vote_count = greatest(vote_count - 1, 0) where id = old.question_id;
  end if;
  return null;
end $$;
create trigger question_votes_count after insert or delete on public.question_votes
  for each row execute function public.qa_count_question_votes();

create function public.qa_count_answer_votes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.answers set vote_count = vote_count + 1 where id = new.answer_id;
  else
    update public.answers set vote_count = greatest(vote_count - 1, 0) where id = old.answer_id;
  end if;
  return null;
end $$;
create trigger answer_votes_count after insert or delete on public.answer_votes
  for each row execute function public.qa_count_answer_votes();

-- ---------------------------------------------------------------------
-- Asking, editing, deleting
-- ---------------------------------------------------------------------
create function public.ask_question(p_title text, p_body text, p_tags text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if p_title is null or char_length(btrim(p_title)) < 10 then raise exception 'The title needs at least 10 characters'; end if;
  if char_length(btrim(p_title)) > 150 then raise exception 'The title is too long (150 characters at most)'; end if;
  if p_body is null or char_length(btrim(p_body)) < 10 then raise exception 'Describe your problem in at least 10 characters'; end if;
  if char_length(btrim(p_body)) > 8000 then raise exception 'The question is too long (8000 characters at most)'; end if;

  if (select count(*) from public.questions where author_id = v_me and created_at > now() - interval '1 day')
       >= public.chat_setting('qa_questions_per_day') then
    raise exception 'You have asked enough questions for today. Try again tomorrow';
  end if;

  insert into public.questions (author_id, title, body, tags)
  values (v_me, btrim(p_title), btrim(p_body), public.blog_clean_tags(p_tags))
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_question(p_question uuid, p_title text, p_body text, p_tags text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if p_title is null or char_length(btrim(p_title)) < 10 or char_length(btrim(p_title)) > 150 then raise exception 'The title needs 10 to 150 characters'; end if;
  if p_body is null or char_length(btrim(p_body)) < 10 or char_length(btrim(p_body)) > 8000 then raise exception 'The question needs 10 to 8000 characters'; end if;
  update public.questions
     set title = btrim(p_title), body = btrim(p_body), tags = public.blog_clean_tags(p_tags), edited_at = now()
   where id = p_question and author_id = v_me;
  if not found then raise exception 'Question not found'; end if;
end $$;

create function public.delete_question(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  delete from public.questions where id = p_question and author_id = auth.uid();
  if not found then raise exception 'Question not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------
create function public.post_answer(p_question uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id bigint;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write your answer first'; end if;
  if char_length(btrim(p_body)) > 8000 then raise exception 'The answer is too long (8000 characters at most)'; end if;
  if not exists (select 1 from public.questions where id = p_question and not staff_hidden) then
    raise exception 'Question not found';
  end if;
  if (select count(*) from public.answers where author_id = v_me and created_at > now() - interval '1 hour')
       >= public.chat_setting('qa_answers_per_hour') then
    raise exception 'Slow down: too many answers in the last hour';
  end if;
  insert into public.answers (question_id, author_id, body) values (p_question, v_me, btrim(p_body)) returning id into v_id;
  return v_id;
end $$;

create function public.edit_answer(p_answer bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(btrim(p_body)) > 8000 then raise exception 'The answer needs 1 to 8000 characters'; end if;
  update public.answers set body = btrim(p_body), edited_at = now() where id = p_answer and author_id = auth.uid();
  if not found then raise exception 'Answer not found'; end if;
end $$;

create function public.delete_answer(p_answer bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  delete from public.answers where id = p_answer and author_id = auth.uid();
  if not found then raise exception 'Answer not found'; end if;
end $$;

-- The asker marks the answer that solved the problem. The author of that answer is rewarded once per question
-- (changing the mark later does not pay again), and never for answering their own question.
create function public.accept_answer(p_answer bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a public.answers;
  v_q public.questions;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  select * into v_a from public.answers where id = p_answer and not staff_hidden;
  if not found then raise exception 'Answer not found'; end if;
  select * into v_q from public.questions where id = v_a.question_id for update;
  if v_q.author_id <> v_me then raise exception 'Only the person who asked can choose the solution'; end if;

  update public.questions set accepted_answer_id = p_answer where id = v_q.id;

  if v_a.author_id <> v_me then
    perform public.grant_reward(
      v_a.author_id, public.chat_setting('qa_accepted_xp'), public.chat_setting('qa_accepted_kopeks'),
      'qa_accepted', 'qa_accepted:' || v_q.id::text, 'question', v_q.id::text);
  end if;
end $$;

create function public.unaccept_answer(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  update public.questions set accepted_answer_id = null where id = p_question and author_id = auth.uid();
  if not found then raise exception 'Question not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- "Useful" votes: one per member, never on your own
-- ---------------------------------------------------------------------
create function public.vote_question(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_author uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  select author_id into v_author from public.questions where id = p_question and not staff_hidden;
  if not found then raise exception 'Question not found'; end if;
  if v_author = v_me then raise exception 'You cannot vote for your own question'; end if;
  insert into public.question_votes (question_id, user_id) values (p_question, v_me) on conflict do nothing;
end $$;

create function public.unvote_question(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  delete from public.question_votes where question_id = p_question and user_id = auth.uid();
end $$;

create function public.vote_answer(p_answer bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_author uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  select author_id into v_author from public.answers where id = p_answer and not staff_hidden;
  if not found then raise exception 'Answer not found'; end if;
  if v_author = v_me then raise exception 'You cannot vote for your own answer'; end if;
  insert into public.answer_votes (answer_id, user_id) values (p_answer, v_me) on conflict do nothing;
end $$;

create function public.unvote_answer(p_answer bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  delete from public.answer_votes where answer_id = p_answer and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Reading (public: visitors can read too)
-- ---------------------------------------------------------------------
-- p_filter: 'all', 'open' (no solution yet) or 'solved'. p_sort: 'recent' or 'useful'.
create function public.list_questions(
  p_tag text default null, p_filter text default 'all', p_sort text default 'recent',
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, title text, tags text[], author_id uuid, author_username text,
  answer_count integer, vote_count integer, solved boolean, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select q.id, q.title, q.tags, q.author_id, pr.username, q.answer_count, q.vote_count, q.accepted_answer_id is not null, q.created_at
    from public.questions q
    join public.profiles pr on pr.id = q.author_id
   where not q.staff_hidden
     and (p_tag is null or lower(btrim(p_tag)) = any (q.tags))
     and (coalesce(p_filter, 'all') = 'all'
          or (p_filter = 'open' and q.accepted_answer_id is null)
          or (p_filter = 'solved' and q.accepted_answer_id is not null))
   order by case when p_sort = 'useful' then q.vote_count end desc nulls last, q.created_at desc, q.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.get_question(p_question uuid)
returns table (
  id uuid, title text, body text, tags text[], author_id uuid, author_username text, author_display_name text,
  accepted_answer_id bigint, answer_count integer, vote_count integer, voted_by_me boolean, created_at timestamptz, edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select q.id, q.title, q.body, q.tags, q.author_id, pr.username, pr.display_name, q.accepted_answer_id, q.answer_count, q.vote_count,
         exists (select 1 from public.question_votes v where v.question_id = q.id and v.user_id = auth.uid()),
         q.created_at, q.edited_at
    from public.questions q
    join public.profiles pr on pr.id = q.author_id
   where q.id = p_question and not q.staff_hidden;
end $$;

-- The accepted answer comes first, then the most useful, then the oldest.
create function public.list_answers(p_question uuid)
returns table (
  id bigint, body text, author_id uuid, author_username text, author_display_name text,
  vote_count integer, voted_by_me boolean, accepted boolean, created_at timestamptz, edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select a.id, a.body, a.author_id, pr.username, pr.display_name, a.vote_count,
         exists (select 1 from public.answer_votes v where v.answer_id = a.id and v.user_id = auth.uid()),
         a.id = q.accepted_answer_id, a.created_at, a.edited_at
    from public.answers a
    join public.questions q on q.id = a.question_id
    join public.profiles pr on pr.id = a.author_id
   where a.question_id = p_question and not a.staff_hidden and not q.staff_hidden
   order by (a.id = q.accepted_answer_id) desc, a.vote_count desc, a.created_at, a.id;
end $$;

-- ---------------------------------------------------------------------
-- Security: nobody touches the tables directly
-- ---------------------------------------------------------------------
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.question_votes enable row level security;
alter table public.answer_votes enable row level security;
revoke all on public.questions, public.answers, public.question_votes, public.answer_votes from public, anon, authenticated;

revoke execute on function public.qa_count_answers() from public, anon, authenticated;
revoke execute on function public.qa_count_question_votes() from public, anon, authenticated;
revoke execute on function public.qa_count_answer_votes() from public, anon, authenticated;

revoke execute on function public.ask_question(text, text, text[]) from public, anon;
revoke execute on function public.edit_question(uuid, text, text, text[]) from public, anon;
revoke execute on function public.delete_question(uuid) from public, anon;
revoke execute on function public.post_answer(uuid, text) from public, anon;
revoke execute on function public.edit_answer(bigint, text) from public, anon;
revoke execute on function public.delete_answer(bigint) from public, anon;
revoke execute on function public.accept_answer(bigint) from public, anon;
revoke execute on function public.unaccept_answer(uuid) from public, anon;
revoke execute on function public.vote_question(uuid) from public, anon;
revoke execute on function public.unvote_question(uuid) from public, anon;
revoke execute on function public.vote_answer(bigint) from public, anon;
revoke execute on function public.unvote_answer(bigint) from public, anon;
grant execute on function public.ask_question(text, text, text[]), public.edit_question(uuid, text, text, text[]),
  public.delete_question(uuid), public.post_answer(uuid, text), public.edit_answer(bigint, text), public.delete_answer(bigint),
  public.accept_answer(bigint), public.unaccept_answer(uuid), public.vote_question(uuid), public.unvote_question(uuid),
  public.vote_answer(bigint), public.unvote_answer(bigint) to authenticated;

revoke execute on function public.list_questions(text, text, text, integer, integer) from public;
revoke execute on function public.get_question(uuid) from public;
revoke execute on function public.list_answers(uuid) from public;
grant execute on function public.list_questions(text, text, text, integer, integer), public.get_question(uuid), public.list_answers(uuid)
  to anon, authenticated;

commit;
