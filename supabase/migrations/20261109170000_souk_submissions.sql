-- jaajef.tech  -  Migration: Souk creator submissions
--
--   * Any signed-in member can submit an item (theme, avatar frame or status badge)
--     with a proposed price. It waits for review.
--   * A shop manager (or shop owner or admin) approves it, optionally changing the price,
--     or rejects it with a note. They cannot review their own submission.
--   * An approved submission becomes a normal shop item with the creator recorded on it.
--   * The creator can edit or withdraw while it is pending. Limits: a few submissions per day
--     and a few waiting at once.
--   * The creator is told about the decision.
--
-- The item "data" (colours, image address...) is shown to other members, so staff review is the
-- guard. The creator's share of sales comes in the next piece.
--
-- Requires: Souk, Souk extras, back-office roles, notifications, moderation (suspended_until).

begin;

insert into public.game_config (key, value, status, description) values
  ('souk_submissions_max_per_day', '3', 'defined', 'Most item submissions one member can send per day'),
  ('souk_submissions_max_pending', '5', 'defined', 'Most item submissions one member can have waiting for review at once');

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
    'souk_submission_approved', 'souk_submission_rejected'
  ]
$$;

alter table public.souk_items add column creator_id uuid references public.profiles (id) on delete set null;
create index souk_items_creator on public.souk_items (creator_id) where creator_id is not null;

