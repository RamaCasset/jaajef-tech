-- jaajef.tech  -  Migration: global search
--
--   * One search across projects, members, communities and quests, for the
--     search bar in the header. Works for visitors too.
--   * Only public things appear: projects listed for everyone, published
--     quests, communities that are public or private-but-listed. A hidden
--     private community never shows.
--   * Results that start with what you typed come before results that only
--     contain it. At most 5 per kind by default, 10 at most.
--   * A query needs at least 2 characters; symbols are searched as plain text.
--
-- Not included: searching inside chat messages (private to their communities),
-- the blog (not built), and tuning for very large numbers of members.
--
-- Requires: projects, project social (project_is_listed), chat, quests.

begin;

create function public.search_everything(p_query text, p_limit_each integer default 5)
returns table (
  kind text,
  pos integer,
  id text,
  slug text,
  title text,
  subtitle text,
  image_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := left(btrim(coalesce(p_query, '')), 80);
  v_contains text;
  v_starts text;
  v_limit integer := least(greatest(coalesce(p_limit_each, 5), 1), 10);
begin
  if char_length(v_q) < 2 then return; end if;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_contains := '%' || v_q || '%';
  v_starts := v_q || '%';

  return query
  select x.kind, x.pos, x.id, x.slug, x.title, x.subtitle, x.image_url
    from (
      select 'project'::text as kind,
             (row_number() over (order by (p.title ilike v_starts or p.github_repo ilike v_starts) desc, p.title, p.id))::integer as pos,
             p.id::text as id, (p.github_owner || '/' || p.github_repo) as slug, p.title as title,
             coalesce(p.summary, p.github_description) as subtitle, null::text as image_url
        from public.projects p
       where public.project_is_listed(p.id)
         and (p.title ilike v_contains or p.github_repo ilike v_contains or p.summary ilike v_contains
              or exists (select 1 from unnest(p.tags) t where t ilike v_contains))
      union all
      select 'member'::text,
             (row_number() over (order by (m.username ilike v_starts or m.display_name ilike v_starts) desc, m.username))::integer,
             m.id::text, m.username, coalesce(m.display_name, m.username), '@' || m.username, m.avatar_url
        from public.profiles m
       where m.username ilike v_contains or m.display_name ilike v_contains
      union all
      select 'community'::text,
             (row_number() over (order by (c.name ilike v_starts or c.slug ilike v_starts) desc, c.name, c.id))::integer,
             c.id::text, c.slug, c.name, left(c.description, 120), c.avatar_url
        from public.communities c
       where (not c.is_private or c.is_listed)
         and (c.name ilike v_contains or c.slug ilike v_contains or c.description ilike v_contains)
      union all
      select 'quest'::text,
             (row_number() over (order by (qu.title ilike v_starts or qu.slug ilike v_starts) desc, qu.title, qu.id))::integer,
             qu.id::text, qu.slug, qu.title, coalesce(qu.summary, qu.topic), null::text
        from public.quests qu
       where qu.published
         and (qu.title ilike v_contains or qu.slug ilike v_contains or qu.summary ilike v_contains or qu.topic ilike v_contains)
    ) x
   where x.pos <= v_limit
   order by x.kind, x.pos;
end $$;

revoke execute on function public.search_everything(text, integer) from public;
grant execute on function public.search_everything(text, integer) to anon, authenticated;

commit;
