-- Learning paths: one curriculum per clan.
-- A path is an ordered list of steps. A step is a short lesson, and may be linked to a quest.
-- A step with a quest is done when the member solves that quest. A step without one is done
-- when the member marks the lesson as read. Anyone signed in can follow any clan's path.

create table public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  clan public.clan_type not null,
  title text not null,
  summary text,
  position integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_paths_clan_idx on public.learning_paths (clan, position);

create trigger learning_paths_updated_at
  before update on public.learning_paths
  for each row execute function public.set_updated_at();

create table public.learning_steps (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.learning_paths (id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null,
  lesson_md text not null default '',
  mastery public.mastery_type,
  quest_id uuid references public.quests (id) on delete set null,
  est_minutes integer check (est_minutes is null or est_minutes > 0),
  unique (path_id, position)
);
create index learning_steps_quest_idx on public.learning_steps (quest_id);

create table public.learning_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  step_id uuid not null references public.learning_steps (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, step_id)
);

alter table public.learning_paths enable row level security;
alter table public.learning_steps enable row level security;
alter table public.learning_reads enable row level security;

create policy learning_paths_read on public.learning_paths
  for select to authenticated using (published);
create policy learning_steps_read on public.learning_steps
  for select to authenticated
  using (exists (select 1 from public.learning_paths p where p.id = path_id and p.published));
create policy learning_reads_own on public.learning_reads
  for select to authenticated using (user_id = auth.uid());
-- Writing a "read" goes only through mark_step_read below.

grant select on public.learning_paths, public.learning_steps, public.learning_reads to authenticated;
grant all on public.learning_paths, public.learning_steps, public.learning_reads to service_role;

-- Is this step done for this member?
create function public.learning_step_done(p_user uuid, p_step uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.quest_id is not null then exists (
      select 1 from public.quest_attempts a
       where a.user_id = p_user and a.quest_id = s.quest_id and a.status = 'solved')
    else exists (
      select 1 from public.learning_reads r where r.user_id = p_user and r.step_id = s.id)
  end
  from public.learning_steps s
  where s.id = p_step
$$;
revoke execute on function public.learning_step_done(uuid, uuid) from public, anon, authenticated;

-- The published paths, with how far I am in each.
create function public.list_learning_paths()
returns table (
  id uuid,
  slug text,
  clan public.clan_type,
  title text,
  summary text,
  steps_total bigint,
  steps_done bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.slug, p.clan, p.title, p.summary,
         count(s.id),
         count(s.id) filter (where public.learning_step_done(auth.uid(), s.id))
    from public.learning_paths p
    left join public.learning_steps s on s.path_id = p.id
   where auth.uid() is not null and p.published
   group by p.id
   order by p.position, p.title
$$;

-- The steps of one path, in order, with my progress.
create function public.list_learning_steps(p_path text)
returns table (
  id uuid,
  step_no integer,
  title text,
  lesson_md text,
  mastery public.mastery_type,
  est_minutes integer,
  quest_slug text,
  quest_title text,
  quest_xp integer,
  quest_kopeks bigint,
  quest_status text,
  done boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.position, s.title, s.lesson_md, s.mastery,
         coalesce(s.est_minutes, q.est_minutes),
         q.slug, q.title, q.xp_reward, q.kopek_reward,
         (select a.status from public.quest_attempts a where a.user_id = auth.uid() and a.quest_id = q.id),
         public.learning_step_done(auth.uid(), s.id)
    from public.learning_paths p
    join public.learning_steps s on s.path_id = p.id
    left join public.quests q on q.id = s.quest_id and q.published
   where auth.uid() is not null and p.published and p.slug = p_path
   order by s.position
$$;

-- "I have read this lesson."
create function public.mark_step_read(p_step uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not exists (
    select 1 from public.learning_steps s join public.learning_paths p on p.id = s.path_id
     where s.id = p_step and p.published) then
    raise exception 'step_not_found';
  end if;
  insert into public.learning_reads (user_id, step_id) values (auth.uid(), p_step)
  on conflict do nothing;
end
$$;

revoke execute on function public.list_learning_paths() from public, anon;
revoke execute on function public.list_learning_steps(text) from public, anon;
revoke execute on function public.mark_step_read(uuid) from public, anon;
grant execute on function public.list_learning_paths() to authenticated;
grant execute on function public.list_learning_steps(text) to authenticated;
grant execute on function public.mark_step_read(uuid) to authenticated;
