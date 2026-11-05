-- jaajef.tech  -  Migration: moderation follow-up
--
-- Ties the moderation piece to the pieces built beside it:
--   * Suspended members cannot send join requests, comment on projects (or
--     edit a comment) or ask to collaborate.
--   * A project hidden by staff disappears completely: no stars, comments or
--     collaborators are shown, and nobody can add any.
--   * Project comments can be reported, and staff can remove them.
--
-- Requires: ask to join, staff roles, moderation, project social.

begin;

create trigger join_requests_suspension before insert on public.join_requests
  for each row execute function public.refuse_if_suspended('user_id');
create trigger project_comments_suspension before insert or update of body on public.project_comments
  for each row execute function public.refuse_if_suspended('author_id');
create trigger collab_requests_suspension before insert on public.collab_requests
  for each row execute function public.refuse_if_suspended('requester_id');

create or replace function public.project_is_listed(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects
     where id = p_project and is_public and verified_at is not null and not staff_hidden
  )
$$;

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('message', 'direct_message', 'project', 'member', 'project_comment'));

create or replace function public.report_content(
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_author uuid;
  v_community uuid;
  v_snapshot jsonb;
  v_msg public.messages;
  v_dm public.direct_messages;
  v_proj public.projects;
  v_cmt public.project_comments;
  v_prof public.profiles;
  v_conv public.conversations;
  v_bigint bigint;
  v_uuid uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'Your note is too long (500 characters at most)'; end if;

  if (select count(*) from public.reports where reporter_id = v_me and created_at > now() - interval '1 day')
       >= public.chat_setting('report_max_per_day') then
    raise exception 'Slow down: too many reports today';
  end if;

  begin
    if p_target_type in ('message', 'direct_message', 'project_comment') then v_bigint := p_target_id::bigint; end if;
    if p_target_type in ('project', 'member') then v_uuid := p_target_id::uuid; end if;
  exception when others then
    raise exception 'Target not found';
  end;

  if p_target_type = 'message' then
    select * into v_msg from public.messages where id = v_bigint and deleted_at is null;
    if not found or not public.is_member(v_msg.community_id) then raise exception 'Target not found'; end if;
    v_author := v_msg.author_id;
    v_community := v_msg.community_id;
    v_snapshot := jsonb_build_object('body', v_msg.body, 'title', v_msg.title, 'channel_id', v_msg.channel_id, 'sent_at', v_msg.created_at);

  elsif p_target_type = 'direct_message' then
    select * into v_dm from public.direct_messages where id = v_bigint and deleted_at is null;
    if not found then raise exception 'Target not found'; end if;
    select * into v_conv from public.conversations where id = v_dm.conversation_id;
    if v_me not in (v_conv.user_a, v_conv.user_b) then raise exception 'Target not found'; end if;
    v_author := v_dm.sender_id;
    v_snapshot := jsonb_build_object('body', v_dm.body, 'file_name', v_dm.file_name, 'file_type', v_dm.file_mime, 'sent_at', v_dm.created_at);

  elsif p_target_type = 'project' then
    select * into v_proj from public.projects where id = v_uuid;
    if not found or not (v_proj.is_public and v_proj.verified_at is not null and not v_proj.staff_hidden) then
      raise exception 'Target not found';
    end if;
    v_author := v_proj.owner_id;
    v_snapshot := jsonb_build_object('title', v_proj.title, 'summary', v_proj.summary, 'repository', v_proj.github_owner || '/' || v_proj.github_repo, 'tags', v_proj.tags);

  elsif p_target_type = 'project_comment' then
    select * into v_cmt from public.project_comments where id = v_bigint;
    if not found or not public.project_is_listed(v_cmt.project_id) then raise exception 'Target not found'; end if;
    v_author := v_cmt.author_id;
    v_snapshot := jsonb_build_object('body', v_cmt.body, 'project_id', v_cmt.project_id, 'sent_at', v_cmt.created_at);

  elsif p_target_type = 'member' then
    select * into v_prof from public.profiles where id = v_uuid;
    if not found then raise exception 'Target not found'; end if;
    v_author := v_prof.id;
    v_snapshot := jsonb_build_object('username', v_prof.username, 'display_name', v_prof.display_name, 'bio', v_prof.bio);

  else
    raise exception 'You can report a message, a private message, a project comment, a project or a member';
  end if;

  if v_author = v_me then raise exception 'You cannot report your own content'; end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, target_author_id, community_id, reason, note, snapshot)
    values (v_me, p_target_type, p_target_id, v_author, v_community, p_reason, nullif(btrim(coalesce(p_note, '')), ''), v_snapshot)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already reported this';
  end;

  return v_id;
