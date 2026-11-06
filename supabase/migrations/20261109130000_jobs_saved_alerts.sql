-- Jobs part 4: saved offers, saved searches and job alerts.
--
--   * A member can save offers (a bookmark list) and save searches.
--   * A saved search can have alerts on: when a new offer is listed that matches,
--     the member gets an in-app notice (one per offer, even if several searches match).
--   * The daily email summary: this file keeps the data (who has unsent matches) and
--     two service-only functions for the email sender. Sending needs an email service
--     and is not part of this file. A member can turn the email off.
--
-- Requires: Jobs parts 1 to 3, notifications.

begin;

insert into public.game_config (key, value, status, description) values
  ('saved_offers_max', '200', 'defined', 'Most offers one member can save'),
  ('saved_searches_max', '10', 'defined', 'Most saved searches one member can keep');

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
    'job_alert'
  ]
$$;

-- ---------------------------------------------------------------------
-- Tables (read-only for members; changes go through the functions)
-- ---------------------------------------------------------------------
create table public.saved_offers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  offer_id uuid not null references public.job_offers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, offer_id)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  query text check (char_length(query) <= 80),
  kind text check (kind in ('job', 'freelance')),
  employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'internship')),
  remote text check (remote in ('onsite', 'hybrid', 'remote')),
  location text check (char_length(location) <= 80),
  tag text check (tag ~ '^[a-z0-9+#.-]{2,24}$'),
  min_pay_fcfa bigint check (min_pay_fcfa between 0 and 100000000000),
  pay_unit text check (pay_unit in ('hour', 'day', 'month', 'year', 'project')),
  alerts_on boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_pay_fcfa is null or pay_unit is not null),
  check (query is not null or kind is not null or employment_type is not null or remote is not null
         or location is not null or tag is not null or min_pay_fcfa is not null)
);
create index saved_searches_user on public.saved_searches (user_id, created_at desc);
create index saved_searches_alerts on public.saved_searches (id) where alerts_on;

-- One row per member and offer that matched an alert. Used for the daily email.
create table public.job_alert_matches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  offer_id uuid not null references public.job_offers (id) on delete cascade,
  search_id uuid references public.saved_searches (id) on delete set null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  primary key (user_id, offer_id)
);
create index job_alert_matches_unsent on public.job_alert_matches (user_id) where emailed_at is null;

