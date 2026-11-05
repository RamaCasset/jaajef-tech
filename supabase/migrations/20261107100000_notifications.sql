-- jaajef.tech  -  Migration: notifications (in-app inbox)
--
--   * Each member has a private inbox of short notices ("Rama starred your
--     project", "Your request to join was approved"). Read and unread.
--   * Notices are created only by the database, automatically, when something
--     happens. Nobody can create or fake one.
--   * Members read their own, mark them read, and mute the noisy kinds.
--     Warnings, suspensions and hidden-project notices can never be muted.
--   * Live updates are on, so an app can show a bell that changes by itself.
--   * Emails and phone pushes are not part of this piece.

begin;

-- The kinds of notice. One list, used by the table and by muting.
create function public.notification_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'project_starred', 'project_comment', 'project_confirmed', 'project_hidden',
    'collab_request', 'collab_accepted', 'collab_declined',
    'join_request', 'join_approved', 'join_declined',
    'badge_unlocked', 'warning', 'suspension'
  ]
$$;

-- Kinds a member can never switch off.
create function public.notification_kinds_locked()
returns text[]
language sql
immutable
as $$
  select array['warning', 'suspension', 'project_hidden']
$$;

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind = any (public.notification_kinds())),
  -- What the app needs to show it: names, titles, and the ids to link to.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  -- Stops the same notice being created twice (for example star, unstar, star).
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_inbox on public.notifications (user_id, created_at desc);
create index notifications_unread on public.notifications (user_id) where read_at is null;
create unique index notifications_no_duplicates on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

create table public.notification_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind = any (public.notification_kinds())),
  primary key (user_id, kind)
);

-- ---------------------------------------------------------------------
-- Creating a notice (internal: only the triggers below call this)
-- ---------------------------------------------------------------------
create function public.notify(p_user uuid, p_kind text, p_data jsonb default '{}'::jsonb, p_dedupe text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if not (p_kind = any (public.notification_kinds_locked()))
     and exists (select 1 from public.notification_mutes where user_id = p_user and kind = p_kind) then
    return;
  end if;
  insert into public.notifications (user_id, kind, data, dedupe_key)
  values (p_user, p_kind, coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict do nothing;
end $$;

create function public.username_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$ select username from public.profiles where id = p_user $$;

-- ---------------------------------------------------------------------
-- Triggers: what creates a notice
-- ---------------------------------------------------------------------

-- A project is starred
create function public.notify_project_starred() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_title text;
begin
  select owner_id, title into v_owner, v_title from public.projects where id = new.project_id;
  perform public.notify(v_owner, 'project_starred',
    jsonb_build_object('project_id', new.project_id, 'project_title', v_title,
                       'actor_id', new.user_id, 'actor_username', public.username_of(new.user_id)),
    'star:' || new.project_id || ':' || new.user_id);
  return null;
end $$;
create trigger project_stars_notify after insert on public.project_stars
  for each row execute function public.notify_project_starred();

-- A project is commented on
create function public.notify_project_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_title text;
begin
  select owner_id, title into v_owner, v_title from public.projects where id = new.project_id;
  if v_owner is distinct from new.author_id then
    perform public.notify(v_owner, 'project_comment',
      jsonb_build_object('project_id', new.project_id, 'project_title', v_title, 'comment_id', new.id,
                         'excerpt', left(new.body, 100),
                         'actor_id', new.author_id, 'actor_username', public.username_of(new.author_id)));
  end if;
  return null;
end $$;
create trigger project_comments_notify after insert on public.project_comments
  for each row execute function public.notify_project_comment();

-- Ask to collaborate: received, then answered
create function public.notify_collab_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_title text;
begin
  select owner_id, title into v_owner, v_title from public.projects where id = new.project_id;
  if tg_op = 'INSERT' then
    perform public.notify(v_owner, 'collab_request',
      jsonb_build_object('project_id', new.project_id, 'project_title', v_title, 'request_id', new.id,
                         'actor_id', new.requester_id, 'actor_username', public.username_of(new.requester_id)),
      'collab:' || new.id);
  elsif old.status = 'pending' and new.status in ('accepted', 'declined') then
    perform public.notify(new.requester_id, 'collab_' || new.status,
      jsonb_build_object('project_id', new.project_id, 'project_title', v_title, 'request_id', new.id),
      'collab-answer:' || new.id);
  end if;
  return null;
end $$;
create trigger collab_requests_notify after insert or update of status on public.collab_requests
  for each row execute function public.notify_collab_request();

-- Ask to join a community: the owner and moderators are told; the member hears back
create function public.notify_join_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; r record;
begin
  select name into v_name from public.communities where id = new.community_id;
  if tg_op = 'INSERT' then
    for r in
      select user_id from public.community_members
       where community_id = new.community_id and role in ('owner', 'moderator') and user_id <> new.user_id
    loop
      perform public.notify(r.user_id, 'join_request',
        jsonb_build_object('community_id', new.community_id, 'community_name', v_name, 'request_id', new.id,
                           'actor_id', new.user_id, 'actor_username', public.username_of(new.user_id)),
        'join:' || new.id);
    end loop;
  elsif old.status = 'pending' and new.status in ('approved', 'declined') then
    perform public.notify(new.user_id, 'join_' || new.status,
      jsonb_build_object('community_id', new.community_id, 'community_name', v_name, 'request_id', new.id),
      'join-answer:' || new.id);
  end if;
  return null;
end $$;
create trigger join_requests_notify after insert or update of status on public.join_requests
  for each row execute function public.notify_join_request();

-- A project is confirmed on GitHub, or hidden by staff
create function public.notify_project_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.verified_at is null and new.verified_at is not null then
    perform public.notify(new.owner_id, 'project_confirmed',
      jsonb_build_object('project_id', new.id, 'project_title', new.title),
      'confirmed:' || new.id);
  end if;
  if not old.staff_hidden and new.staff_hidden then
    perform public.notify(new.owner_id, 'project_hidden',
      jsonb_build_object('project_id', new.id, 'project_title', new.title));
  end if;
  return null;
end $$;
create trigger projects_notify after update of verified_at, staff_hidden on public.projects
  for each row execute function public.notify_project_change();

-- A warning or a suspension
create function public.notify_warning() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.user_id, 'warning', jsonb_build_object('note', new.note, 'warning_id', new.id));
  return null;
end $$;
create trigger member_warnings_notify after insert on public.member_warnings
  for each row execute function public.notify_warning();

create function public.notify_suspension() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.user_id, 'suspension', jsonb_build_object('until', new.until, 'suspension_id', new.id));
  return null;
