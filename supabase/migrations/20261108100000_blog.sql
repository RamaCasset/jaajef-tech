-- jaajef.tech  -  Migration: the blog
--
--   * Members write posts (title, summary, body, optional cover image, up to
--     5 tags). A post starts as a draft that only its author sees; publishing
--     makes it public.
--   * Anyone can read published posts. Members can like and comment.
--   * Authors edit, unpublish and delete their own posts. The author of a post
--     can also delete comments on it.
--   * Staff can hide a post (and bring it back). Every hide is logged. A hidden
--     post stays visible to its author only, and cannot be edited or published.
--   * Server-side limits: posts published per day, comments per hour.
--   * Suspended members cannot write posts or comments.
--
-- Not in this piece (they come after the notifications and search pieces are
-- merged): notices to the author for likes and comments, blog posts inside the
-- global search, and reporting a post from the report button.
--
-- Requires: chat (chat_setting), staff roles, moderation (refuse_if_suspended).

begin;

insert into public.game_config (key, value, status, description) values
  ('blog_posts_max_per_day', '5', 'defined', 'Most posts one member can publish per day'),
  ('blog_comment_max_per_hour', '20', 'defined', 'Most blog comments one member can post per hour');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 70),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  summary text check (char_length(summary) <= 300),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  cover_url text check (cover_url ~ '^https://' and char_length(cover_url) <= 500),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  status text not null default 'draft' check (status in ('draft', 'published')),
  staff_hidden boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);
create index blog_posts_feed on public.blog_posts (published_at desc) where status = 'published' and not staff_hidden;
create index blog_posts_author on public.blog_posts (author_id, created_at desc);
create index blog_posts_tags on public.blog_posts using gin (tags);