create table public.souk_submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  kind public.souk_item_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 300),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and char_length(data::text) <= 4000),
  proposed_price bigint not null check (proposed_price between 1 and 1000000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  item_id uuid references public.souk_items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('approved', 'rejected')) = (reviewed_at is not null))
);
create index souk_submissions_creator on public.souk_submissions (creator_id, created_at desc);
create index souk_submissions_queue on public.souk_submissions (created_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------
create function public.souk_check_fields(p_name text, p_description text, p_data jsonb, p_price bigint)
returns void
language plpgsql
immutable
as $$
begin
  if p_name is null or char_length(btrim(p_name)) = 0 then raise exception 'Give the item a name'; end if;
  if char_length(btrim(p_name)) > 60 then raise exception 'The name is too long (60 characters at most)'; end if;
  if char_length(coalesce(p_description, '')) > 300 then raise exception 'The description is too long (300 characters at most)'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'The look of the item must be an object'; end if;
  if char_length(p_data::text) > 4000 then raise exception 'The look of the item is too large'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then raise exception 'The price must be between 1 and 1000000 Kopeks'; end if;
end $$;

create function public.submit_souk_item(
  p_kind public.souk_item_kind, p_name text, p_description text, p_data jsonb, p_price bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if public.suspended_until(v_me) is not null then raise exception 'Your account is suspended'; end if;
  perform public.souk_check_fields(p_name, p_description, coalesce(p_data, '{}'::jsonb), p_price);

  perform 1 from public.profiles where id = v_me for update;

  if (select count(*) from public.souk_submissions where creator_id = v_me and created_at > now() - interval '1 day')
       >= public.chat_setting('souk_submissions_max_per_day') then
    raise exception 'You are submitting too fast, try again later';
  end if;
  if (select count(*) from public.souk_submissions where creator_id = v_me and status = 'pending')
       >= public.chat_setting('souk_submissions_max_pending') then
    raise exception 'You already have as many items waiting for review as allowed';
  end if;

  insert into public.souk_submissions (creator_id, kind, name, description, data, proposed_price)
  values (v_me, p_kind, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_data, '{}'::jsonb), p_price)
  returning id into v_id;
  return v_id;
end $$;

create function public.update_souk_submission(
  p_submission uuid, p_kind public.souk_item_kind, p_name text, p_description text, p_data jsonb, p_price bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  perform public.souk_check_fields(p_name, p_description, coalesce(p_data, '{}'::jsonb), p_price);
  update public.souk_submissions
     set kind = p_kind, name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
         data = coalesce(p_data, '{}'::jsonb), proposed_price = p_price, updated_at = now()
   where id = p_submission and creator_id = v_me and status = 'pending';
  if not found then raise exception 'Submission not found, or it is no longer waiting for review'; end if;
end $$;

create function public.withdraw_souk_submission(p_submission uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  update public.souk_submissions set status = 'withdrawn', updated_at = now()
   where id = p_submission and creator_id = v_me and status = 'pending';
  if not found and not exists (select 1 from public.souk_submissions where id = p_submission and creator_id = v_me) then
    raise exception 'Submission not found';
  end if;
end $$;

create function public.list_my_souk_submissions()
returns setof public.souk_submissions
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query select * from public.souk_submissions where creator_id = v_me order by created_at desc, id;
end $$;

-- ---------------------------------------------------------------------
-- Shop staff
-- ---------------------------------------------------------------------
create function public.list_souk_submissions(p_status text default 'pending', p_limit integer default 50)
returns table (
  id uuid, creator_id uuid, creator_username text, kind public.souk_item_kind, name text, description text,
  data jsonb, proposed_price bigint, status text, review_note text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.can_manage_shop() then raise exception 'Only shop staff can see the submissions'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected', 'withdrawn') then raise exception 'Unknown status'; end if;
  return query
  select s.id, s.creator_id, p.username, s.kind, s.name, s.description, s.data, s.proposed_price, s.status, s.review_note, s.created_at
    from public.souk_submissions s
    join public.profiles p on p.id = s.creator_id
   where p_status is null or s.status = p_status
   order by s.created_at, s.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

create function public.review_souk_submission(
  p_submission uuid, p_approve boolean, p_note text default null, p_price bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  s public.souk_submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_price bigint;
  v_slug text;
  v_item uuid;
begin
  if not public.can_manage_shop() then raise exception 'Only shop staff can review submissions'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'The note is too long (500 characters at most)'; end if;
  if not p_approve and v_note is null then raise exception 'Say why the item is rejected'; end if;

  select * into s from public.souk_submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'This submission has already been handled'; end if;
  if s.creator_id = v_me then raise exception 'You cannot review your own submission: ask another shop manager'; end if;

  if p_approve then
    v_price := coalesce(p_price, s.proposed_price);
    if v_price < 1 or v_price > 1000000 then raise exception 'The price must be between 1 and 1000000 Kopeks'; end if;
    v_slug := trim(both '-' from regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'));
    v_slug := left(coalesce(nullif(v_slug, ''), 'item'), 40) || '-' || left(replace(s.id::text, '-', ''), 8);
    insert into public.souk_items (slug, kind, name, description, price_kopeks, data, is_active, creator_id)
    values (v_slug, s.kind, s.name, s.description, v_price, s.data, true, s.creator_id)
    returning id into v_item;
    update public.souk_submissions
       set status = 'approved', review_note = v_note, reviewed_by = v_me, reviewed_at = now(), item_id = v_item, updated_at = now()
     where id = p_submission;
    perform public.notify(s.creator_id, 'souk_submission_approved',
      jsonb_build_object('submission_id', s.id, 'item_id', v_item, 'item_name', s.name, 'price', v_price, 'note', v_note));
  else
    update public.souk_submissions
       set status = 'rejected', review_note = v_note, reviewed_by = v_me, reviewed_at = now(), updated_at = now()
     where id = p_submission;
    perform public.notify(s.creator_id, 'souk_submission_rejected',
      jsonb_build_object('submission_id', s.id, 'item_name', s.name, 'note', v_note));
  end if;

  perform public.log_admin_action(v_me, case when p_approve then 'souk_submission_approved' else 'souk_submission_rejected' end,
                                  'souk_submission', p_submission::text,
                                  jsonb_build_object('creator_id', s.creator_id, 'item_id', v_item, 'price', v_price));
  return v_item;
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.souk_submissions enable row level security;
revoke all on public.souk_submissions from public, anon, authenticated;
grant select on public.souk_submissions to authenticated;
create policy "creators see their own submissions" on public.souk_submissions for select to authenticated
  using (creator_id = (select auth.uid()));
create policy "shop staff see every submission" on public.souk_submissions for select to authenticated
  using (public.can_manage_shop());

revoke execute on function public.souk_check_fields(text, text, jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.submit_souk_item(public.souk_item_kind, text, text, jsonb, bigint) from public, anon;
revoke execute on function public.update_souk_submission(uuid, public.souk_item_kind, text, text, jsonb, bigint) from public, anon;
revoke execute on function public.withdraw_souk_submission(uuid) from public, anon;
revoke execute on function public.list_my_souk_submissions() from public, anon;
revoke execute on function public.list_souk_submissions(text, integer) from public, anon;
revoke execute on function public.review_souk_submission(uuid, boolean, text, bigint) from public, anon;

grant execute on function public.souk_check_fields(text, text, jsonb, bigint) to service_role;
grant execute on function public.submit_souk_item(public.souk_item_kind, text, text, jsonb, bigint) to authenticated;
grant execute on function public.update_souk_submission(uuid, public.souk_item_kind, text, text, jsonb, bigint) to authenticated;
grant execute on function public.withdraw_souk_submission(uuid) to authenticated;
grant execute on function public.list_my_souk_submissions() to authenticated;
grant execute on function public.list_souk_submissions(text, integer) to authenticated;
grant execute on function public.review_souk_submission(uuid, boolean, text, bigint) to authenticated;

grant all on public.souk_submissions to service_role;

commit;
