-- jaajef.tech  -  Migration: anyone can post a job
--
--   * There is no employer profile or company approval for members any more.
--     Any member can post, and the offer goes live straight away.
--   * Behind the scenes each poster still has one small record in "employers"
--     (named after the member, or after the company name they give), so
--     applications, alerts, saved searches and the digest keep working unchanged.
--   * The limits stay: offers published per day, and offers open at once.
--     Staff can still hide an offer or suspend a member.
--   * Offers that were waiting for review are published, since nothing waits any more.
--
-- Requires: jobs_employers, jobs_applying, jobs_saved_alerts.

begin;

-- The hidden poster record. Not callable from the app.
create function public.ensure_poster(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
  v_name text;
begin
  select id, status into v_id, v_status from public.employers where owner_id = p_user;
  select coalesce(nullif(btrim(display_name), ''), username) into v_name from public.profiles where id = p_user;
  v_name := left(btrim(coalesce(v_name, '')), 100);
  if char_length(v_name) < 2 then v_name := 'Membre'; end if;

  if v_id is null then
    insert into public.employers (owner_id, kind, name, status, reviewed_at)
    values (p_user, 'individual', v_name, 'approved', now())
    returning id into v_id;
  elsif v_status <> 'approved' then
    -- An old company or profile that never passed review starts again under the member's own name.
    update public.employers
       set kind = 'individual', name = v_name, description = null, website = null, logo_url = null,
           status = 'approved', review_note = null, reviewed_at = now(), updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.ensure_poster(uuid) from public, anon, authenticated;

-- The name shown on the member's offers: a company name, or the member's own name when empty.
create function public.set_my_company_name(p_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_clean text := nullif(btrim(coalesce(p_name, '')), '');
  v_default text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  if v_clean is not null and char_length(v_clean) not between 2 and 100 then raise exception 'The company name must be 2 to 100 characters'; end if;
  perform public.ensure_poster(v_me);
  select coalesce(nullif(btrim(display_name), ''), username) into v_default from public.profiles where id = v_me;
  update public.employers
     set name = coalesce(v_clean, case when char_length(btrim(coalesce(v_default, ''))) >= 2 then left(btrim(v_default), 100) else 'Membre' end),
         updated_at = now()
   where owner_id = v_me;
end $$;
revoke execute on function public.set_my_company_name(text) from public, anon;
grant execute on function public.set_my_company_name(text) to authenticated;

create or replace function public.create_job_offer(
  p_title text, p_kind text, p_description text, p_employment_type text default null,
  p_location text default null, p_remote text default 'onsite',
  p_pay_min bigint default null, p_pay_max bigint default null, p_pay_unit text default null,
  p_pay_negotiable boolean default false, p_tags text[] default '{}', p_closes_on date default null,
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_e public.employers;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  perform public.ensure_poster(v_me);
  select * into v_e from public.employers where owner_id = v_me for update;
  perform public.job_offer_check_fields(p_title, p_kind, p_description, p_employment_type, p_location,
                                        p_remote, p_pay_min, p_pay_max, p_pay_unit, p_closes_on);

  if (select count(*) from public.job_offers where employer_id = v_e.id and status in ('draft', 'pending_review', 'published'))
       >= public.chat_setting('job_offers_max_open') then
    raise exception 'You have too many open offers: close or delete some first';
  end if;

  insert into public.job_offers (employer_id, posted_by, title, kind, description, employment_type, location, remote,
                                 pay_min_fcfa, pay_max_fcfa, pay_unit, pay_negotiable, tags, closes_on)
  values (v_e.id, v_me, btrim(p_title), p_kind, btrim(p_description), p_employment_type,
          nullif(btrim(coalesce(p_location, '')), ''), p_remote, p_pay_min, p_pay_max,
          case when p_pay_min is null and p_pay_max is null then null else p_pay_unit end,
          coalesce(p_pay_negotiable, false), public.clean_tags(p_tags), p_closes_on)
  returning id into v_id;

  if p_publish then perform public.publish_job_offer(v_id); end if;
  return v_id;
end $$;

create or replace function public.publish_job_offer(p_offer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_o public.job_offers;
  v_e public.employers;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  -- Lock the employer so two quick publications cannot both slip under the limit.
  perform public.ensure_poster(v_me);
  select e.* into v_e from public.employers e where e.owner_id = v_me for update;
  select * into v_o from public.job_offers where id = p_offer and posted_by = v_me for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_o.staff_hidden then raise exception 'This offer was hidden by staff'; end if;
  if v_o.status = 'published' then return 'published'; end if;
  if v_o.status = 'pending_review' then return 'pending_review'; end if;
  if v_o.closes_on is not null and v_o.closes_on < current_date then raise exception 'The closing day has passed: change it first'; end if;

  if v_o.published_at is null then
    if (select count(*) from public.job_offers
         where employer_id = v_e.id and published_at > now() - interval '1 day')
         >= public.chat_setting('job_offers_max_per_day') then
      raise exception 'You are publishing too fast, try again later';
    end if;
  end if;

  update public.job_offers
     set status = 'published', published_at = coalesce(published_at, now()), review_note = null, updated_at = now()
   where id = p_offer;
  return 'published';
end $$;

-- Nothing waits for review any more: the queue only ever shows legacy rows, and there are none after this file.
create or replace function public.list_review_queue()
returns table (kind text, id uuid, title text, owner_username text, employer_kind text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null then raise exception 'Only staff can see the review queue'; end if;
  return query
  select 'offer'::text, o.id, o.title, p.username, e.kind, o.created_at
    from public.job_offers o
    join public.employers e on e.id = o.employer_id
    join public.profiles p on p.id = o.posted_by
   where o.status = 'pending_review'
   order by 6, 2;
end $$;

-- Publish what was waiting, and put its poster in order.
do $$
declare r record;
begin
  for r in select distinct posted_by from public.job_offers where status = 'pending_review' loop
    perform public.ensure_poster(r.posted_by);
  end loop;
end $$;
update public.job_offers set status = 'published', published_at = coalesce(published_at, now()), review_note = null, updated_at = now()
 where status = 'pending_review';

commit;
