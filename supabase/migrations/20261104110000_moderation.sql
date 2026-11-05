-- =====================================================================
-- jaajef.tech  -  Migration 8: Reports and moderation
--
-- What this does
--   * Members can report a community message, a private message, a project or
--     another member, with a reason and an optional note.
--   * Private messages stay private: moderators cannot read conversations. When a
--     private message is reported, ONLY that message is copied into the report.
--     Every report keeps a copy ("snapshot") of what was reported, so evidence
--     survives edits and deletions.
--   * Moderators and admins read the reports and can: dismiss, remove the
--     content, warn the author, or suspend the author.
--   * Suspensions are enforced in the database: a suspended member cannot post,
--     send private messages, list projects, create communities, or ask to join,
--     until the suspension ends or an admin lifts it.
--   * Rules about who can do what:
--       - Moderators suspend for up to 7 days, admins for up to 365 days.
--       - Nobody can warn or suspend an admin through reports.
--       - Only an admin can warn or suspend a moderator.
--       - Only an admin can lift a suspension or restore a hidden project.
--   * Every staff action is written to the permanent audit log.
--   * A member can send a limited number of reports per day.
--
-- Not in this migration: reporting a whole community, appeals, and automatic
-- sanctions (for example after three warnings).
--
-- Requires migrations 1 to 7 (it uses staff roles and the audit log).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('report_max_per_day', '10', 'defined', 'Most reports one member can send per day'),
  ('moderator_max_suspension_days', '7', 'defined', 'Longest suspension a moderator can give'),
  ('admin_max_suspension_days', '365', 'defined', 'Longest suspension an admin can give');

-- ---------------------------------------------------------------------
-- Projects hidden by staff (the owner cannot undo it)
-- ---------------------------------------------------------------------
alter table public.projects add column staff_hidden boolean not null default false;

drop policy "verified public projects are visible to everyone, pending ones only to their owner" on public.projects;

create policy "verified public projects are visible to everyone, pending ones only to their owner"
  on public.projects for select to anon, authenticated
  using ((is_public and verified_at is not null and not staff_hidden) or owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('message', 'direct_message', 'project', 'member')),
  target_id text not null,
  -- the member responsible for what was reported
  target_author_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'scam', 'other')),
  note text check (note is null or char_length(note) <= 500),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  action text check (action in ('dismiss', 'remove_content', 'warn_member', 'suspend_member')),
  handled_by uuid,
  handled_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now()
);

-- One open report per person and target.
create unique index reports_one_open_per_reporter
  on public.reports (reporter_id, target_type, target_id) where status = 'open';

create index reports_queue on public.reports (status, created_at);
create index reports_target on public.reports (target_type, target_id);
create index reports_reporter_recent on public.reports (reporter_id, created_at desc);

create table public.member_warnings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.reports (id) on delete set null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index member_warnings_user on public.member_warnings (user_id);

create table public.member_suspensions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.reports (id) on delete set null,
  reason text,
  until timestamptz not null,
  lifted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index member_suspensions_active on public.member_suspensions (user_id, until);