end $$;
create trigger member_suspensions_notify after insert on public.member_suspensions
  for each row execute function public.notify_suspension();

-- A badge unlocks
create function public.notify_badge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unlocked_at is not null and (tg_op = 'INSERT' or old.unlocked_at is null) then
    perform public.notify(new.user_id, 'badge_unlocked',
      jsonb_build_object('badge_slug', new.badge_slug,
                         'badge_name', (select name from public.badges where slug = new.badge_slug)),
      'badge:' || new.badge_slug);
  end if;
  return null;
end $$;
create trigger user_badges_notify after insert or update of unlocked_at on public.user_badges
  for each row execute function public.notify_badge();

-- ---------------------------------------------------------------------
-- Members: read state and muting
-- ---------------------------------------------------------------------
create function public.mark_notification_read(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.notifications set read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Notification not found'; end if;
end $$;

create function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.notifications where user_id = auth.uid() and read_at is null
$$;

create function public.set_notification_mute(p_kind text, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_kind is null or not (p_kind = any (public.notification_kinds())) then
    raise exception 'Unknown kind of notification';
  end if;
  if p_kind = any (public.notification_kinds_locked()) then
    raise exception 'This kind of notification cannot be switched off';
  end if;
  if coalesce(p_muted, false) then
    insert into public.notification_mutes (user_id, kind) values (auth.uid(), p_kind) on conflict do nothing;
  else
    delete from public.notification_mutes where user_id = auth.uid() and kind = p_kind;
  end if;
end $$;

-- Server only: tidy old notices (read ones after 30 days, any after 90).
create function public.purge_old_notifications(p_read_days integer default 30, p_any_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.notifications
   where (read_at is not null and read_at < now() - make_interval(days => p_read_days))
      or created_at < now() - make_interval(days => p_any_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Privacy and permissions
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notification_mutes enable row level security;

revoke all on public.notifications, public.notification_mutes from public, anon, authenticated;
grant select on public.notifications, public.notification_mutes to authenticated;
create policy "own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own mutes" on public.notification_mutes for select to authenticated
  using (user_id = (select auth.uid()));

revoke execute on function public.notify(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.username_of(uuid) from public, anon, authenticated;
revoke execute on function public.notify_project_starred() from public, anon, authenticated;
revoke execute on function public.notify_project_comment() from public, anon, authenticated;
revoke execute on function public.notify_collab_request() from public, anon, authenticated;
revoke execute on function public.notify_join_request() from public, anon, authenticated;
revoke execute on function public.notify_project_change() from public, anon, authenticated;
revoke execute on function public.notify_warning() from public, anon, authenticated;
revoke execute on function public.notify_suspension() from public, anon, authenticated;
revoke execute on function public.notify_badge() from public, anon, authenticated;

revoke execute on function public.mark_notification_read(bigint) from public, anon;
revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.unread_notification_count() from public, anon;
revoke execute on function public.set_notification_mute(text, boolean) from public, anon;
grant execute on function public.mark_notification_read(bigint) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.set_notification_mute(text, boolean) to authenticated;

revoke execute on function public.purge_old_notifications(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_old_notifications(integer, integer) to service_role;

grant all on public.notifications, public.notification_mutes to service_role;

-- Live updates (row-level security still applies: each member only receives their own).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
