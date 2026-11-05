-- jaajef.tech  -  Migration: the social side of projects
--
--   * Stars: a member stars a listed project. Counts are public. You cannot
--     star your own project. Stars never pay a reward (nothing to farm).
--   * Comments: on listed projects. The author edits or deletes their own
--     comment; the project owner can delete any comment on their project.
--   * Ask to collaborate: a short message to the owner, who accepts or
--     declines. Accepting adds the person to a public collaborator list.
--     Requests are allowed only when the owner has switched on "available to
--     collaborate" in their profile.
--   * Every write goes through a function. Nobody writes the tables directly.
--
-- Requires the projects migration and the chat migration (chat_setting).

begin;

insert into public.game_config (key, value, status, description) values
  ('project_comment_max_per_hour', '20', 'defined', 'Most comments one member can post on projects per hour'),
  ('project_max_collaborators', '10', 'defined', 'Most collaborators one project can have'),
  ('collab_max_pending_per_member', '10', 'defined', 'Most waiting collaboration requests one member can have'),
  ('collab_max_pending_per_project', '20', 'defined', 'Most waiting collaboration requests one project can have'),
  ('collab_cooldown_days', '7', 'defined', 'Days to wait before asking again after a request was declined');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.project_stars (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_stars_user on public.project_stars (user_id);

create table public.project_comments (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index project_comments_project on public.project_comments (project_id, created_at);
create index project_comments_author on public.project_comments (author_id, created_at desc);

-- Counts for the project cards. A project with no row here has zero of both.
create table public.project_stats (
  project_id uuid primary key references public.projects (id) on delete cascade,
  star_count integer not null default 0 check (star_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0)
);

create table public.collab_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index collab_one_pending on public.collab_requests (project_id, requester_id) where status = 'pending';
create index collab_requests_owner_side on public.collab_requests (project_id, status);
create index collab_requests_requester on public.collab_requests (requester_id, status);

create table public.project_collaborators (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_collaborators_user on public.project_collaborators (user_id);

-- ---------------------------------------------------------------------
-- Helper: is this project listed for everyone (public and confirmed)?
-- ---------------------------------------------------------------------
create function public.project_is_listed(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects
     where id = p_project and is_public and verified_at is not null
  )
$$;

-- ---------------------------------------------------------------------
-- Keep the counts right (triggers; nobody calls these directly)
-- ---------------------------------------------------------------------
create function public.count_project_stars() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_stats (project_id, star_count) values (new.project_id, 1)
    on conflict (project_id) do update set star_count = public.project_stats.star_count + 1;
  else
    update public.project_stats set star_count = greatest(star_count - 1, 0) where project_id = old.project_id;
  end if;
  return null;
end $$;

create function public.count_project_comments() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_stats (project_id, comment_count) values (new.project_id, 1)
    on conflict (project_id) do update set comment_count = public.project_stats.comment_count + 1;
  else
    update public.project_stats set comment_count = greatest(comment_count - 1, 0) where project_id = old.project_id;
  end if;
  return null;
end $$;

create trigger project_stars_count after insert or delete on public.project_stars
  for each row execute function public.count_project_stars();
create trigger project_comments_count after insert or delete on public.project_comments
  for each row execute function public.count_project_comments();

-- ---------------------------------------------------------------------
-- Stars
-- ---------------------------------------------------------------------
create function public.star_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;
  select owner_id into v_owner from public.projects where id = p_project;
  if v_owner = v_me then raise exception 'You cannot star your own project'; end if;
  insert into public.project_stars (project_id, user_id) values (p_project, v_me)
  on conflict do nothing;
end $$;

create function public.unstar_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.project_stars where project_id = p_project and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------
create function public.post_project_comment(p_project uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id bigint;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write something first'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'Your comment is too long (1000 characters at most)'; end if;

  -- Lock the member so two quick posts cannot both slip under the limit.
  perform 1 from public.profiles where id = v_me for update;

  if (select count(*) from public.project_comments
       where author_id = v_me and created_at > now() - interval '1 hour')
       >= public.chat_setting('project_comment_max_per_hour') then
    raise exception 'You are commenting too fast, try again later';
  end if;

  insert into public.project_comments (project_id, author_id, body)
  values (p_project, v_me, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_project_comment(p_comment bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write something first'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'Your comment is too long (1000 characters at most)'; end if;
  update public.project_comments
     set body = btrim(p_body), edited_at = now()
   where id = p_comment and author_id = v_me;
  if not found then raise exception 'Comment not found'; end if;
end $$;

create function public.delete_project_comment(p_comment bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_c public.project_comments;
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into v_c from public.project_comments where id = p_comment;
  if not found then raise exception 'Comment not found'; end if;
  select owner_id into v_owner from public.projects where id = v_c.project_id;
  if v_c.author_id <> v_me and v_owner <> v_me then
    raise exception 'You can only delete your own comments, or comments on your own project';
  end if;
  delete from public.project_comments where id = p_comment;
end $$;

-- ---------------------------------------------------------------------
-- Ask to collaborate
-- ---------------------------------------------------------------------
create function public.request_collaboration(p_project uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_message is null or char_length(btrim(p_message)) = 0 or char_length(btrim(p_message)) > 500 then
    raise exception 'Write a short message (1 to 500 characters)';
  end if;
  if not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;

  select owner_id into v_owner from public.projects where id = p_project;
  if v_owner = v_me then raise exception 'You cannot ask to collaborate on your own project'; end if;
  if not (select available_to_collab from public.profiles where id = v_owner) then
    raise exception 'The owner is not looking for collaborators right now';
  end if;

  perform 1 from public.profiles where id = v_me for update;

  if exists (select 1 from public.project_collaborators where project_id = p_project and user_id = v_me) then
    raise exception 'You already collaborate on this project';
  end if;
  if exists (select 1 from public.collab_requests where project_id = p_project and requester_id = v_me and status = 'pending') then
    raise exception 'You already have a request waiting for this project';
  end if;
  if exists (
    select 1 from public.collab_requests
     where project_id = p_project and requester_id = v_me and status = 'declined'
       and decided_at > now() - make_interval(days => public.chat_setting('collab_cooldown_days'))
  ) then
    raise exception 'Your last request was declined; you can ask again later';
  end if;
  if (select count(*) from public.collab_requests where requester_id = v_me and status = 'pending')
       >= public.chat_setting('collab_max_pending_per_member') then
    raise exception 'You have too many requests waiting';
  end if;
  if (select count(*) from public.collab_requests where project_id = p_project and status = 'pending')
       >= public.chat_setting('collab_max_pending_per_project') then
    raise exception 'This project has too many requests waiting';
  end if;

  begin
    insert into public.collab_requests (project_id, requester_id, message)
    values (p_project, v_me, btrim(p_message))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a request waiting for this project';
  end;
  return v_id;
end $$;

create function public.withdraw_collab_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.collab_requests
     set status = 'withdrawn', decided_at = now()
   where id = p_request and requester_id = auth.uid() and status = 'pending';
  if not found then raise exception 'No waiting request found'; end if;
end $$;

create function public.decide_collab_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_req public.collab_requests;
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into v_req from public.collab_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  select owner_id into v_owner from public.projects where id = v_req.project_id;
  if v_owner is distinct from v_me then raise exception 'Only the project owner can answer a request'; end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been answered'; end if;

  if p_accept then
    if (select count(*) from public.project_collaborators where project_id = v_req.project_id)
         >= public.chat_setting('project_max_collaborators') then
      raise exception 'This project already has the most collaborators allowed';
    end if;
    insert into public.project_collaborators (project_id, user_id)
    values (v_req.project_id, v_req.requester_id)
    on conflict do nothing;
  end if;

  update public.collab_requests
     set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
   where id = p_request;
end $$;

-- The owner removes a collaborator, or a collaborator leaves.
create function public.remove_collaborator(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select owner_id into v_owner from public.projects where id = p_project;
  if not found then raise exception 'Project not found'; end if;
  if v_me <> v_owner and v_me <> p_user then
    raise exception 'Only the owner can remove someone else';
  end if;
  delete from public.project_collaborators where project_id = p_project and user_id = p_user;
  if not found then raise exception 'This person is not a collaborator'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules
-- ---------------------------------------------------------------------
alter table public.project_stars enable row level security;
alter table public.project_comments enable row level security;
alter table public.project_stats enable row level security;
alter table public.collab_requests enable row level security;
alter table public.project_collaborators enable row level security;

revoke all on public.project_stars, public.project_comments, public.project_stats,
              public.collab_requests, public.project_collaborators
  from public, anon, authenticated;

-- Public: counts, comments and collaborators of listed projects.
grant select on public.project_stats, public.project_comments, public.project_collaborators to anon, authenticated;
create policy "counts are public" on public.project_stats for select to anon, authenticated
  using (public.project_is_listed(project_id));
create policy "comments on listed projects are public" on public.project_comments for select to anon, authenticated
  using (public.project_is_listed(project_id));
create policy "collaborators of listed projects are public" on public.project_collaborators for select to anon, authenticated
  using (public.project_is_listed(project_id));

-- Private: who you starred, and requests (only the person who asked and the owner).
grant select on public.project_stars, public.collab_requests to authenticated;
create policy "own stars" on public.project_stars for select to authenticated
  using (user_id = (select auth.uid()));
create policy "requests are seen by the requester and the project owner" on public.collab_requests
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );

-- Functions
revoke execute on function public.project_is_listed(uuid) from public;
grant execute on function public.project_is_listed(uuid) to anon, authenticated, service_role;

revoke execute on function public.count_project_stars() from public, anon, authenticated;
revoke execute on function public.count_project_comments() from public, anon, authenticated;

revoke execute on function public.star_project(uuid) from public, anon;
revoke execute on function public.unstar_project(uuid) from public, anon;
revoke execute on function public.post_project_comment(uuid, text) from public, anon;
revoke execute on function public.edit_project_comment(bigint, text) from public, anon;
revoke execute on function public.delete_project_comment(bigint) from public, anon;
revoke execute on function public.request_collaboration(uuid, text) from public, anon;
revoke execute on function public.withdraw_collab_request(uuid) from public, anon;
revoke execute on function public.decide_collab_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_collaborator(uuid, uuid) from public, anon;
grant execute on function public.star_project(uuid) to authenticated;
grant execute on function public.unstar_project(uuid) to authenticated;
grant execute on function public.post_project_comment(uuid, text) to authenticated;
grant execute on function public.edit_project_comment(bigint, text) to authenticated;
grant execute on function public.delete_project_comment(bigint) to authenticated;
grant execute on function public.request_collaboration(uuid, text) to authenticated;
grant execute on function public.withdraw_collab_request(uuid) to authenticated;
grant execute on function public.decide_collab_request(uuid, boolean) to authenticated;
grant execute on function public.remove_collaborator(uuid, uuid) to authenticated;

grant all on public.project_stars, public.project_comments, public.project_stats,
             public.collab_requests, public.project_collaborators
  to service_role;

commit;