-- ---------------------------------------------------------------------
-- Suspension: who is suspended, and enforcement
-- ---------------------------------------------------------------------
create function public.suspended_until(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(until) from public.member_suspensions
   where user_id = p_user and lifted_at is null and until > now()
$$;

-- Refuses a new row when the member who writes it is suspended.
-- The column that holds the member is given as the trigger's argument.
-- On updates it only checks a change of text, so staff can still wipe a message.
create function public.refuse_if_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_user uuid := (v_row ->> tg_argv[0])::uuid;
  v_until timestamptz;
begin
  if tg_op = 'UPDATE' then
    if coalesce(v_row ->> 'body', '') = '' or (v_row ->> 'body') is not distinct from (to_jsonb(old) ->> 'body') then
      return new;
    end if;
  end if;

  v_until := public.suspended_until(v_user);
  if v_until is not null then
    raise exception 'Your account is suspended until %', to_char(v_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"');
  end if;
  return new;
end $$;

create trigger messages_suspension before insert or update of body on public.messages
  for each row execute function public.refuse_if_suspended('author_id');
create trigger direct_messages_suspension before insert or update of body on public.direct_messages
  for each row execute function public.refuse_if_suspended('sender_id');
create trigger projects_suspension before insert on public.projects
  for each row execute function public.refuse_if_suspended('owner_id');
create trigger communities_suspension before insert on public.communities
  for each row execute function public.refuse_if_suspended('owner_id');
create trigger conversations_started_suspension before insert on public.conversations_started
  for each row execute function public.refuse_if_suspended('starter_id');

-- ---------------------------------------------------------------------
-- Members: report something
-- ---------------------------------------------------------------------
create function public.report_content(
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
    if p_target_type in ('message', 'direct_message') then v_bigint := p_target_id::bigint; end if;
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

  elsif p_target_type = 'member' then
    select * into v_prof from public.profiles where id = v_uuid;
    if not found then raise exception 'Target not found'; end if;
    v_author := v_prof.id;
    v_snapshot := jsonb_build_object('username', v_prof.username, 'display_name', v_prof.display_name, 'bio', v_prof.bio);

  else
    raise exception 'You can report a message, a private message, a project or a member';
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

-- ---------------------------------------------------------------------
-- Staff: the queue, and the actions
-- ---------------------------------------------------------------------
create function public.list_reports(p_status text default 'open', p_limit integer default 50)
returns table (
  report_id uuid,
  target_type text,
  target_id text,
  target_author_id uuid,
  target_author_username text,
  reporter_username text,
  reason text,
  note text,
  snapshot jsonb,
  status text,
  created_at timestamptz,
  open_reports_on_same_target bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.staff_role() is null then raise exception 'Only staff can do this'; end if;
  return query
    select r.id, r.target_type, r.target_id, r.target_author_id, a.username, p.username,
           r.reason, r.note, r.snapshot, r.status, r.created_at,
           (select count(*) from public.reports o
             where o.target_type = r.target_type and o.target_id = r.target_id and o.status = 'open')
      from public.reports r
      join public.profiles a on a.id = r.target_author_id
      join public.profiles p on p.id = r.reporter_id
     where r.status = coalesce(p_status, r.status)
     order by r.created_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create function public.resolve_report(
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

create function public.lift_suspension(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;

  update public.member_suspensions set lifted_at = now()
   where user_id = p_user and lifted_at is null and until > now();
  if not found then raise exception 'That member is not suspended'; end if;

  perform public.log_admin_action(auth.uid(), 'suspension_lifted', 'member', p_user::text);
end $$;

create function public.staff_restore_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;

  update public.projects set staff_hidden = false where id = p_project and staff_hidden;
  if not found then raise exception 'That project is not hidden'; end if;

  perform public.log_admin_action(auth.uid(), 'project_restored', 'project', p_project::text);
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.reports enable row level security;
alter table public.member_warnings enable row level security;
alter table public.member_suspensions enable row level security;

revoke all on public.reports, public.member_warnings, public.member_suspensions from public, anon, authenticated;
grant select on public.reports, public.member_warnings, public.member_suspensions to authenticated;

create policy "you see your own reports, staff see all"
  on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.staff_role() is not null);

create policy "you see your own warnings, staff see all"
  on public.member_warnings for select to authenticated
  using (user_id = auth.uid() or public.staff_role() is not null);

create policy "you see your own suspensions, staff see all"
  on public.member_suspensions for select to authenticated
  using (user_id = auth.uid() or public.staff_role() is not null);

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.report_content(text, text, text, text) from public, anon;
revoke execute on function public.list_reports(text, integer) from public, anon;
revoke execute on function public.resolve_report(uuid, text, text, integer) from public, anon;
revoke execute on function public.lift_suspension(uuid) from public, anon;
revoke execute on function public.staff_restore_project(uuid) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated;
grant execute on function public.list_reports(text, integer) to authenticated;
grant execute on function public.resolve_report(uuid, text, text, integer) to authenticated;
grant execute on function public.lift_suspension(uuid) to authenticated;
grant execute on function public.staff_restore_project(uuid) to authenticated;

revoke execute on function public.suspended_until(uuid) from public, anon, authenticated;
revoke execute on function public.refuse_if_suspended() from public, anon, authenticated;
grant execute on function public.suspended_until(uuid) to service_role;

grant all on public.reports, public.member_warnings, public.member_suspensions to service_role;

commit;
