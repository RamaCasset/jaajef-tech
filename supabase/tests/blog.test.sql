-- Tests for the blog migration.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f blog.test.sql
-- Each DO block is its own transaction on purpose.
-- Everything this test creates is deleted at the end.
--
-- People: ana (...1) writes; bara (...2) and coumba (...3) read and comment;
-- dame (...4) is an admin; eli (...5) is a moderator; fatou (...6) gets suspended.

create schema blkit;
grant usage on schema blkit to public;

create function blkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('f7f7f7f7-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function blkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', blkit.uid(p_n)::text, true);
end $$;

create function blkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function blkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function blkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function blkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := blkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function blkit.post(p_title text) returns uuid
language sql stable security definer as $$ select id from public.blog_posts where title = p_title $$;

create function blkit.visible(p_title text) returns boolean
language sql stable as $$ select exists (select 1 from public.blog_posts where title = p_title) $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (blkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (blkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (blkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (blkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (blkit.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}'),
  (blkit.uid(6), 'fatou@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  perform blkit.as_server();
  perform public.make_admin(blkit.uid(4));
  reset role;
  perform blkit.as_user(4);
  perform public.set_moderator(blkit.uid(5), true);
  reset role;
end $$;

-- ---- 1. Drafts are private; the fields are checked --------------------------------------------------------
do $$
declare p uuid;
begin
  perform blkit.as_user(1);
  p := public.create_blog_post('Mon premier billet', 'Bonjour tout le monde', 'Un resume', 'https://exemple.sn/cover.png', array['Python', ' python ', 'web-dev']);
  perform blkit.must_fail('a title that is too short', $q$select public.create_blog_post('ab', 'corps')$q$, 'at least 3');
  perform blkit.must_fail('an empty body', $q$select public.create_blog_post('Un titre', '   ')$q$, 'Write something');
  perform blkit.must_fail('a cover that is not https', $q$select public.create_blog_post('Un titre', 'corps', null, 'http://exemple.sn/a.png')$q$, 'https');
  perform blkit.must_fail('a bad tag', $q$select public.create_blog_post('Un titre', 'corps', null, null, array['a b'])$q$, 'Tags must be');
  perform blkit.must_fail('six tags', $q$select public.create_blog_post('Un titre', 'corps', null, null, array['aa','bb','cc','dd','ee','ff'])$q$, '5 tags');
  perform blkit.must_fail('a title that is too long', format('select public.create_blog_post(%L, %L)', repeat('a', 121), 'corps'), 'too long');
  perform blkit.must_fail('a body that is too long', format('select public.create_blog_post(%L, %L)', 'Un titre', repeat('a', 20001)), 'too long');
  if not blkit.visible('Mon premier billet') then raise exception 'FAIL: the author should see her draft'; end if;
  if (select tags from public.blog_posts where id = p) <> array['python', 'web-dev'] then raise exception 'FAIL: tags should be lower case and without repeats, got %', (select tags from public.blog_posts where id = p); end if;
  if (select slug from public.blog_posts where id = p) !~ '^mon-premier-billet-[0-9a-f]{8}$' then raise exception 'FAIL: odd slug %', (select slug from public.blog_posts where id = p); end if;
  if (select status from public.blog_posts where id = p) <> 'draft' then raise exception 'FAIL: a new post should be a draft'; end if;
  reset role;

  perform blkit.as_user(2);
  if blkit.visible('Mon premier billet') then raise exception 'FAIL: another member sees a draft'; end if;
  perform blkit.must_fail('liking a draft', format('select public.like_blog_post(%L)', p), 'Post not found');
  perform blkit.must_fail('commenting on a draft', format('select public.post_blog_comment(%L, %L)', p, 'salut'), 'Post not found');
  perform blkit.must_fail('publishing someone else''s draft', format('select public.publish_blog_post(%L)', p), 'Post not found');
  reset role;
  perform blkit.as_anon();
  if blkit.visible('Mon premier billet') then raise exception 'FAIL: a visitor sees a draft'; end if;
  reset role;
  perform blkit.as_user(5);
  if not blkit.visible('Mon premier billet') then raise exception 'FAIL: staff should see drafts'; end if;
  reset role;

  perform blkit.as_user(1);
  perform public.create_blog_post('Titre accentue', 'corps');
  if (select slug from public.blog_posts where title = 'Titre accentue') !~ '^titre-accentue-' then raise exception 'FAIL: slug from title'; end if;
  perform public.create_blog_post('!!!', 'corps');
  reset role;
  raise notice 'OK 1: drafts are private to the author and staff; bad titles, bodies, covers and tags are refused';
end $$;

do $$
begin
  perform blkit.as_user(1);
  perform public.delete_blog_post(blkit.post('Titre accentue'));
  perform public.delete_blog_post(blkit.post('!!!'));
  reset role;
end $$;

-- ---- 2. Publishing and the feed -------------------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet'); q uuid;
begin
  perform blkit.as_user(1);
  perform public.publish_blog_post(p);
  perform public.publish_blog_post(p); -- again: harmless
  q := public.create_blog_post('Deuxieme billet', 'Du JavaScript', null, null, array['javascript'], true);
  reset role;
  if (select status from public.blog_posts where id = q) <> 'published' or (select published_at from public.blog_posts where id = q) is null then
    raise exception 'FAIL: create with publish should publish';
  end if;

  perform blkit.as_anon();
  if not blkit.visible('Mon premier billet') then raise exception 'FAIL: visitors should read published posts'; end if;
  if (select count(*) from public.list_blog_posts()) <> 2 then raise exception 'FAIL: the feed should have 2 posts'; end if;
  if (select title from public.list_blog_posts() limit 1) <> 'Deuxieme billet' then raise exception 'FAIL: newest first'; end if;
  reset role;

  perform blkit.as_user(2);
  if (select count(*) from public.list_blog_posts(' Python ')) <> 1 then raise exception 'FAIL: tag filter'; end if;
  if (select count(*) from public.list_blog_posts(null, blkit.uid(1))) <> 2 then raise exception 'FAIL: author filter'; end if;
  if (select count(*) from public.list_blog_posts(null, blkit.uid(3))) <> 0 then raise exception 'FAIL: author filter should exclude others'; end if;
  if (select count(*) from public.list_blog_posts(null, null, 1)) <> 1 then raise exception 'FAIL: limit'; end if;
  if (select count(*) from public.list_blog_posts(null, null, 0)) <> 1 then raise exception 'FAIL: limit 0 becomes 1'; end if;
  if (select count(*) from public.list_blog_posts(null, null, 20, 1)) <> 1 then raise exception 'FAIL: offset'; end if;
  if (select author_username from public.list_blog_posts() limit 1) is null then raise exception 'FAIL: author name missing'; end if;
  reset role;
  raise notice 'OK 2: published posts are public; the feed filters by tag and author, newest first';
end $$;

-- ---- 3. The daily publishing limit ------------------------------------------------------------------------------
do $$
declare a uuid; b uuid; c uuid;
begin
  perform blkit.as_server();
  update public.game_config set value = '3' where key = 'blog_posts_max_per_day';
  reset role;
  perform blkit.as_user(1); -- two posts are already published today
  a := public.create_blog_post('Limite A', 'corps');
  b := public.create_blog_post('Limite B', 'corps');
  perform public.publish_blog_post(a);
  perform blkit.must_fail('a post over the daily limit', format('select public.publish_blog_post(%L)', b), 'too fast');
  -- drafts do not count, and a post already published once can come back
  perform public.unpublish_blog_post(a);
  perform public.publish_blog_post(a);
  reset role;
  perform blkit.as_user(2);
  perform public.publish_blog_post(public.create_blog_post('Autre membre', 'corps')); -- the limit is per member
  reset role;
  perform blkit.as_server();
  update public.game_config set value = '5' where key = 'blog_posts_max_per_day';
  reset role;
  raise notice 'OK 3: publishing is limited per member and per day; republishing does not count again';
end $$;

do $$
begin
  perform blkit.as_user(1);
  perform public.delete_blog_post(blkit.post('Limite A'));
  perform public.delete_blog_post(blkit.post('Limite B'));
  reset role;
  perform blkit.as_user(2);
  perform public.delete_blog_post(blkit.post('Autre membre'));
  reset role;
end $$;

-- ---- 4. Only the author edits, unpublishes or deletes ---------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  perform blkit.as_user(2);
  perform blkit.must_fail('editing someone else''s post', format('select public.update_blog_post(%L, %L, %L)', p, 'Pirate', 'corps'), 'Post not found');
  perform blkit.must_fail('unpublishing someone else''s post', format('select public.unpublish_blog_post(%L)', p), 'Post not found');
  perform blkit.must_fail('deleting someone else''s post', format('select public.delete_blog_post(%L)', p), 'Post not found');
  reset role;
  perform blkit.as_user(1);
  perform public.update_blog_post(p, 'Mon premier billet', 'Corps modifie', 'Nouveau resume', null, array['python']);
  perform blkit.must_fail('an edit with a bad title', format('select public.update_blog_post(%L, %L, %L)', p, 'x', 'corps'), 'at least 3');
  reset role;
  if (select body from public.blog_posts where id = p) <> 'Corps modifie' then raise exception 'FAIL: the edit did not apply'; end if;
  if (select cover_url from public.blog_posts where id = p) is not null then raise exception 'FAIL: the cover should be removed'; end if;
  if (select status from public.blog_posts where id = p) <> 'published' then raise exception 'FAIL: editing should keep the post published'; end if;
  perform blkit.as_anon();
  perform blkit.must_fail('a visitor writes', $q$select public.create_blog_post('Un titre', 'corps')$q$, 'permission denied');
  reset role;
  raise notice 'OK 4: only the author edits; strangers and visitors cannot';
end $$;

-- ---- 5. Likes ------------------------------------------------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  perform blkit.as_user(2);
  perform public.like_blog_post(p);
  perform public.like_blog_post(p); -- twice: still one like
  if (select liked_by_me from public.list_blog_posts(null, null, 5) where id = p) is not true then raise exception 'FAIL: liked_by_me should be true'; end if;
  reset role;
  perform blkit.as_user(3);
  perform public.like_blog_post(p);
  if (select liked_by_me from public.list_blog_posts(null, null, 5) where id = p) is not true then raise exception 'FAIL: coumba liked it'; end if;
  if (select count(*) from public.blog_likes) <> 1 then raise exception 'FAIL: a member should see only her own like'; end if;
  reset role;
  if (select like_count from public.blog_stats where post_id = p) <> 2 then raise exception 'FAIL: two members liked it'; end if;

  perform blkit.as_user(3);
  perform public.unlike_blog_post(p);
  perform public.unlike_blog_post(p); -- nothing left: harmless
  reset role;
  if (select like_count from public.blog_stats where post_id = p) <> 1 then raise exception 'FAIL: the like count should drop to 1'; end if;
  perform blkit.as_anon();
  if (select like_count from public.blog_stats where post_id = p) <> 1 then raise exception 'FAIL: counts are public'; end if;
  perform blkit.must_fail('a visitor likes', format('select public.like_blog_post(%L)', p), 'permission denied');
  perform blkit.must_fail('a visitor reads likes', 'select count(*) from public.blog_likes', 'permission denied');
  reset role;
  raise notice 'OK 5: likes count once per member, can be removed, and who liked is private';
end $$;

-- ---- 6. Comments ------------------------------------------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet'); c1 bigint; c2 bigint; c3 bigint;
begin
  perform blkit.as_user(2);
  c1 := public.post_blog_comment(p, '  Bravo !  ');
  perform blkit.must_fail('an empty comment', format('select public.post_blog_comment(%L, %L)', p, '  '), 'Write something');
  perform blkit.must_fail('a long comment', format('select public.post_blog_comment(%L, %L)', p, repeat('a', 1001)), 'too long');
  reset role;
  perform blkit.as_user(3);
  c2 := public.post_blog_comment(p, 'Merci');
  perform blkit.must_fail('editing another member''s comment', format('select public.edit_blog_comment(%L, %L)', c1, 'pirate'), 'Comment not found');
  perform blkit.must_fail('deleting another member''s comment', format('select public.delete_blog_comment(%L)', c1), 'only delete');
  reset role;
  if (select body from public.blog_comments where id = c1) <> 'Bravo !' then raise exception 'FAIL: the comment should be trimmed'; end if;
  if (select comment_count from public.blog_stats where post_id = p) <> 2 then raise exception 'FAIL: two comments expected'; end if;

  perform blkit.as_user(2);
  perform public.edit_blog_comment(c1, 'Bravo vraiment');
  reset role;
  if (select edited_at from public.blog_comments where id = c1) is null then raise exception 'FAIL: edited_at not set'; end if;

  perform blkit.as_anon();
  if (select count(*) from public.blog_comments where post_id = p) <> 2 then raise exception 'FAIL: comments on a published post are public'; end if;
  perform blkit.must_fail('a visitor comments', format('select public.post_blog_comment(%L, %L)', p, 'salut'), 'permission denied');
  reset role;

  -- the comment's author deletes hers; the post's author deletes another
  perform blkit.as_user(3);
  perform public.delete_blog_comment(c2);
  reset role;
  perform blkit.as_user(1);
  perform public.delete_blog_comment(c1);
  reset role;
  if (select comment_count from public.blog_stats where post_id = p) <> 0 then raise exception 'FAIL: the comment count should be back to 0'; end if;

  -- the hourly limit
  perform blkit.as_server();
  update public.game_config set value = '2' where key = 'blog_comment_max_per_hour';
  reset role;
  perform blkit.as_user(3);
  c3 := public.post_blog_comment(p, 'un');
  perform public.post_blog_comment(p, 'deux');
  perform blkit.must_fail('commenting too fast', format('select public.post_blog_comment(%L, %L)', p, 'trois'), 'too fast');
  reset role;
  perform blkit.as_user(2); -- another member is not affected
  perform public.post_blog_comment(p, 'trois quand meme');
  reset role;
  perform blkit.as_server();
  update public.game_config set value = '20' where key = 'blog_comment_max_per_hour';
  reset role;
  raise notice 'OK 6: comments work, are limited per hour, and can be removed by their author or the post''s author';
end $$;

-- ---- 7. Staff hide a post ----------------------------------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  perform blkit.as_user(2);
  perform blkit.must_fail('a member hides a post', format('select public.set_blog_post_hidden(%L, true, %L)', p, 'raison'), 'Only staff');
  reset role;
  perform blkit.as_user(5);
  perform blkit.must_fail('hiding without a reason', format('select public.set_blog_post_hidden(%L, true)', p), 'reason');
  perform blkit.must_fail('hiding an unknown post', format('select public.set_blog_post_hidden(%L, true, %L)', gen_random_uuid(), 'raison'), 'Post not found');
  perform public.set_blog_post_hidden(p, true, 'Contenu inapproprie');
  perform public.set_blog_post_hidden(p, true, 'Contenu inapproprie'); -- again: nothing changes
  reset role;

  perform blkit.as_anon();
  if blkit.visible('Mon premier billet') then raise exception 'FAIL: a hidden post is visible to visitors'; end if;
  if exists (select 1 from public.list_blog_posts() where id = p) then raise exception 'FAIL: a hidden post is in the feed'; end if;
  if exists (select 1 from public.blog_comments where post_id = p) then raise exception 'FAIL: comments of a hidden post are visible'; end if;
  if exists (select 1 from public.blog_stats where post_id = p) then raise exception 'FAIL: counts of a hidden post are visible'; end if;
  reset role;
  perform blkit.as_user(2);
  if blkit.visible('Mon premier billet') then raise exception 'FAIL: a hidden post is visible to members'; end if;
  perform blkit.must_fail('liking a hidden post', format('select public.like_blog_post(%L)', p), 'Post not found');
  perform blkit.must_fail('commenting on a hidden post', format('select public.post_blog_comment(%L, %L)', p, 'salut'), 'Post not found');
  reset role;
  perform blkit.as_user(1);
  if not blkit.visible('Mon premier billet') then raise exception 'FAIL: the author should still see her hidden post'; end if;
  perform blkit.must_fail('editing a hidden post', format('select public.update_blog_post(%L, %L, %L)', p, 'Nouveau titre', 'corps'), 'hidden by staff');
  perform public.unpublish_blog_post(p);
  perform blkit.must_fail('publishing a hidden post', format('select public.publish_blog_post(%L)', p), 'hidden by staff');
  reset role;

  if (select count(*) from public.admin_audit_log where action = 'blog_post_hidden' and target_id = p::text) <> 1 then raise exception 'FAIL: hiding should be logged exactly once'; end if;

  perform blkit.as_user(5);
  perform public.set_blog_post_hidden(p, false);
  perform public.set_blog_post_hidden(p, false);
  reset role;
  if (select count(*) from public.admin_audit_log where action = 'blog_post_unhidden' and target_id = p::text) <> 1 then raise exception 'FAIL: unhiding should be logged exactly once'; end if;
  perform blkit.as_user(1);
  perform public.publish_blog_post(p);
  reset role;
  perform blkit.as_anon();
  if not blkit.visible('Mon premier billet') then raise exception 'FAIL: the post should be back'; end if;
  reset role;
  raise notice 'OK 7: staff can hide and restore a post; it disappears for everyone but its author; every change is logged once';
end $$;

-- ---- 8. Suspended members -------------------------------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  insert into public.member_suspensions (user_id, reason, until) values (blkit.uid(6), 'test', now() + interval '1 day');
  perform blkit.as_user(6);
  perform blkit.must_fail('a suspended member writes a post', $q$select public.create_blog_post('Un titre', 'corps')$q$, 'suspended');
  perform blkit.must_fail('a suspended member comments', format('select public.post_blog_comment(%L, %L)', p, 'salut'), 'suspended');
  reset role;
  raise notice 'OK 8: suspended members cannot write posts or comments';
end $$;

-- ---- 9. Nobody writes the tables directly -----------------------------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  perform blkit.as_user(2);
  perform blkit.must_fail('inserting a post', format('insert into public.blog_posts (author_id, slug, title, body) values (%L, %L, %L, %L)', blkit.uid(2), 'pirate', 'Pirate', 'corps'), 'permission denied');
  perform blkit.must_fail('editing a post directly', format('update public.blog_posts set title = %L where id = %L', 'Pirate', p), 'permission denied');
  perform blkit.must_fail('inserting a comment', format('insert into public.blog_comments (post_id, author_id, body) values (%L, %L, %L)', p, blkit.uid(2), 'x'), 'permission denied');
  perform blkit.must_fail('inserting a like', format('insert into public.blog_likes (post_id, user_id) values (%L, %L)', p, blkit.uid(2)), 'permission denied');
  perform blkit.must_fail('editing the counts', format('update public.blog_stats set like_count = 999 where post_id = %L', p), 'permission denied');
  reset role;
  raise notice 'OK 9: posts, comments, likes and counts can only change through the functions';
end $$;

-- ---- 10. Deleting a post removes its comments and likes ---------------------------------------------------
do $$
declare p uuid := blkit.post('Mon premier billet');
begin
  perform blkit.as_user(1);
  perform public.delete_blog_post(p);
  reset role;
  if exists (select 1 from public.blog_comments where post_id = p) or exists (select 1 from public.blog_likes where post_id = p)
     or exists (select 1 from public.blog_stats where post_id = p) then
    raise exception 'FAIL: deleting a post should remove its comments, likes and counts';
  end if;
  raise notice 'OK 10: deleting a post removes everything attached to it';
end $$;

-- ---- Clean up ----------------------------------------------------------------------------------------------------------------
delete from public.blog_posts where author_id::text like 'f7f7f7f7-%';
delete from public.member_suspensions where user_id::text like 'f7f7f7f7-%';
delete from public.profiles where id::text like 'f7f7f7f7-%';
delete from auth.users where id::text like 'f7f7f7f7-%';
drop schema blkit cascade;

do $$
begin
  if exists (select 1 from public.blog_posts) or exists (select 1 from public.blog_comments)
     or exists (select 1 from public.blog_likes) or exists (select 1 from public.blog_stats) then
    raise exception 'FAIL: blog data left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  if (select value from public.game_config where key = 'blog_posts_max_per_day') <> '5'
     or (select value from public.game_config where key = 'blog_comment_max_per_hour') <> '20' then
    raise exception 'FAIL: a limit was left changed';
  end if;
  raise notice 'OK 11: the test left nothing behind';
end $$;

select 'ALL BLOG TESTS PASSED' as result;