create table public.blog_comments (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index blog_comments_post on public.blog_comments (post_id, created_at);
create index blog_comments_author on public.blog_comments (author_id, created_at desc);

create table public.blog_likes (
  post_id uuid not null references public.blog_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index blog_likes_user on public.blog_likes (user_id);

-- Counts for the post cards. A post with no row here has zero of both.
create table public.blog_stats (
  post_id uuid primary key references public.blog_posts (id) on delete cascade,
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0)
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Published and not hidden by staff.
create function public.blog_post_is_listed(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blog_posts
     where id = p_post and status = 'published' and not staff_hidden
  )
$$;

-- Lower case, trimmed, no repeats; refuses anything that is not a short plain word.
create function public.blog_clean_tags(p_tags text[])
returns text[]
language plpgsql
immutable
as $$
declare
  v_out text[] := '{}';
  v_t text;
begin
  foreach v_t in array coalesce(p_tags, '{}') loop
    v_t := lower(btrim(v_t));
    if v_t is null or v_t !~ '^[a-z0-9][a-z0-9-]{1,29}$' then
      raise exception 'Tags must be 2 to 30 letters, digits or dashes';
    end if;
    if not (v_t = any (v_out)) then v_out := v_out || v_t; end if;
  end loop;
  if cardinality(v_out) > 5 then raise exception 'A post can have 5 tags at most'; end if;
  return v_out;
end $$;

create function public.blog_make_slug(p_title text)
returns text
language sql
volatile
as $$
  select coalesce(
           nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', '-', 'g'), 50)), ''),
           'post'
         ) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)
$$;

create function public.blog_check_fields(p_title text, p_body text, p_summary text, p_cover text)
returns void
language plpgsql
immutable
as $$
begin
  if p_title is null or char_length(btrim(p_title)) < 3 then raise exception 'The title needs at least 3 characters'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'The title is too long (120 characters at most)'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write something first'; end if;
  if char_length(btrim(p_body)) > 20000 then raise exception 'The post is too long (20000 characters at most)'; end if;
  if p_summary is not null and char_length(btrim(p_summary)) > 300 then raise exception 'The summary is too long (300 characters at most)'; end if;
  if p_cover is not null and btrim(p_cover) <> '' and (btrim(p_cover) !~ '^https://' or char_length(btrim(p_cover)) > 500) then
    raise exception 'The cover image must be a secure (https) address';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------
create function public.count_blog_likes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.blog_stats (post_id, like_count) values (new.post_id, 1)
    on conflict (post_id) do update set like_count = public.blog_stats.like_count + 1;
  else
    update public.blog_stats set like_count = greatest(like_count - 1, 0) where post_id = old.post_id;
  end if;
  return null;
end $$;

create function public.count_blog_comments() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.blog_stats (post_id, comment_count) values (new.post_id, 1)
    on conflict (post_id) do update set comment_count = public.blog_stats.comment_count + 1;
  else
    update public.blog_stats set comment_count = greatest(comment_count - 1, 0) where post_id = old.post_id;
  end if;
  return null;
end $$;

create trigger blog_likes_count after insert or delete on public.blog_likes
  for each row execute function public.count_blog_likes();
create trigger blog_comments_count after insert or delete on public.blog_comments
  for each row execute function public.count_blog_comments();

create trigger blog_posts_suspension before insert or update of body on public.blog_posts
  for each row execute function public.refuse_if_suspended('author_id');
create trigger blog_comments_suspension before insert or update of body on public.blog_comments
  for each row execute function public.refuse_if_suspended('author_id');

-- ---------------------------------------------------------------------
-- Writing posts
-- ---------------------------------------------------------------------
-- Publishes a post the caller owns. The first publication is limited per day;
-- publishing again later keeps the original date.
create function public.publish_blog_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_post public.blog_posts;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  -- Lock the member so two quick publications cannot both slip under the limit.
  perform 1 from public.profiles where id = v_me for update;

  select * into v_post from public.blog_posts where id = p_post and author_id = v_me;
  if not found then raise exception 'Post not found'; end if;
  if v_post.staff_hidden then raise exception 'This post was hidden by staff'; end if;
  if v_post.status = 'published' then return; end if;

  if v_post.published_at is null then
    if (select count(*) from public.blog_posts
         where author_id = v_me and published_at > now() - interval '1 day')
         >= public.chat_setting('blog_posts_max_per_day') then
      raise exception 'You are publishing too fast, try again later';
    end if;
  end if;

  update public.blog_posts
     set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
   where id = p_post;
end $$;

create function public.create_blog_post(
  p_title text, p_body text, p_summary text default null, p_cover_url text default null,
  p_tags text[] default '{}', p_publish boolean default false
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
  perform public.blog_check_fields(p_title, p_body, p_summary, p_cover_url);

  insert into public.blog_posts (author_id, slug, title, summary, body, cover_url, tags)
  values (v_me, public.blog_make_slug(p_title), btrim(p_title),
          nullif(btrim(coalesce(p_summary, '')), ''), btrim(p_body),
          nullif(btrim(coalesce(p_cover_url, '')), ''), public.blog_clean_tags(p_tags))
  returning id into v_id;

  if p_publish then perform public.publish_blog_post(v_id); end if;
  return v_id;
end $$;

create function public.update_blog_post(
  p_post uuid, p_title text, p_body text, p_summary text default null, p_cover_url text default null,
  p_tags text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_post public.blog_posts;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into v_post from public.blog_posts where id = p_post and author_id = v_me;
  if not found then raise exception 'Post not found'; end if;
  if v_post.staff_hidden then raise exception 'This post was hidden by staff'; end if;
  perform public.blog_check_fields(p_title, p_body, p_summary, p_cover_url);

  update public.blog_posts
     set title = btrim(p_title), body = btrim(p_body),
         summary = nullif(btrim(coalesce(p_summary, '')), ''),
         cover_url = nullif(btrim(coalesce(p_cover_url, '')), ''),
         tags = public.blog_clean_tags(p_tags), updated_at = now()
   where id = p_post;
end $$;

-- Back to a private draft.
create function public.unpublish_blog_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.blog_posts set status = 'draft', updated_at = now()
   where id = p_post and author_id = auth.uid();
  if not found then raise exception 'Post not found'; end if;
end $$;

create function public.delete_blog_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.blog_posts where id = p_post and author_id = auth.uid();
  if not found then raise exception 'Post not found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------
create function public.like_blog_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not public.blog_post_is_listed(p_post) then raise exception 'Post not found'; end if;
  insert into public.blog_likes (post_id, user_id) values (p_post, auth.uid()) on conflict do nothing;
end $$;

create function public.unlike_blog_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.blog_likes where post_id = p_post and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------
create function public.post_blog_comment(p_post uuid, p_body text)
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
  if not public.blog_post_is_listed(p_post) then raise exception 'Post not found'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'Write something first'; end if;
  if char_length(btrim(p_body)) > 1000 then raise exception 'Your comment is too long (1000 characters at most)'; end if;

  perform 1 from public.profiles where id = v_me for update;

  if (select count(*) from public.blog_comments
       where author_id = v_me and created_at > now() - interval '1 hour')
       >= public.chat_setting('blog_comment_max_per_hour') then
    raise exception 'You are commenting too fast, try again later';
  end if;

  insert into public.blog_comments (post_id, author_id, body)
  values (p_post, v_me, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_blog_comment(p_comment bigint, p_body text)
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
  update public.blog_comments c
     set body = btrim(p_body), edited_at = now()
   where c.id = p_comment and c.author_id = v_me and public.blog_post_is_listed(c.post_id);
  if not found then raise exception 'Comment not found'; end if;
end $$;

-- The comment's author or the post's author can delete it.
create function public.delete_blog_comment(p_comment bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_c public.blog_comments;
  v_post_author uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select * into v_c from public.blog_comments where id = p_comment;
  if not found then raise exception 'Comment not found'; end if;
  select author_id into v_post_author from public.blog_posts where id = v_c.post_id;
  if v_c.author_id <> v_me and v_post_author <> v_me then
    raise exception 'You can only delete your own comments, or comments on your own post';
  end if;
  delete from public.blog_comments where id = p_comment;
end $$;

-- ---------------------------------------------------------------------
-- Staff: hide a post or bring it back
-- ---------------------------------------------------------------------
create function public.set_blog_post_hidden(p_post uuid, p_hidden boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.staff_role() is null then raise exception 'Only staff can hide posts'; end if;
  if p_hidden and (p_reason is null or char_length(btrim(p_reason)) = 0) then
    raise exception 'Give a reason for hiding the post';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'The reason is too long (500 characters at most)'; end if;

  update public.blog_posts set staff_hidden = p_hidden
   where id = p_post and staff_hidden is distinct from p_hidden;
  if found then
    perform public.log_admin_action(auth.uid(),
      case when p_hidden then 'blog_post_hidden' else 'blog_post_unhidden' end,
      'blog_post', p_post::text, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
  elsif not exists (select 1 from public.blog_posts where id = p_post) then
    raise exception 'Post not found';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Reading: the feed, with counts and the viewer's own like
-- ---------------------------------------------------------------------
create function public.list_blog_posts(
  p_tag text default null, p_author uuid default null, p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, slug text, title text, summary text, cover_url text, tags text[],
  author_id uuid, author_username text, published_at timestamptz,
  like_count integer, comment_count integer, liked_by_me boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  select b.id, b.slug, b.title, b.summary, b.cover_url, b.tags,
         b.author_id, pr.username, b.published_at,
         coalesce(s.like_count, 0), coalesce(s.comment_count, 0),
         exists (select 1 from public.blog_likes l where l.post_id = b.id and l.user_id = auth.uid())
    from public.blog_posts b
    join public.profiles pr on pr.id = b.author_id
    left join public.blog_stats s on s.post_id = b.id
   where b.status = 'published' and not b.staff_hidden
     and (p_tag is null or lower(btrim(p_tag)) = any (b.tags))
     and (p_author is null or b.author_id = p_author)
   order by b.published_at desc, b.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.blog_posts enable row level security;
alter table public.blog_comments enable row level security;
alter table public.blog_likes enable row level security;
alter table public.blog_stats enable row level security;

revoke all on public.blog_posts, public.blog_comments, public.blog_likes, public.blog_stats
  from public, anon, authenticated;

-- Public: published posts that are not hidden, with their comments and counts.
grant select on public.blog_posts, public.blog_comments, public.blog_stats to anon, authenticated;
create policy "published posts are public" on public.blog_posts for select to anon, authenticated
  using (status = 'published' and not staff_hidden);
create policy "authors see their own posts" on public.blog_posts for select to authenticated
  using (author_id = (select auth.uid()));
create policy "staff see every post" on public.blog_posts for select to authenticated
  using (public.staff_role() is not null);
create policy "comments on listed posts are public" on public.blog_comments for select to anon, authenticated
  using (public.blog_post_is_listed(post_id));
create policy "counts are public" on public.blog_stats for select to anon, authenticated
  using (public.blog_post_is_listed(post_id));

-- Private: who you liked.
grant select on public.blog_likes to authenticated;
create policy "own likes" on public.blog_likes for select to authenticated
  using (user_id = (select auth.uid()));

revoke execute on function public.blog_post_is_listed(uuid) from public;
grant execute on function public.blog_post_is_listed(uuid) to anon, authenticated, service_role;
revoke execute on function public.blog_clean_tags(text[]) from public, anon, authenticated;
revoke execute on function public.blog_make_slug(text) from public, anon, authenticated;
revoke execute on function public.blog_check_fields(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.count_blog_likes() from public, anon, authenticated;
revoke execute on function public.count_blog_comments() from public, anon, authenticated;

revoke execute on function public.publish_blog_post(uuid) from public, anon;
revoke execute on function public.create_blog_post(text, text, text, text, text[], boolean) from public, anon;
revoke execute on function public.update_blog_post(uuid, text, text, text, text, text[]) from public, anon;
revoke execute on function public.unpublish_blog_post(uuid) from public, anon;
revoke execute on function public.delete_blog_post(uuid) from public, anon;
revoke execute on function public.like_blog_post(uuid) from public, anon;
revoke execute on function public.unlike_blog_post(uuid) from public, anon;
revoke execute on function public.post_blog_comment(uuid, text) from public, anon;
revoke execute on function public.edit_blog_comment(bigint, text) from public, anon;
revoke execute on function public.delete_blog_comment(bigint) from public, anon;
revoke execute on function public.set_blog_post_hidden(uuid, boolean, text) from public, anon;
revoke execute on function public.list_blog_posts(text, uuid, integer, integer) from public;

grant execute on function public.publish_blog_post(uuid) to authenticated;
grant execute on function public.create_blog_post(text, text, text, text, text[], boolean) to authenticated;
grant execute on function public.update_blog_post(uuid, text, text, text, text, text[]) to authenticated;
grant execute on function public.unpublish_blog_post(uuid) to authenticated;
grant execute on function public.delete_blog_post(uuid) to authenticated;
grant execute on function public.like_blog_post(uuid) to authenticated;
grant execute on function public.unlike_blog_post(uuid) to authenticated;
grant execute on function public.post_blog_comment(uuid, text) to authenticated;
grant execute on function public.edit_blog_comment(bigint, text) to authenticated;
grant execute on function public.delete_blog_comment(bigint) to authenticated;
grant execute on function public.set_blog_post_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.list_blog_posts(text, uuid, integer, integer) to anon, authenticated;

grant all on public.blog_posts, public.blog_comments, public.blog_likes, public.blog_stats to service_role;

commit;
