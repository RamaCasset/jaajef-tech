-- jaajef.tech - Delete my account, and download my data
--
-- DELETE
--   * A member asks to delete their account. Nothing disappears yet: there is a waiting period
--     (setting account_deletion_days, 14 days, to confirm with Marie) in which they can change their mind.
--   * After that, a server job (the "account-purge" function) deletes their uploaded files, then calls purge_account.
--   * Deleting the login removes the member's data everywhere through the existing "on delete cascade" links:
--     profile, wallet and Kopeks history, XP, badges, quest attempts, projects (and the stars/comments on them),
--     community and private messages they wrote, blog posts and comments, applications, saved offers and searches,
--     Souk purchases, notifications, and so on. Souk items they created stay in the shop with no creator name.
--   * Some accounts cannot be deleted yet (the member is told why):
--       staff            an admin, moderator or back-office role must be removed first
--       suspended        a member with an active suspension cannot delete the account to escape it
--       community_owner  owns a community that still has other members (ownership cannot be transferred yet)
--       employer_active  owns an employer with published offers or applications still being handled
--   * The platform keeps one record per deletion with no name, e-mail or id: only a fingerprint of the id and the day.
--
-- EXPORT
--   * export_my_data() gives the member everything the platform holds about them, as one JSON document.
--     It contains only the member's own words and data: never other members' messages or internal staff notes.
--
-- Requires: all earlier migrations.

begin;

insert into public.game_config (key, value, status, description) values
  ('account_deletion_days', '14', 'tbc', 'Days between asking to delete an account and its deletion. To confirm with Marie');

alter table public.profiles add column deletion_requested_at timestamptz;
-- Members cannot write this column directly: they only have update rights on a short list of other columns.

create table public.account_deletion_log (
  id bigint generated always as identity primary key,
  id_fingerprint text not null,
  deleted_at timestamptz not null default now()
);
alter table public.account_deletion_log enable row level security;
revoke all on public.account_deletion_log from public, anon, authenticated;
grant all on public.account_deletion_log to service_role;
grant usage, select on sequence public.account_deletion_log_id_seq to service_role;

-- ---------------------------------------------------------------------
-- What stops an account from being deleted (internal)
-- ---------------------------------------------------------------------
create function public.account_deletion_blockers(p_user uuid)
returns table (code text, detail integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if exists (select 1 from public.staff_roles where user_id = p_user)
     or exists (select 1 from public.back_office_roles where user_id = p_user) then
    return query select 'staff'::text, 1;
  end if;

  if public.suspended_until(p_user) is not null then
    return query select 'suspended'::text, 1;
  end if;

  select count(*) into v_n from public.communities c
   where c.owner_id = p_user
     and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id <> p_user);
  if v_n > 0 then return query select 'community_owner'::text, v_n; end if;

  select (select count(*) from public.job_offers o join public.employers e on e.id = o.employer_id
           where e.owner_id = p_user and o.status = 'published')
       + (select count(*) from public.job_applications a join public.job_offers o on o.id = a.offer_id
            join public.employers e on e.id = o.employer_id
           where e.owner_id = p_user and a.status in ('submitted', 'seen', 'shortlisted'))
    into v_n;
  if v_n > 0 then return query select 'employer_active'::text, v_n; end if;
end $$;

-- ---------------------------------------------------------------------
-- Member actions
-- ---------------------------------------------------------------------
create function public.my_account_deletion()
returns table (requested_at timestamptz, delete_on timestamptz, blockers jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_req timestamptz;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select deletion_requested_at into v_req from public.profiles where id = v_me;
  return query select v_req,
    case when v_req is null then null else v_req + make_interval(days => greatest(public.chat_setting('account_deletion_days'), 0)) end,
    coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'count', b.detail)) from public.account_deletion_blockers(v_me) b), '[]'::jsonb);
end $$;

create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid(); v_codes text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select string_agg(code, ', ') into v_codes from public.account_deletion_blockers(v_me);
  if v_codes is not null then
    raise exception 'Your account cannot be deleted yet: %', v_codes;
  end if;
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now()) where id = v_me;
  return (select deletion_requested_at + make_interval(days => greatest(public.chat_setting('account_deletion_days'), 0))
            from public.profiles where id = v_me);
end $$;

create function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.profiles set deletion_requested_at = null where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Server only: the purge job
-- ---------------------------------------------------------------------
create function public.accounts_due_for_deletion(p_limit integer default 50)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
   where p.deletion_requested_at is not null
     and p.deletion_requested_at <= now() - make_interval(days => greatest(public.chat_setting('account_deletion_days'), 0))
   order by p.deletion_requested_at
   limit greatest(least(coalesce(p_limit, 50), 200), 1)
$$;

create function public.account_blockers_for(p_user uuid)
returns table (code text, detail integer)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.account_deletion_blockers(p_user)
$$;

