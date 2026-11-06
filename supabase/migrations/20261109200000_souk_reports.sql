-- jaajef.tech  -  Migration: reports on Souk items, and taking items off sale
--
--   * Members can report a shop item made by another member. Staff "remove content" takes the
--     item off sale; people who already own it keep it. Items with no creator (made by the team)
--     cannot be reported.
--   * Shop managers, shop owners and admins can take any item off sale or put it back
--     (a reason is required to take one off; every change is logged).
--   * The creator is told when their item is taken off sale, by either route. This notice
--     cannot be switched off.
--
-- Requires: moderation (+ follow-up), blog hooks, Souk submissions, creator share, back-office roles.

begin;

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
    'souk_item_removed'
  ]
$$;

create or replace function public.notification_kinds_locked()
returns text[]
language sql
immutable
as $$
  select array['warning', 'suspension', 'project_hidden', 'blog_hidden', 'job_offer_hidden', 'souk_item_removed']
$$;

create function public.notify_souk_item_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and not new.is_active and new.creator_id is not null then
    perform public.notify(new.creator_id, 'souk_item_removed',
      jsonb_build_object('item_id', new.id, 'item_name', new.name));
  end if;
  return null;
end $$;
create trigger souk_items_notify_removed after update of is_active on public.souk_items
  for each row execute function public.notify_souk_item_removed();
revoke execute on function public.notify_souk_item_removed() from public, anon, authenticated;

-- Shop staff: take an item off sale or put it back.
create function public.set_souk_item_on_sale(p_item uuid, p_on boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_manage_shop() then raise exception 'Only shop staff can do this'; end if;
  if p_on is null then raise exception 'Choose on sale or off sale'; end if;
  if not p_on and (p_reason is null or char_length(btrim(p_reason)) = 0) then raise exception 'Give a reason for taking the item off sale'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'The reason is too long (500 characters at most)'; end if;

  update public.souk_items set is_active = p_on where id = p_item and is_active is distinct from p_on;
  if found then
    perform public.log_admin_action(auth.uid(), case when p_on then 'souk_item_on_sale' else 'souk_item_off_sale' end,
                                    'souk_item', p_item::text,
                                    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
  elsif not exists (select 1 from public.souk_items where id = p_item) then
    raise exception 'Item not found';
  end if;
end $$;
revoke execute on function public.set_souk_item_on_sale(uuid, boolean, text) from public, anon;
grant execute on function public.set_souk_item_on_sale(uuid, boolean, text) to authenticated;

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('message', 'direct_message', 'project', 'member', 'project_comment',
                         'blog_post', 'blog_comment', 'job_offer', 'souk_item'));

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
  v_post public.blog_posts;
  v_bcmt public.blog_comments;
  v_offer public.job_offers;
  v_sitem public.souk_items;
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
    if p_target_type in ('message', 'direct_message', 'project_comment', 'blog_comment') then v_bigint := p_target_id::bigint; end if;
    if p_target_type in ('project', 'member', 'blog_post', 'job_offer', 'souk_item') then v_uuid := p_target_id::uuid; end if;
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

  elsif p_target_type = 'blog_post' then
    select * into v_post from public.blog_posts where id = v_uuid;
    if not found or not public.blog_post_is_listed(v_uuid) then raise exception 'Target not found'; end if;
    v_author := v_post.author_id;
    v_snapshot := jsonb_build_object('title', v_post.title, 'summary', v_post.summary, 'body', left(v_post.body, 2000), 'slug', v_post.slug);

  elsif p_target_type = 'blog_comment' then
    select * into v_bcmt from public.blog_comments where id = v_bigint;
    if not found or not public.blog_post_is_listed(v_bcmt.post_id) then raise exception 'Target not found'; end if;
    v_author := v_bcmt.author_id;
    v_snapshot := jsonb_build_object('body', v_bcmt.body, 'post_id', v_bcmt.post_id, 'sent_at', v_bcmt.created_at);

  elsif p_target_type = 'job_offer' then
    select * into v_offer from public.job_offers where id = v_uuid;
    if not found or not public.job_offer_is_listed(v_uuid) then raise exception 'Target not found'; end if;
    v_author := v_offer.posted_by;
    v_snapshot := jsonb_build_object('title', v_offer.title, 'description', left(v_offer.description, 2000), 'kind', v_offer.kind,
                                     'employer_id', v_offer.employer_id);

  elsif p_target_type = 'souk_item' then
    select * into v_sitem from public.souk_items where id = v_uuid;
    if not found or not v_sitem.is_active or v_sitem.creator_id is null then raise exception 'Target not found'; end if;
    v_author := v_sitem.creator_id;
    v_snapshot := jsonb_build_object('name', v_sitem.name, 'description', v_sitem.description, 'kind', v_sitem.kind,
                                     'price', v_sitem.price_kopeks, 'look', v_sitem.data);

  elsif p_target_type = 'member' then
    select * into v_prof from public.profiles where id = v_uuid;
    if not found then raise exception 'Target not found'; end if;
    v_author := v_prof.id;
    v_snapshot := jsonb_build_object('username', v_prof.username, 'display_name', v_prof.display_name, 'bio', v_prof.bio);

  else
    raise exception 'You can report a message, a private message, a project comment, a project, a blog post, a blog comment, a job offer, a shop item or a member';
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
    elsif v_rep.target_type = 'blog_post' then
      update public.blog_posts set staff_hidden = true where id = v_rep.target_id::uuid;
    elsif v_rep.target_type = 'blog_comment' then
      delete from public.blog_comments where id = v_rep.target_id::bigint;
    elsif v_rep.target_type = 'souk_item' then
      -- Taken off sale; people who own it keep it.
      update public.souk_items set is_active = false where id = v_rep.target_id::uuid;
    elsif v_rep.target_type = 'job_offer' then
      update public.job_offers set staff_hidden = true, updated_at = now() where id = v_rep.target_id::uuid;
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