end $$;

create or replace function public.resolve_report(
  p_report uuid,
  p_action text,
  p_note text default null,
  p_days integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_my_role text := public.staff_role();
  v_rep public.reports;
  v_target_role text;
  v_max_days integer;
  v_status text;
begin
  if v_my_role is null then raise exception 'Only staff can do this'; end if;
  if p_action not in ('dismiss', 'remove_content', 'warn_member', 'suspend_member') then
    raise exception 'Unknown action';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'The note is too long (500 characters at most)'; end if;

  select * into v_rep from public.reports where id = p_report for update;
  if not found then raise exception 'Report not found'; end if;
  if v_rep.status <> 'open' then raise exception 'This report has already been handled'; end if;

  -- Who may be sanctioned
  if p_action in ('warn_member', 'suspend_member') then
    select role into v_target_role from public.staff_roles where user_id = v_rep.target_author_id;
    if v_target_role = 'admin' then raise exception 'An admin cannot be sanctioned through a report'; end if;
    if v_target_role = 'moderator' and v_my_role <> 'admin' then raise exception 'Only an admin can sanction a moderator'; end if;
  end if;

  if p_action = 'remove_content' then
    if v_rep.target_type = 'message' then
      update public.messages set body = '', title = null, deleted_at = now()
       where id = v_rep.target_id::bigint and deleted_at is null;
    elsif v_rep.target_type = 'direct_message' then
      update public.direct_messages
         set body = '', file_path = null, file_name = null, file_mime = null, file_size = null, deleted_at = now()
       where id = v_rep.target_id::bigint and deleted_at is null;
    elsif v_rep.target_type = 'project_comment' then
      delete from public.project_comments where id = v_rep.target_id::bigint;
    elsif v_rep.target_type = 'project' then
      update public.projects set staff_hidden = true where id = v_rep.target_id::uuid;
    else
      raise exception 'There is nothing to remove for a member: warn or suspend instead';
    end if;

  elsif p_action = 'warn_member' then
    insert into public.member_warnings (user_id, report_id, note, created_by)
    values (v_rep.target_author_id, p_report, nullif(btrim(coalesce(p_note, '')), ''), v_me);

  elsif p_action = 'suspend_member' then
    v_max_days := case when v_my_role = 'admin'
                       then public.chat_setting('admin_max_suspension_days')
                       else public.chat_setting('moderator_max_suspension_days') end;
    if p_days is null or p_days < 1 or p_days > v_max_days then
      raise exception 'A suspension lasts between 1 and % days for you', v_max_days;
    end if;
    insert into public.member_suspensions (user_id, report_id, reason, until, created_by)
    values (v_rep.target_author_id, p_report, v_rep.reason, now() + make_interval(days => p_days), v_me);
  end if;

  v_status := case when p_action = 'dismiss' then 'dismissed' else 'actioned' end;

  update public.reports
     set status = v_status, action = p_action, handled_by = v_me, handled_at = now(),
         resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_report;

  -- Other open reports about the same thing are closed together with this one.
  update public.reports
     set status = v_status, action = p_action, handled_by = v_me, handled_at = now(),
         resolution_note = 'Closed together with another report'
   where target_type = v_rep.target_type and target_id = v_rep.target_id and status = 'open';

  perform public.log_admin_action(
    v_me, 'report_' || p_action, v_rep.target_type, v_rep.target_id,
    jsonb_build_object('report_id', p_report, 'reason', v_rep.reason, 'author_id', v_rep.target_author_id, 'days', p_days));
end $$;

commit;
