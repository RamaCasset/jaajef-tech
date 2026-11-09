-- jaajef.tech - Deleting a project, a blog post, a Souk item (or a member who owns them) no longer fails when it has stars, likes, comments or ratings
--
-- When a project is deleted, its stars and comments go with it, and each one tried to lower the project's
-- counters. Once both had run in the same statement, the database refused (the counters belonged to a project
-- that was already gone). Now the counters are only touched while the project still exists.
-- The same goes for blog likes and comments, and Souk ratings.
-- This is what blocked deleting an account that owned a starred and commented project.

create or replace function public.count_project_stars() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_stats (project_id, star_count) values (new.project_id, 1)
    on conflict (project_id) do update set star_count = public.project_stats.star_count + 1;
  elsif exists (select 1 from public.projects where id = old.project_id) then
    update public.project_stats set star_count = greatest(star_count - 1, 0) where project_id = old.project_id;
  end if;
  return null;
end $$;

create or replace function public.count_project_comments() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_stats (project_id, comment_count) values (new.project_id, 1)
    on conflict (project_id) do update set comment_count = public.project_stats.comment_count + 1;
  elsif exists (select 1 from public.projects where id = old.project_id) then
    update public.project_stats set comment_count = greatest(comment_count - 1, 0) where project_id = old.project_id;
  end if;
  return null;
end $$;

create or replace function public.count_blog_likes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.blog_stats (post_id, like_count) values (new.post_id, 1)
    on conflict (post_id) do update set like_count = public.blog_stats.like_count + 1;
  elsif exists (select 1 from public.blog_posts where id = old.post_id) then
    update public.blog_stats set like_count = greatest(like_count - 1, 0) where post_id = old.post_id;
  end if;
  return null;
end $$;

create or replace function public.count_blog_comments() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.blog_stats (post_id, comment_count) values (new.post_id, 1)
    on conflict (post_id) do update set comment_count = public.blog_stats.comment_count + 1;
  elsif exists (select 1 from public.blog_posts where id = old.post_id) then
    update public.blog_stats set comment_count = greatest(comment_count - 1, 0) where post_id = old.post_id;
  end if;
  return null;
end $$;

create or replace function public.count_souk_ratings() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.souk_item_stats (item_id, rating_count, rating_sum) values (new.item_id, 1, new.stars)
    on conflict (item_id) do update
      set rating_count = public.souk_item_stats.rating_count + 1,
          rating_sum = public.souk_item_stats.rating_sum + new.stars;
  elsif tg_op = 'UPDATE' then
    update public.souk_item_stats set rating_sum = rating_sum + new.stars - old.stars where item_id = new.item_id;
  elsif exists (select 1 from public.souk_items where id = old.item_id) then
    update public.souk_item_stats
       set rating_count = greatest(rating_count - 1, 0), rating_sum = greatest(rating_sum - old.stars, 0)
     where item_id = old.item_id;
  end if;
  return null;
end $$;
