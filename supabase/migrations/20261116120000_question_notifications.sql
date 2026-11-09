-- jaajef.tech - Notifications for questions and answers
--
-- The person who asked is told when someone answers. The author of an answer is told when the asker
-- chooses it as the solution. Nobody is told about what they did themselves.

create or replace function public.notification_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'project_starred', 'project_comment', 'project_confirmed', 'project_hidden',
    'collab_request', 'collab_accepted', 'collab_declined',
    'join_request', 'join_approved', 'join_declined',
    'badge_unlocked', 'warning', 'suspension',
    'new_application', 'application_seen', 'application_shortlisted', 'application_declined',
    'job_alert',
    'blog_comment', 'blog_like', 'blog_hidden', 'job_offer_hidden',
    'souk_submission_approved', 'souk_submission_rejected',
    'souk_sale',
    'souk_item_removed',
    'collab_invite', 'collab_invite_accepted', 'collab_invite_declined',
    'proposal_opened', 'proposal_merged', 'proposal_declined',
    'question_answered', 'answer_accepted'
  ]
$$;

create function public.notify_question_answered() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_asker uuid; v_title text;
begin
  select author_id, title into v_asker, v_title from public.questions where id = new.question_id;
  if v_asker is not null and v_asker is distinct from new.author_id then
    perform public.notify(v_asker, 'question_answered',
      jsonb_build_object('question_id', new.question_id, 'question_title', left(v_title, 150), 'answer_id', new.id,
                         'excerpt', left(new.body, 100),
                         'actor_id', new.author_id, 'actor_username', public.username_of(new.author_id)),
      'answered:' || new.id);
  end if;
  return null;
end $$;
create trigger answers_notify after insert on public.answers
  for each row execute function public.notify_question_answered();

create function public.notify_answer_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if new.accepted_answer_id is not null and new.accepted_answer_id is distinct from old.accepted_answer_id then
    select author_id into v_author from public.answers where id = new.accepted_answer_id;
    if v_author is not null and v_author is distinct from new.author_id then
      perform public.notify(v_author, 'answer_accepted',
        jsonb_build_object('question_id', new.id, 'question_title', left(new.title, 150), 'answer_id', new.accepted_answer_id,
                           'actor_id', new.author_id, 'actor_username', public.username_of(new.author_id)),
        'accepted:' || new.id || ':' || new.accepted_answer_id);
    end if;
  end if;
  return null;
end $$;
create trigger questions_notify_accepted after update of accepted_answer_id on public.questions
  for each row execute function public.notify_answer_accepted();

revoke execute on function public.notify_question_answered() from public, anon, authenticated;
revoke execute on function public.notify_answer_accepted() from public, anon, authenticated;
