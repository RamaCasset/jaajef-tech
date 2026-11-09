-- jaajef.tech - One complete list of notice kinds
--
-- Two earlier changes each rewrote the whole list (questions and answers, then @mentions), so whichever ran
-- last forgot the other one's kinds. This sets the full list once more, with every kind. It is safe to run
-- again: it only replaces the function with the same complete list.

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
    'question_answered', 'answer_accepted',
    'mention', 'quest_completed'
  ]
$$;
