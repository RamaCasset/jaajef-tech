-- jaajef.tech  -  Migration: project discovery
--
--   * search_projects: search and filter listed projects by text, language,
--     tag and the owner's clan, sorted by newest, most starred, trending this
--     week, or name. Works for visitors too.
--   * Featured projects: an admin picks them (at most 6), for the "project of
--     the week" spot. Logged in the audit log.
--   * Lists of languages and popular tags in use, to fill the filter menus.
--   * Trending creators: members with the most contributions in the last days.
--     A contribution is the same thing as for the badge (to be confirmed).
--
-- Only projects that are listed for everyone ever appear. Region is not a
-- filter yet because it is not a structured field on profiles.
--
-- Requires: projects, badges, staff roles, moderation (staff-hidden),
-- project social.

begin;

insert into public.game_config (key, value, status, description) values
  ('featured_projects_max', '6', 'defined', 'Most projects an admin can feature at once');

create table public.featured_projects (
  project_id uuid primary key references public.projects (id) on delete cascade,
  featured_by uuid,
  featured_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------
create function public.search_projects(
  p_query text default null,
  p_language text default null,
  p_tag text default null,
  p_clan public.clan_type default null,
  p_sort text default 'recent',
  p_featured_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  project_id uuid,
  title text,
  summary text,
  github_owner text,
  github_repo text,
  language text,
  tags text[],
  github_stars integer,
  star_count integer,
  comment_count integer,
  collaborator_count integer,
  recent_activity integer,
  is_featured boolean,
  verified_at timestamptz,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  owner_avatar_url text,
  owner_clan public.clan_type
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_sort is null or p_sort not in ('recent', 'stars', 'trending', 'name') then
    raise exception 'Sort by recent, stars, trending or name';
  end if;
  if p_query is not null and btrim(p_query) <> '' then
    v_pattern := '%' || replace(replace(replace(left(btrim(p_query), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select p.id, p.title, p.summary, p.github_owner, p.github_repo, p.language, p.tags, p.github_stars,
         coalesce(s.star_count, 0), coalesce(s.comment_count, 0),
         (select count(*)::integer from public.project_collaborators c where c.project_id = p.id),
         ((select count(*) from public.project_stars st where st.project_id = p.id and st.created_at > now() - interval '7 days')
          + (select count(*) from public.project_comments pc where pc.project_id = p.id and pc.created_at > now() - interval '7 days'))::integer,
         (f.project_id is not null),
         p.verified_at, o.id, o.username, o.display_name, o.avatar_url, o.clan
    from public.projects p
    join public.profiles o on o.id = p.owner_id
    left join public.project_stats s on s.project_id = p.id
    left join public.featured_projects f on f.project_id = p.id
   where public.project_is_listed(p.id)
     and (v_pattern is null
          or p.title ilike v_pattern or p.summary ilike v_pattern or p.github_description ilike v_pattern
          or p.github_repo ilike v_pattern or o.username ilike v_pattern or o.display_name ilike v_pattern
          or exists (select 1 from unnest(p.tags) t where t ilike v_pattern))
     and (p_language is null or lower(p.language) = lower(p_language))
     and (p_tag is null or lower(p_tag) = any (p.tags))
     and (p_clan is null or o.clan = p_clan)
     and (not coalesce(p_featured_only, false) or f.project_id is not null)
   order by
     case when p_sort = 'stars' then coalesce(s.star_count, 0) end desc nulls last,
     case when p_sort = 'trending' then
       ((select count(*) from public.project_stars st where st.project_id = p.id and st.created_at > now() - interval '7 days')
        + (select count(*) from public.project_comments pc where pc.project_id = p.id and pc.created_at > now() - interval '7 days'))
     end desc nulls last,
     case when p_sort = 'name' then lower(p.title) end asc nulls last,
     p.verified_at desc, p.id
   limit v_limit offset v_offset;
end $$;

-- ---------------------------------------------------------------------
-- Filter menus
-- ---------------------------------------------------------------------
create function public.project_languages()
returns table (language text, project_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.language, count(*)::integer
    from public.projects p
   where p.language is not null and public.project_is_listed(p.id)
   group by p.language
   order by count(*) desc, p.language
$$;

create function public.popular_project_tags(p_limit integer default 20)
returns table (tag text, project_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select t, count(*)::integer
    from public.projects p, unnest(p.tags) as t
   where public.project_is_listed(p.id)
   group by t
   order by count(*) desc, t
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ---------------------------------------------------------------------
-- Trending creators
-- ---------------------------------------------------------------------
create function public.trending_creators(p_days integer default 7, p_limit integer default 5)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  clan public.clan_type,
  contributions integer
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.username, pr.display_name, pr.avatar_url, pr.clan, count(*)::integer
    from public.messages m
    join public.channels c on c.id = m.channel_id
    join public.profiles pr on pr.id = m.author_id
   where c.kind = 'forum'
     and m.deleted_at is null
     and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
     and (select count(*) from public.community_members cm where cm.community_id = m.community_id)
           >= public.chat_setting('badge_min_community_members')
   group by pr.id
   order by count(*) desc, pr.username
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

-- ---------------------------------------------------------------------
-- Admin: feature or unfeature a project
-- ---------------------------------------------------------------------
create function public.set_featured_project(p_project uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can feature a project'; end if;

  if coalesce(p_on, false) then
    if not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;
    if not exists (select 1 from public.featured_projects where project_id = p_project)
       and (select count(*) from public.featured_projects) >= public.chat_setting('featured_projects_max') then
      raise exception 'Too many featured projects: remove one first';
    end if;
    insert into public.featured_projects (project_id, featured_by) values (p_project, auth.uid())
    on conflict (project_id) do nothing;
    if found then
      perform public.log_admin_action(auth.uid(), 'project_featured', 'project', p_project::text);
    end if;
  else
    delete from public.featured_projects where project_id = p_project;
    if found then
      perform public.log_admin_action(auth.uid(), 'project_unfeatured', 'project', p_project::text);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Privacy and permissions
-- ---------------------------------------------------------------------
alter table public.featured_projects enable row level security;
revoke all on public.featured_projects from public, anon, authenticated;
grant select on public.featured_projects to anon, authenticated;
create policy "featured projects that are listed are public" on public.featured_projects
  for select to anon, authenticated using (public.project_is_listed(project_id));
grant all on public.featured_projects to service_role;

revoke execute on function public.search_projects(text, text, text, public.clan_type, text, boolean, integer, integer) from public;
revoke execute on function public.project_languages() from public;
revoke execute on function public.popular_project_tags(integer) from public;
revoke execute on function public.trending_creators(integer, integer) from public;
revoke execute on function public.set_featured_project(uuid, boolean) from public, anon;
grant execute on function public.search_projects(text, text, text, public.clan_type, text, boolean, integer, integer) to anon, authenticated;
grant execute on function public.project_languages() to anon, authenticated;
grant execute on function public.popular_project_tags(integer) to anon, authenticated;
grant execute on function public.trending_creators(integer, integer) to anon, authenticated;
grant execute on function public.set_featured_project(uuid, boolean) to authenticated;

commit;
