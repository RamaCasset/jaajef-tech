-- How much appreciation a member has received: the stars on their listed projects plus the likes on their
-- published blog posts. Shown on the member's page, and the base for the "Teranga légendaire" badge later.
-- Only things anyone can see are counted (a project that is not confirmed, or hidden by staff, counts for nothing).

create function public.received_appreciation(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.project_stars s
       join public.projects p on p.id = s.project_id
      where p.owner_id = p_user and public.project_is_listed(p.id))
    +
    (select count(*) from public.blog_likes l
       join public.blog_posts b on b.id = l.post_id
      where b.author_id = p_user and public.blog_post_is_listed(b.id))
  )::integer
$$;

revoke execute on function public.received_appreciation(uuid) from public;
grant execute on function public.received_appreciation(uuid) to authenticated, service_role;
