-- jaajef.tech  -  Migration: applicant counts for offer owners, and reminders for offers left open
--
--   * my_offer_applicant_counts(): for each of the caller's offers, how many applications
--     it has and how many have not been looked at yet. Shown on the "Mes offres" tab.
--   * An offer that has been published for 90 days (setting job_offer_stale_days) sends
--     its owner a notice asking them to close it. While the offer stays open the notice
--     comes again every 30 days. One notice per offer per 30-day period, however often
--     the job runs. The job itself is send_stale_offer_reminders(), meant to run once a day
--     (see docs/JOB_REMINDERS_SETUP.md); only the server can run it.
--
-- Requires: open_job_posting, notifications.

begin;

insert into public.game_config (key, value, status, description) values
  ('job_offer_stale_days', '90', 'defined', 'Days a published offer stays open before its owner is reminded to close it')
on conflict (key) do nothing;

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
    'mention', 'quest_completed',
    'job_offer_stale'
  ]
$$;

create function public.my_offer_applicant_counts()
returns table (offer_id uuid, total integer, unseen integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select o.id,
         count(a.id)::integer,
         (count(a.id) filter (where a.status = 'submitted'))::integer
    from public.job_offers o
    left join public.job_applications a
           on a.offer_id = o.id and public.application_is_open(a.status, a.declined_at, a.offer_closed_at)
   where o.posted_by = auth.uid()
   group by o.id;
end $$;
revoke execute on function public.my_offer_applicant_counts() from public, anon;
grant execute on function public.my_offer_applicant_counts() to authenticated;

create function public.send_stale_offer_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_days integer := public.chat_setting('job_offer_stale_days');
  v_n integer := 0;
begin
  for r in
    select o.id, o.title, o.posted_by, floor(extract(epoch from now() - o.published_at) / 86400)::integer as open_days
      from public.job_offers o
     where o.status = 'published' and not o.staff_hidden
       and o.published_at <= now() - make_interval(days => v_days)
       and public.suspended_until(o.posted_by) is null
  loop
    perform public.notify(r.posted_by, 'job_offer_stale',
      jsonb_build_object('offer_id', r.id, 'offer_title', r.title, 'days', r.open_days),
      'jobstale:' || r.id || ':' || (r.open_days / 30));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.send_stale_offer_reminders() from public, anon, authenticated;
grant execute on function public.send_stale_offer_reminders() to service_role;

commit;
