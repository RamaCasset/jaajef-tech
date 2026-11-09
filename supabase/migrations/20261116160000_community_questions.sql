-- jaajef.tech - Questions that belong to a community
--
-- A question can be asked inside a community (its "Questions" room) or for the whole City (no community).
-- A question of a private community is only seen, answered and voted on by that community's members.
-- A question of a public community is seen by everyone, like any other.
-- Asking inside a community needs to be a member of it.

begin;

alter table public.questions
  add column community_id uuid references public.communities (id) on delete cascade;
create index questions_community on public.questions (community_id, created_at desc);

-- Can the current person see questions of this community? (No community, or a public one, or a member.)
create function public.qa_can_see(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_community is null
      or exists (select 1 from public.communities c where c.id = p_community and not c.is_private)
      or public.is_member(p_community)
$$;

-- ---------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------
drop function public.ask_question(text, text, text[]);
create function public.ask_question(p_title text, p_body text, p_tags text[] default '{}', p_community uuid default null)
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
  if p_community is not null and not public.is_member(p_community) then
    raise exception 'You must be a member of this community to ask a question in it';
  end if;

  if (select count(*) from public.questions where author_id = v_me and created_at > now() - interval '1 day')
       >= public.chat_setting('qa_questions_per_day') then
    raise exception 'You have asked enough questions for today. Try again tomorrow';
  end if;

  insert into public.questions (author_id, title, body, tags, community_id)
  values (v_me, btrim(p_title), btrim(p_body), public.blog_clean_tags(p_tags), p_community)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------
drop function public.list_questions(text, text, text, integer, integer);
create function public.list_questions(
  p_tag text default null, p_filter text default 'all', p_sort text default 'recent',
  p_limit integer default 20, p_offset integer default 0, p_community uuid default null
)
returns table (
  id uuid, title text, tags text[], author_id uuid, author_username text,
  answer_count integer, vote_count integer, solved boolean, created_at timestamptz,
  community_id uuid, community_slug text, community_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select q.id, q.title, q.tags, q.author_id, pr.username, q.answer_count, q.vote_count, q.accepted_answer_id is not null, q.created_at,
         q.community_id, c.slug, c.name
    from public.questions q
    join public.profiles pr on pr.id = q.author_id
    left join public.communities c on c.id = q.community_id
   where not q.staff_hidden
     and public.qa_can_see(q.community_id)
     and (p_community is null or q.community_id = p_community)
     and (p_tag is null or lower(btrim(p_tag)) = any (q.tags))
     and (coalesce(p_filter, 'all') = 'all'
          or (p_filter = 'open' and q.accepted_answer_id is null)
          or (p_filter = 'solved' and q.accepted_answer_id is not null))
   order by case when p_sort = 'useful' then q.vote_count end desc nulls last, q.created_at desc, q.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

drop function public.get_question(uuid);
create function public.get_question(p_question uuid)
returns table (
  id uuid, title text, body text, tags text[], author_id uuid, author_username text, author_display_name text,
  accepted_answer_id bigint, answer_count integer, vote_count integer, voted_by_me boolean, created_at timestamptz, edited_at timestamptz,
  community_id uuid, community_slug text, community_name text
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
         q.created_at, q.edited_at, q.community_id, c.slug, c.name
    from public.questions q
    join public.profiles pr on pr.id = q.author_id
    left join public.communities c on c.id = q.community_id
   where q.id = p_question and not q.staff_hidden and public.qa_can_see(q.community_id);
end $$;

-- Answers of a question the person cannot see are not shown either.
create or replace function public.list_answers(p_question uuid)
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
   where a.question_id = p_question and not a.staff_hidden and not q.staff_hidden and public.qa_can_see(q.community_id)
   order by (a.id = q.accepted_answer_id) desc, a.vote_count desc, a.created_at, a.id;
end $$;

-- ---------------------------------------------------------------------
-- Answering and voting need to see the question
-- ---------------------------------------------------------------------
create function public.qa_guard_visible() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_question uuid; v_community uuid;
begin
  if tg_table_name = 'answer_votes' then
    select question_id into v_question from public.answers where id = new.answer_id;
  else
    v_question := new.question_id;
  end if;
  select community_id into v_community from public.questions where id = v_question;
  if not public.qa_can_see(v_community) then raise exception 'This question does not exist'; end if;
  return new;
end $$;
create trigger answers_guard_visible before insert on public.answers
  for each row execute function public.qa_guard_visible();
create trigger question_votes_guard_visible before insert on public.question_votes
  for each row execute function public.qa_guard_visible();
create trigger answer_votes_guard_visible before insert on public.answer_votes
  for each row execute function public.qa_guard_visible();

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.qa_can_see(uuid) from public, anon, authenticated;
revoke execute on function public.qa_guard_visible() from public, anon, authenticated;

revoke execute on function public.ask_question(text, text, text[], uuid) from public, anon;
grant execute on function public.ask_question(text, text, text[], uuid) to authenticated;
revoke execute on function public.list_questions(text, text, text, integer, integer, uuid) from public;
revoke execute on function public.get_question(uuid) from public;
grant execute on function public.list_questions(text, text, text, integer, integer, uuid), public.get_question(uuid) to anon, authenticated;

commit;
