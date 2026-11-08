-- Project showcase: region, demo link, cover image, forks and last update.
--
--   * A member picks a region on their profile (the 14 regions of Senegal, West Africa, the rest of Africa,
--     or the diaspora). A project takes the region of its owner. Projects can be filtered by region.
--   * A project owner can add a demo link (https only, the demo runs elsewhere) and a cover image
--     (PNG, JPEG or WebP, 2 MB at most, in a public bucket "project-covers", in a folder named after the owner).
--   * The GitHub checker also records the number of forks and the date of the last push.
--   * The project list can show the people who work on each project (the owner, then collaborators).

begin;

-- ---------------------------------------------------------------------
-- Region on the profile
-- ---------------------------------------------------------------------
alter table public.profiles add column region text check (region in (
  'dakar', 'thies', 'diourbel', 'fatick', 'kaolack', 'kaffrine', 'kedougou', 'kolda', 'louga', 'matam',
  'saint_louis', 'sedhiou', 'tambacounda', 'ziguinchor', 'afrique_ouest', 'afrique_autre', 'diaspora'));
grant update (region) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Projects: demo, cover, forks, last push
-- ---------------------------------------------------------------------
alter table public.projects
  add column demo_url text check (demo_url is null or (demo_url ~ '^https://[^\s]+$' and char_length(demo_url) <= 300)),
  add column cover_path text check (cover_path is null or cover_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  add column github_forks integer not null default 0 check (github_forks >= 0),
  add column github_pushed_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-covers', 'project-covers', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "owners upload a project cover into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-covers'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(png|jpg|webp)$'));

create policy "owners see their own project covers"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owners delete their own project covers"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- The owner sets or clears the demo link and the cover. Returns the previous cover path when it was replaced or
-- removed, so the app can delete that file. A null demo link or cover clears it.
create function public.set_project_showcase(p_project uuid, p_demo_url text, p_cover_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_demo text := nullif(btrim(coalesce(p_demo_url, '')), '');
  v_old text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if v_demo is not null and (v_demo !~ '^https://[^\s]+$' or char_length(v_demo) > 300) then
    raise exception 'The demo link must start with https:// (300 characters at most)';
  end if;
  if p_cover_path is not null then
    if p_cover_path !~ ('^' || v_me::text || '/[0-9a-f-]{36}\.(png|jpg|webp)$') then
      raise exception 'The cover must be a PNG, JPEG or WebP file in your own folder';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'project-covers' and name = p_cover_path) then
      raise exception 'The file was not uploaded';
    end if;
  end if;
  select cover_path into v_old from public.projects where id = p_project and owner_id = v_me for update;
  if not found then raise exception 'Project not found'; end if;
  update public.projects set demo_url = v_demo, cover_path = p_cover_path where id = p_project;
  return case when v_old is distinct from p_cover_path then v_old end;
end $$;

-- ---------------------------------------------------------------------
-- The checker also records forks and the last push
-- ---------------------------------------------------------------------
drop function public.record_github_extras(uuid, text, jsonb);
create function public.record_github_extras(p_project uuid, p_build_status text default null, p_issues jsonb default null, p_forks integer default null, p_pushed_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proj public.projects;
  v_item jsonb;
  v_number integer;
  v_title text;
  v_comments integer;
  v_created timestamptz;
  v_kept integer := 0;
  v_seen integer[] := '{}';
begin
  select * into v_proj from public.projects where id = p_project for update;
  if not found or not public.project_is_listed(p_project) then raise exception 'Project not found'; end if;
  if p_build_status is not null and p_build_status not in ('passing', 'failing', 'running', 'none') then
    raise exception 'Unknown build status';
  end if;
  -- A JSON null arriving from the web interface means "no answer", like an empty value.
  if p_issues is not null and jsonb_typeof(p_issues) = 'null' then p_issues := null; end if;
  if p_issues is not null and jsonb_typeof(p_issues) <> 'array' then raise exception 'The issues must be a list'; end if;

  if p_issues is not null then
    delete from public.project_issues where project_id = p_project;
    for v_item in select * from jsonb_array_elements(p_issues) loop
      exit when v_kept >= 10;
      begin
        if jsonb_typeof(v_item) <> 'object' then continue; end if;
        v_number := (v_item ->> 'number')::integer;
        v_title := left(btrim(coalesce(v_item ->> 'title', '')), 200);
        v_comments := greatest(coalesce((v_item ->> 'comments')::integer, 0), 0);
        v_created := (v_item ->> 'created_at')::timestamptz;
        if v_number is null or v_number <= 0 or v_title = '' or v_created is null then continue; end if;
        if v_number = any (v_seen) then continue; end if;
        -- The link must be an issue of this very repository.
        if lower(coalesce(v_item ->> 'url', '')) <>
           lower('https://github.com/' || v_proj.github_owner || '/' || v_proj.github_repo || '/issues/' || v_number) then
          continue;
        end if;
        insert into public.project_issues (project_id, issue_number, title, url, comments, created_on)
        values (p_project, v_number, v_title,
                'https://github.com/' || v_proj.github_owner || '/' || v_proj.github_repo || '/issues/' || v_number,
                v_comments, v_created);
        v_seen := array_append(v_seen, v_number);
        v_kept := v_kept + 1;
      exception when others then
        continue; -- a malformed item is skipped, the rest is kept
      end;
    end loop;
  end if;

  update public.projects
     set extras_synced_at = now(),
         build_status = coalesce(p_build_status, build_status),
         build_checked_at = case when p_build_status is not null then now() else build_checked_at end,
         github_forks = case when p_forks is null then github_forks else greatest(p_forks, 0) end,
         github_pushed_at = coalesce(p_pushed_at, github_pushed_at)
   where id = p_project;

  return jsonb_build_object('issues', case when p_issues is null then null else v_kept end,
                            'build_status', coalesce(p_build_status, v_proj.build_status));
end $$;


revoke execute on function public.record_github_extras(uuid, text, jsonb, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.record_github_extras(uuid, text, jsonb, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- Search: region filter, and the new columns
-- ---------------------------------------------------------------------
drop function public.search_projects(text, text, text, public.clan_type, text, boolean, integer, integer);
create function public.search_projects(
  p_query text default null,
  p_language text default null,
  p_tag text default null,
  p_clan public.clan_type default null,
  p_sort text default 'recent',
  p_featured_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
  p_region text default null
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
  owner_clan public.clan_type,
  demo_url text,
  cover_path text,
  github_forks integer,
  github_pushed_at timestamptz,
  owner_region text
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
         p.verified_at, o.id, o.username, o.display_name, o.avatar_url, o.clan,
         p.demo_url, p.cover_path, p.github_forks, p.github_pushed_at, o.region
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
     and (p_region is null or o.region = p_region)
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


-- The people who work on each project: the owner first, then collaborators, at most 3 per project.
create function public.project_contributors(p_projects uuid[])
returns table (project_id uuid, user_id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select r.project_id, r.user_id, r.username, r.display_name, r.avatar_url
    from (
      select p.id as project_id, o.id as user_id, o.username, o.display_name, o.avatar_url,
             row_number() over (partition by p.id order by (o.id = p.owner_id) desc, c.added_at nulls first, o.username) as rn
        from public.projects p
        join public.profiles o on o.id = p.owner_id or o.id in (select pc.user_id from public.project_collaborators pc where pc.project_id = p.id)
        left join public.project_collaborators c on c.project_id = p.id and c.user_id = o.id
       where p.id = any (p_projects) and public.project_is_listed(p.id)
    ) r
   where r.rn <= 3
   order by r.project_id, r.rn
$$;

revoke execute on function public.search_projects(text, text, text, public.clan_type, text, boolean, integer, integer, text) from public;
grant execute on function public.search_projects(text, text, text, public.clan_type, text, boolean, integer, integer, text) to anon, authenticated;
revoke execute on function public.project_contributors(uuid[]) from public, anon;
grant execute on function public.project_contributors(uuid[]) to authenticated;
revoke execute on function public.set_project_showcase(uuid, text, text) from public, anon;
grant execute on function public.set_project_showcase(uuid, text, text) to authenticated;

-- Account deletion removes the covers too.
create or replace function public.account_files(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('dm-files', 'cv-files', 'souk-images', 'profile-images', 'project-covers')
     and (storage.foldername(o.name))[1] = p_user::text
$$;

commit;
