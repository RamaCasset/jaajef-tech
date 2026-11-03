-- =====================================================================
-- jaajef.tech  -  Migration 7: Ask to join private communities
--
-- What this does
--   * A private community can now be LISTED or HIDDEN.
--       Listed: anyone can see its name, description and member count, and ask
--               to join. Its channels, members and messages stay private.
--       Hidden: invisible to outsiders, joined only with an invite link
--               (the behaviour so far, kept for every existing community).
--   * A person asks to join a listed private community with an optional short
--     message. The owner or a moderator approves or declines.
--   * Against pestering: a limited number of pending requests per person, and a
--     waiting period after a decline.
--
-- There is no notification system yet. Owners and moderators read the pending
-- requests from the join_requests table (the app will show a counter).
--
-- Requires migrations 1 to 6.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('join_requests_max_pending', '10', 'defined', 'Most pending join requests one member can have'),
  ('join_request_cooldown_days', '7', 'defined', 'Days to wait before asking again after a decline');

-- ---------------------------------------------------------------------
-- Listed or hidden
-- ---------------------------------------------------------------------
-- Existing private communities stay hidden. New ones default to listed (see create_community).
alter table public.communities add column is_listed boolean not null default false;

drop policy "public communities are visible to everyone, private ones to their members" on public.communities;

create policy "public and listed communities are visible to everyone, hidden ones to their members"
  on public.communities for select to anon, authenticated
  using (not is_private or is_listed or public.is_member(id));

-- create_community gains one more choice, so the old version is replaced.
drop function public.create_community(text, text, text, boolean);

create function public.create_community(
  p_slug text,
  p_name text,
  p_description text default null,
  p_is_private boolean default false,
  p_is_listed boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;

  if (select count(*) from public.communities where owner_id = v_user)
       >= public.chat_setting('chat_max_communities_per_member') then
    raise exception 'You have reached the limit of communities you can create';
  end if;

  insert into public.communities (slug, name, description, is_private, is_listed, owner_id)
  values (p_slug, btrim(p_name), p_description, coalesce(p_is_private, false), coalesce(p_is_listed, true), v_user)
  returning id into v_id;

  insert into public.community_members (community_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.channels (community_id, slug, name, kind) values
    (v_id, 'general', 'general', 'chat'),
    (v_id, 'annonces', 'annonces', 'announcement');

  return v_id;
end $$;

revoke execute on function public.create_community(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.create_community(text, text, text, boolean, boolean) to authenticated;

create function public.set_community_listing(p_community uuid, p_listed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.member_role(p_community) is distinct from 'owner' then
    raise exception 'Only the owner can change this';
  end if;
  update public.communities set is_listed = coalesce(p_listed, is_listed) where id = p_community;
end $$;

-- How many people are in a community. Only for communities you are allowed to see.
create function public.community_member_count(p_community uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.id is null then null
           when not c.is_private or c.is_listed or public.is_member(c.id)
             then (select count(*)::integer from public.community_members where community_id = c.id)
         end
    from (select 1) as one
    left join public.communities c on c.id = p_community
$$;

-- ---------------------------------------------------------------------
-- Join requests
-- ---------------------------------------------------------------------
create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text check (message is null or char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);

-- One pending request per person and community.
create unique index join_requests_one_pending
  on public.join_requests (community_id, user_id) where status = 'pending';

create index join_requests_user on public.join_requests (user_id, status);
create index join_requests_community_pending on public.join_requests (community_id) where status = 'pending';

create function public.request_to_join(p_community uuid, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_comm public.communities;
  v_id uuid;
  v_last_decline timestamptz;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;

  select * into v_comm from public.communities where id = p_community;
  -- A hidden community looks the same as one that does not exist.
  if not found or (v_comm.is_private and not v_comm.is_listed and not public.is_member(p_community)) then
    raise exception 'Community not found';
  end if;

  if not v_comm.is_private then raise exception 'This community is public: just join it'; end if;
  if public.is_member(p_community) then raise exception 'You are already a member'; end if;
  if char_length(coalesce(p_message, '')) > 300 then raise exception 'Your message is too long (300 characters at most)'; end if;

  if exists (select 1 from public.join_requests
              where community_id = p_community and user_id = v_me and status = 'pending') then
    raise exception 'You already asked to join this community';
  end if;

  select max(decided_at) into v_last_decline from public.join_requests
   where community_id = p_community and user_id = v_me and status = 'declined';
  if v_last_decline is not null
     and v_last_decline > now() - make_interval(days => public.chat_setting('join_request_cooldown_days')) then
    raise exception 'Your last request was declined: please wait before asking again';
  end if;

  if (select count(*) from public.join_requests where user_id = v_me and status = 'pending')
       >= public.chat_setting('join_requests_max_pending') then
    raise exception 'You have too many pending requests';
  end if;

  insert into public.join_requests (community_id, user_id, message)
  values (p_community, v_me, nullif(btrim(coalesce(p_message, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.cancel_join_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.join_requests
     set status = 'cancelled', decided_at = now()
   where id = p_request and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Request not found'; end if;
end $$;

create function public.decide_join_request(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.join_requests;
  v_role text;
begin
  select * into v_req from public.join_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;

  v_role := public.member_role(v_req.community_id);
  if v_role is null or v_role not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can answer requests';
  end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been answered'; end if;

  if coalesce(p_approve, false) then
    insert into public.community_members (community_id, user_id, role)
    values (v_req.community_id, v_req.user_id, 'member')
    on conflict do nothing;
  end if;

  update public.join_requests
     set status = case when coalesce(p_approve, false) then 'approved' else 'declined' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_request;
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.join_requests enable row level security;

revoke all on public.join_requests from public, anon, authenticated;
grant select on public.join_requests to authenticated;

create policy "you see your own requests, owners and moderators see their community's"
  on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.member_role(community_id) in ('owner', 'moderator'));

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.set_community_listing(uuid, boolean) from public, anon;
revoke execute on function public.request_to_join(uuid, text) from public, anon;
revoke execute on function public.cancel_join_request(uuid) from public, anon;
revoke execute on function public.decide_join_request(uuid, boolean) from public, anon;
grant execute on function public.set_community_listing(uuid, boolean) to authenticated;
grant execute on function public.request_to_join(uuid, text) to authenticated;
grant execute on function public.cancel_join_request(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;

grant execute on function public.community_member_count(uuid) to anon, authenticated;

grant all on public.join_requests to service_role;

commit;