-- A due account that can no longer be deleted (for example it became staff) goes back to normal.
create function public.abort_account_deletion(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set deletion_requested_at = null where id = p_user
$$;

-- The files each member uploaded sit in a folder named after their id, in these buckets.
create function public.account_files(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('dm-files', 'cv-files', 'souk-images')
     and (storage.foldername(o.name))[1] = p_user::text
$$;

-- Deletes the login (and so, through the links, everything of the member). Only for an account that is due.
create function public.purge_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.accounts_due_for_deletion(200) d where d.user_id = p_user
  ) then
    raise exception 'This account is not due for deletion';
  end if;
  if exists (select 1 from public.account_deletion_blockers(p_user)) then
    raise exception 'This account cannot be deleted: something now prevents it';
  end if;
  insert into public.account_deletion_log (id_fingerprint)
  values (encode(sha256(convert_to(p_user::text, 'UTF8')), 'hex'));
  delete from auth.users where id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Download my data
-- ---------------------------------------------------------------------
create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_out jsonb;
begin
  if v_me is null then raise exception 'Sign in first'; end if;

  v_out := jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email) from auth.users u where u.id = v_me),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_me),
    'wallet', (select to_jsonb(w) from public.wallets w where w.user_id = v_me),
    'kopek_history', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from (select amount, balance_after, reason, created_at from public.kopek_transactions where user_id = v_me order by created_at desc limit 5000) t), '[]'),
    'xp_history', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from (select amount, reason, created_at from public.xp_events where user_id = v_me order by created_at desc limit 5000) t), '[]'),
    'badges', coalesce((select jsonb_agg(to_jsonb(t)) from (select badge_slug, progress, unlocked_at from public.user_badges where user_id = v_me) t), '[]'),
    'quest_attempts', coalesce((select jsonb_agg(to_jsonb(t)) from (select q.slug as quest, a.status, a.code, a.tests_passed, a.tests_total, a.started_at, a.solved_at, a.hints_used from public.quest_attempts a join public.quests q on q.id = a.quest_id where a.user_id = v_me limit 5000) t), '[]'),
    'streak', jsonb_build_object(
      'activity_days', coalesce((select jsonb_agg(to_jsonb(t) order by t.day) from (select day, quests_solved from public.member_activity_days where user_id = v_me order by day desc limit 5000) t), '[]'),
      'freeze_log', coalesce((select jsonb_agg(to_jsonb(t) order by t.day) from (select day, kind, created_at from public.streak_freeze_log where user_id = v_me limit 5000) t), '[]')),
    'projects', coalesce((select jsonb_agg(to_jsonb(t)) from (select id, github_owner, github_repo, title, summary, tags, is_public, language, github_stars, verified_at, created_at from public.projects where owner_id = v_me limit 1000) t), '[]'),
    'project_comments', coalesce((select jsonb_agg(to_jsonb(t)) from (select project_id, body, created_at, edited_at from public.project_comments where author_id = v_me order by created_at desc limit 5000) t), '[]'),
    'project_stars', coalesce((select jsonb_agg(to_jsonb(t)) from (select project_id, created_at from public.project_stars where user_id = v_me limit 5000) t), '[]'),
    'collaborations', jsonb_build_object(
      'requests_sent', coalesce((select jsonb_agg(to_jsonb(t)) from (select project_id, message, status, created_at, decided_at from public.collab_requests where requester_id = v_me limit 1000) t), '[]'),
      'projects_joined', coalesce((select jsonb_agg(to_jsonb(t)) from (select project_id, added_at from public.project_collaborators where user_id = v_me limit 1000) t), '[]')),
    'blog', jsonb_build_object(
      'posts', coalesce((select jsonb_agg(to_jsonb(t)) from (select slug, title, summary, body, cover_url, tags, status, published_at, created_at from public.blog_posts where author_id = v_me limit 1000) t), '[]'),
      'comments', coalesce((select jsonb_agg(to_jsonb(t)) from (select post_id, body, created_at, edited_at from public.blog_comments where author_id = v_me order by created_at desc limit 5000) t), '[]'),
      'likes', coalesce((select jsonb_agg(to_jsonb(t)) from (select post_id, created_at from public.blog_likes where user_id = v_me limit 5000) t), '[]')),
    'communities', jsonb_build_object(
      'memberships', coalesce((select jsonb_agg(to_jsonb(t)) from (select community_id, role, joined_at from public.community_members where user_id = v_me limit 1000) t), '[]'),
      'join_requests', coalesce((select jsonb_agg(to_jsonb(t)) from (select community_id, message, status, created_at, decided_at from public.join_requests where user_id = v_me limit 1000) t), '[]'),
      'messages_written', coalesce((select jsonb_agg(to_jsonb(t)) from (select community_id, channel_id, title, body, created_at, edited_at from public.messages where author_id = v_me and deleted_at is null order by created_at desc limit 5000) t), '[]')),
    'private_messages_sent', coalesce((select jsonb_agg(to_jsonb(t)) from (select conversation_id, body, file_name, created_at, edited_at from public.direct_messages where sender_id = v_me and deleted_at is null order by created_at desc limit 5000) t), '[]'),
    'blocked_members', coalesce((select jsonb_agg(to_jsonb(t)) from (select blocked_id, created_at from public.blocks where blocker_id = v_me limit 1000) t), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(t)) from (select kind, created_at, read_at from public.notifications where user_id = v_me order by created_at desc limit 1000) t), '[]'),
    'jobs', jsonb_build_object(
      'applications', coalesce((select jsonb_agg(to_jsonb(t)) from (select offer_title, employer_name, message, profile_snapshot, cv_name, status, created_at from public.job_applications where applicant_id = v_me limit 1000) t), '[]'),
      'application_profile', (select to_jsonb(f) - 'user_id' from public.application_files f where f.user_id = v_me),
      'portfolio', coalesce((select jsonb_agg(to_jsonb(t)) from (select title, description, url, project_id, created_at from public.portfolio_items where user_id = v_me limit 1000) t), '[]'),
      'saved_offers', coalesce((select jsonb_agg(to_jsonb(t)) from (select offer_id, created_at from public.saved_offers where user_id = v_me limit 1000) t), '[]'),
      'saved_searches', coalesce((select jsonb_agg(to_jsonb(t)) from (select name, query, kind, employment_type, remote, location, tag, min_pay_fcfa, pay_unit, alerts_on, created_at from public.saved_searches where user_id = v_me limit 100) t), '[]'),
      'alert_email_on', coalesce((select email_digest from public.job_alert_settings where user_id = v_me), true),
      'employers', coalesce((select jsonb_agg(to_jsonb(t)) from (select name, kind, description, website, location, status, created_at from public.employers where owner_id = v_me limit 100) t), '[]'),
      'offers_posted', coalesce((select jsonb_agg(to_jsonb(t)) from (select title, kind, description, employment_type, location, remote, status, published_at, created_at from public.job_offers where posted_by = v_me limit 1000) t), '[]')),
    'souk', jsonb_build_object(
      'items_owned', coalesce((select jsonb_agg(to_jsonb(t)) from (select m.item_id, i.name, m.price_paid, m.acquired_at from public.member_items m join public.souk_items i on i.id = m.item_id where m.user_id = v_me limit 1000) t), '[]'),
      'equipped', coalesce((select jsonb_agg(to_jsonb(t)) from (select kind, item_id, equipped_at from public.equipped_items where user_id = v_me) t), '[]'),
      'purchases', coalesce((select jsonb_agg(to_jsonb(t)) from (select item_name, price, created_at from public.souk_sales where buyer_id = v_me limit 1000) t), '[]'),
      'sales_as_creator', coalesce((select jsonb_agg(to_jsonb(t)) from (select item_name, price, share_percent, creator_amount, created_at from public.souk_sales where creator_id = v_me limit 5000) t), '[]'),
      'submissions', coalesce((select jsonb_agg(to_jsonb(t)) from (select kind, name, description, proposed_price, status, review_note, created_at from public.souk_submissions where creator_id = v_me limit 1000) t), '[]')),
    'moderation', jsonb_build_object(
      'reports_i_made', coalesce((select jsonb_agg(to_jsonb(t)) from (select target_type, reason, note, status, created_at from public.reports where reporter_id = v_me limit 1000) t), '[]'),
      'warnings_about_me', coalesce((select jsonb_agg(to_jsonb(t)) from (select note, created_at from public.member_warnings where user_id = v_me) t), '[]'),
      'suspensions_about_me', coalesce((select jsonb_agg(to_jsonb(t)) from (select reason, until, lifted_at, created_at from public.member_suspensions where user_id = v_me) t), '[]')),
    'staff_roles', coalesce((select jsonb_agg(role) from (select role from public.staff_roles where user_id = v_me union all select role from public.back_office_roles where user_id = v_me) r), '[]')
  );
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke execute on function public.my_account_deletion() from public, anon;
revoke execute on function public.request_account_deletion() from public, anon;
revoke execute on function public.cancel_account_deletion() from public, anon;
revoke execute on function public.export_my_data() from public, anon;
revoke execute on function public.accounts_due_for_deletion(integer) from public, anon, authenticated;
revoke execute on function public.account_blockers_for(uuid) from public, anon, authenticated;
revoke execute on function public.abort_account_deletion(uuid) from public, anon, authenticated;
revoke execute on function public.account_files(uuid) from public, anon, authenticated;
revoke execute on function public.purge_account(uuid) from public, anon, authenticated;

grant execute on function public.my_account_deletion() to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;
grant execute on function public.accounts_due_for_deletion(integer) to service_role;
grant execute on function public.account_blockers_for(uuid) to service_role;
grant execute on function public.abort_account_deletion(uuid) to service_role;
grant execute on function public.account_files(uuid) to service_role;
grant execute on function public.purge_account(uuid) to service_role;

commit;
