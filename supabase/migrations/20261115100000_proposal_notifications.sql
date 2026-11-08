-- jaajef.tech - Notifications for proposed changes
--
-- When a collaborator proposes changes to a project, the owner is told. When the owner merges or
-- declines the proposal, its author is told. The repo-editor function calls notify_proposal
-- (server only) after GitHub has accepted the action.

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
    'proposal_opened', 'proposal_merged', 'proposal_declined'
  ]
$$;

-- p_kind: proposal_opened (told: the project owner), proposal_merged / proposal_declined (told: the author,
-- found by username). Nobody is told about what they did themselves.
create function public.notify_proposal(p_kind text, p_project uuid, p_actor uuid, p_author text, p_number integer, p_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_to uuid;
begin
  if p_kind is null or p_kind not in ('proposal_opened', 'proposal_merged', 'proposal_declined') then
    raise exception 'Unknown proposal notification';
  end if;
  select owner_id, title into v_owner, v_title from public.projects where id = p_project;
  if v_owner is null then return; end if;
  if p_kind = 'proposal_opened' then
    v_to := v_owner;
  else
    select id into v_to from public.profiles where lower(username) = lower(coalesce(p_author, ''));
  end if;
  if v_to is null or v_to is not distinct from p_actor then return; end if;
  perform public.notify(v_to, p_kind,
    jsonb_build_object('project_id', p_project, 'project_title', v_title, 'actor_id', p_actor, 'actor_username', public.username_of(p_actor),
                       'number', p_number, 'title', left(coalesce(p_title, ''), 200)),
    'proposal:' || p_kind || ':' || p_project || ':' || p_number);
end $$;

revoke execute on function public.notify_proposal(text, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.notify_proposal(text, uuid, uuid, text, integer, text) to service_role;
