-- jaajef.tech - @mentions and "quest solved" notices
--
-- Writing @username in a project comment or a blog comment tells that member. Solving a quest tells the
-- member what it paid. A member is never told about their own words, and never twice for the same comment
-- (the owner already gets the comment notice, so a mention of the owner adds nothing).

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
    'mention', 'quest_completed'
  ]
$$;

-- The usernames written as @name in a text: lower case, no repeats, at most 10 (a flood of tags is not a feature).
create function public.mentioned_usernames(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(array(
    select distinct lower(m[1])
      from regexp_matches(coalesce(p_text, ''), '(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,30})', 'g') as m
     limit 10
  ), array[]::text[])
$$;

-- Tells every member tagged in p_text, except the author and p_skip (who already hears about the comment).
create function public.notify_mentions(p_text text, p_actor uuid, p_skip uuid, p_data jsonb, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select id from public.profiles
     where lower(username) = any (public.mentioned_usernames(p_text))
       and id is distinct from p_actor
       and id is distinct from p_skip
  loop
    perform public.notify(r.id, 'mention',
      p_data || jsonb_build_object('actor_id', p_actor, 'actor_username', public.username_of(p_actor), 'excerpt', left(p_text, 100)),
      p_dedupe || ':' || r.id);
  end loop;
end $$;

create function public.notify_project_comment_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_title text;
begin
  select owner_id, title into v_owner, v_title from public.projects where id = new.project_id;
  perform public.notify_mentions(new.body, new.author_id, v_owner,
    jsonb_build_object('place', 'project', 'project_id', new.project_id, 'project_title', v_title, 'comment_id', new.id),
    'mention:project:' || new.id);
  return null;
end $$;
create trigger project_comments_mentions after insert on public.project_comments
  for each row execute function public.notify_project_comment_mentions();

create function public.notify_blog_comment_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_title text; v_slug text;
begin
  select author_id, title, slug into v_author, v_title, v_slug from public.blog_posts where id = new.post_id;
  perform public.notify_mentions(new.body, new.author_id, v_author,
    jsonb_build_object('place', 'blog', 'post_id', new.post_id, 'post_title', v_title, 'post_slug', v_slug, 'comment_id', new.id),
    'mention:blog:' || new.id);
  return null;
end $$;
create trigger blog_comments_mentions after insert on public.blog_comments
  for each row execute function public.notify_blog_comment_mentions();

-- A quest solved: told what it paid (once: the attempt only becomes solved once).
create function public.notify_quest_solved() returns trigger
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  if new.status = 'solved' and old.status is distinct from 'solved' then
    select slug, title, xp_reward, kopek_reward into q from public.quests where id = new.quest_id;
    perform public.notify(new.user_id, 'quest_completed',
      jsonb_build_object('quest_id', new.quest_id, 'quest_slug', q.slug, 'quest_title', q.title, 'xp', q.xp_reward, 'kopeks', q.kopek_reward),
      'questdone:' || new.quest_id || ':' || new.user_id);
  end if;
  return null;
end $$;
create trigger quest_attempts_notify after update of status on public.quest_attempts
  for each row execute function public.notify_quest_solved();

revoke execute on function public.mentioned_usernames(text) from public, anon, authenticated;
revoke execute on function public.notify_mentions(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.notify_project_comment_mentions() from public, anon, authenticated;
revoke execute on function public.notify_blog_comment_mentions() from public, anon, authenticated;
revoke execute on function public.notify_quest_solved() from public, anon, authenticated;