create table public.job_alert_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_digest boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Matching (internal)
-- ---------------------------------------------------------------------
create function public.offer_matches_search(p_offer uuid, p_search uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.job_offers o
      join public.employers e on e.id = o.employer_id
      join public.saved_searches s on s.id = p_search
     where o.id = p_offer
       and (s.query is null
            or o.title ilike '%' || replace(replace(replace(s.query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or e.name ilike '%' || replace(replace(replace(s.query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or exists (select 1 from unnest(o.tags) t
                        where t ilike '%' || replace(replace(replace(s.query, '\', '\\'), '%', '\%'), '_', '\_') || '%'))
       and (s.kind is null or o.kind = s.kind)
       and (s.employment_type is null or o.employment_type = s.employment_type)
       and (s.remote is null or o.remote = s.remote)
       and (s.location is null
            or o.location ilike '%' || replace(replace(replace(s.location, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       and (s.tag is null or s.tag = any (o.tags))
       and (s.min_pay_fcfa is null
            or (o.pay_unit = s.pay_unit and coalesce(o.pay_max_fcfa, o.pay_min_fcfa) >= s.min_pay_fcfa))
  )
$$;

-- When an offer becomes published and listed, tell the members whose alerts match.
create function public.send_job_alerts() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_title text;
  v_employer text;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return null; end if;
  if not public.job_offer_is_listed(new.id) then return null; end if;
  select o.title, e.name into v_title, v_employer
    from public.job_offers o join public.employers e on e.id = o.employer_id where o.id = new.id;

  for r in
    select distinct on (s.user_id) s.user_id, s.id as search_id, s.name as search_name
      from public.saved_searches s
     where s.alerts_on
       and s.user_id <> new.posted_by
       and public.suspended_until(s.user_id) is null
       and public.offer_matches_search(new.id, s.id)
     order by s.user_id, s.created_at
  loop
    insert into public.job_alert_matches (user_id, offer_id, search_id)
    values (r.user_id, new.id, r.search_id)
    on conflict do nothing;
    perform public.notify(r.user_id, 'job_alert',
      jsonb_build_object('offer_id', new.id, 'offer_title', v_title, 'employer_name', v_employer,
                         'search_id', r.search_id, 'search_name', r.search_name),
      'jobalert:' || new.id || ':' || r.user_id);
  end loop;
  return null;
end $$;

create trigger job_offers_send_alerts after insert or update of status on public.job_offers
  for each row execute function public.send_job_alerts();

-- ---------------------------------------------------------------------
-- Saved offers
-- ---------------------------------------------------------------------
create function public.save_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.saved_offers where user_id = v_me and offer_id = p_offer) then return; end if;
  if not public.job_offer_is_listed(p_offer) then raise exception 'Offer not found'; end if;
  if (select count(*) from public.saved_offers where user_id = v_me) >= public.chat_setting('saved_offers_max') then
    raise exception 'You have saved as many offers as allowed. Remove some first.';
  end if;
  insert into public.saved_offers (user_id, offer_id) values (v_me, p_offer);
end $$;

create function public.unsave_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  delete from public.saved_offers where user_id = v_me and offer_id = p_offer;
end $$;

-- Saved offers, newest first. is_listed is false when the offer was closed or taken off the board.
create function public.list_saved_offers(p_limit integer default 50, p_offset integer default 0)
returns table (
  offer_id uuid, title text, kind text, location text, remote text, employer_name text,
  closes_on date, is_listed boolean, saved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query
  select o.id, o.title, o.kind, o.location, o.remote, e.name, o.closes_on,
         public.job_offer_is_listed(o.id), s.created_at
    from public.saved_offers s
    join public.job_offers o on o.id = s.offer_id
    join public.employers e on e.id = o.employer_id
   where s.user_id = v_me
   order by s.created_at desc, o.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Saved searches
-- ---------------------------------------------------------------------
create function public.create_saved_search(
  p_name text, p_query text default null, p_kind text default null, p_employment_type text default null,
  p_remote text default null, p_location text default null, p_tag text default null,
  p_min_pay bigint default null, p_pay_unit text default null, p_alerts_on boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_place text := nullif(btrim(coalesce(p_location, '')), '');
  v_tag text := nullif(lower(btrim(coalesce(p_tag, ''))), '');
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if v_name is null then raise exception 'Give the search a name'; end if;
  if char_length(v_name) > 60 then raise exception 'The name is too long (60 characters at most)'; end if;
  if char_length(coalesce(v_query, '')) > 80 or char_length(coalesce(v_place, '')) > 80 then
    raise exception 'The search words are too long (80 characters at most)';
  end if;
  if v_tag is not null and v_tag !~ '^[a-z0-9+#.-]{2,24}$' then raise exception 'That tag is not valid'; end if;
  if p_kind is not null and p_kind not in ('job', 'freelance') then raise exception 'Unknown kind of offer'; end if;
  if p_employment_type is not null and p_employment_type not in ('full_time', 'part_time', 'contract', 'internship') then
    raise exception 'Unknown employment type';
  end if;
  if p_remote is not null and p_remote not in ('onsite', 'hybrid', 'remote') then raise exception 'Unknown remote option'; end if;
  if p_min_pay is not null and p_pay_unit is null then raise exception 'Say what the pay is for (hour, day, month, year or project)'; end if;
  if p_pay_unit is not null and p_pay_unit not in ('hour', 'day', 'month', 'year', 'project') then raise exception 'Unknown pay unit'; end if;
  if p_min_pay is not null and p_min_pay < 0 then raise exception 'The pay cannot be negative'; end if;
  if v_query is null and p_kind is null and p_employment_type is null and p_remote is null
     and v_place is null and v_tag is null and p_min_pay is null then
    raise exception 'Choose at least one filter to save a search';
  end if;
  if (select count(*) from public.saved_searches where user_id = v_me) >= public.chat_setting('saved_searches_max') then
    raise exception 'You have saved as many searches as allowed. Delete one first.';
  end if;
  insert into public.saved_searches (user_id, name, query, kind, employment_type, remote, location, tag, min_pay_fcfa, pay_unit, alerts_on)
  values (v_me, v_name, v_query, p_kind, p_employment_type, p_remote, v_place, v_tag, p_min_pay,
          case when p_min_pay is null then null else p_pay_unit end, coalesce(p_alerts_on, true))
  returning id into v_id;
  return v_id;
end $$;

create function public.delete_saved_search(p_search uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  delete from public.saved_searches where id = p_search and user_id = v_me;
end $$;

create function public.set_saved_search_alerts(p_search uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_on is null then raise exception 'Say whether alerts are on or off'; end if;
  update public.saved_searches set alerts_on = p_on
   where id = p_search and user_id = v_me and alerts_on is distinct from p_on;
  if not found and not exists (select 1 from public.saved_searches where id = p_search and user_id = v_me) then
    raise exception 'Search not found';
  end if;
end $$;

create function public.list_saved_searches()
returns setof public.saved_searches
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query select * from public.saved_searches where user_id = v_me order by created_at desc, id;
end $$;

-- Run a saved search now (same results as the job board with those filters).
create function public.run_saved_search(p_search uuid, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, title text, kind text, employment_type text, location text, remote text,
  pay_min_fcfa bigint, pay_max_fcfa bigint, pay_unit text, pay_negotiable boolean, tags text[],
  closes_on date, published_at timestamptz,
  employer_id uuid, employer_name text, employer_kind text, employer_logo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  s public.saved_searches;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into s from public.saved_searches where saved_searches.id = p_search and user_id = v_me;
  if not found then raise exception 'Search not found'; end if;
  return query
  select * from public.search_job_offers(s.query, s.kind, s.employment_type, s.remote, s.location, s.tag,
                                         s.min_pay_fcfa, s.pay_unit, 'recent', p_limit, p_offset);
end $$;

-- ---------------------------------------------------------------------
-- Email summary settings and the data for the daily email
-- ---------------------------------------------------------------------
create function public.set_job_alert_email(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_on is null then raise exception 'Say whether the email is on or off'; end if;
  insert into public.job_alert_settings (user_id, email_digest) values (v_me, p_on)
  on conflict (user_id) do update set email_digest = excluded.email_digest, updated_at = now();
end $$;

create function public.my_job_alert_settings()
returns table (email_digest boolean, unread_matches bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query
  select coalesce((select s.email_digest from public.job_alert_settings s where s.user_id = v_me), true),
         (select count(*) from public.job_alert_matches m where m.user_id = v_me and m.emailed_at is null);
end $$;

-- For the email sender only (service role). Members with unsent matches from the last 3 days,
-- whose email is on, with the offers that are still listed.
create function public.job_digest_pending()
returns table (user_id uuid, email text, offers jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text,
         jsonb_agg(jsonb_build_object('offer_id', o.id, 'title', o.title, 'employer_name', e.name,
                                      'search_name', s.name) order by m.created_at desc)
    from public.job_alert_matches m
    join auth.users u on u.id = m.user_id
    join public.job_offers o on o.id = m.offer_id
    join public.employers e on e.id = o.employer_id
    left join public.saved_searches s on s.id = m.search_id
   where m.emailed_at is null
     and m.created_at > now() - interval '3 days'
     and public.job_offer_is_listed(o.id)
     and coalesce((select js.email_digest from public.job_alert_settings js where js.user_id = m.user_id), true)
   group by m.user_id, u.email
$$;

-- Called by the email sender after sending: marks every unsent match of these members as sent.
-- Also marks the matches of members who turned the email off or whose matches are older than 3 days,
-- so the list does not grow.
create function public.mark_job_digest_sent(p_users uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  update public.job_alert_matches set emailed_at = now()
   where emailed_at is null and user_id = any (coalesce(p_users, '{}'::uuid[]));
  get diagnostics v_n = row_count;
  update public.job_alert_matches m set emailed_at = now()
   where m.emailed_at is null
     and (m.created_at <= now() - interval '3 days'
          or not coalesce((select js.email_digest from public.job_alert_settings js where js.user_id = m.user_id), true));
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.saved_offers enable row level security;
alter table public.saved_searches enable row level security;
alter table public.job_alert_matches enable row level security;
alter table public.job_alert_settings enable row level security;
revoke all on public.saved_offers, public.saved_searches, public.job_alert_matches, public.job_alert_settings
  from public, anon, authenticated;

grant select on public.saved_offers, public.saved_searches, public.job_alert_settings to authenticated;
create policy "members see their saved offers" on public.saved_offers for select to authenticated
  using (user_id = (select auth.uid()));
create policy "members see their saved searches" on public.saved_searches for select to authenticated
  using (user_id = (select auth.uid()));
create policy "members see their alert settings" on public.job_alert_settings for select to authenticated
  using (user_id = (select auth.uid()));

revoke execute on function public.offer_matches_search(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.send_job_alerts() from public, anon, authenticated;
revoke execute on function public.save_offer(uuid) from public, anon;
revoke execute on function public.unsave_offer(uuid) from public, anon;
revoke execute on function public.list_saved_offers(integer, integer) from public, anon;
revoke execute on function public.create_saved_search(text, text, text, text, text, text, text, bigint, text, boolean) from public, anon;
revoke execute on function public.delete_saved_search(uuid) from public, anon;
revoke execute on function public.set_saved_search_alerts(uuid, boolean) from public, anon;
revoke execute on function public.list_saved_searches() from public, anon;
revoke execute on function public.run_saved_search(uuid, integer, integer) from public, anon;
revoke execute on function public.set_job_alert_email(boolean) from public, anon;
revoke execute on function public.my_job_alert_settings() from public, anon;
revoke execute on function public.job_digest_pending() from public, anon, authenticated;
revoke execute on function public.mark_job_digest_sent(uuid[]) from public, anon, authenticated;

grant execute on function public.save_offer(uuid) to authenticated;
grant execute on function public.unsave_offer(uuid) to authenticated;
grant execute on function public.list_saved_offers(integer, integer) to authenticated;
grant execute on function public.create_saved_search(text, text, text, text, text, text, text, bigint, text, boolean) to authenticated;
grant execute on function public.delete_saved_search(uuid) to authenticated;
grant execute on function public.set_saved_search_alerts(uuid, boolean) to authenticated;
grant execute on function public.list_saved_searches() to authenticated;
grant execute on function public.run_saved_search(uuid, integer, integer) to authenticated;
grant execute on function public.set_job_alert_email(boolean) to authenticated;
grant execute on function public.my_job_alert_settings() to authenticated;
grant execute on function public.job_digest_pending() to service_role;
grant execute on function public.mark_job_digest_sent(uuid[]) to service_role;

grant all on public.saved_offers, public.saved_searches, public.job_alert_matches, public.job_alert_settings to service_role;

commit;
