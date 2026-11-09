-- Deleting a member who owns a project with stars and comments must work, and the counters of a project that stays still go down.
-- Run AFTER all migrations.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('e5f6a7b8-0000-0000-0000-000000000001', 'owner-pcd@exemple.sn', '{"provider":"email"}', '{}'),
  ('e5f6a7b8-0000-0000-0000-000000000002', 'fan-pcd@exemple.sn', '{"provider":"email"}', '{}'),
  ('e5f6a7b8-0000-0000-0000-000000000003', 'other-pcd@exemple.sn', '{"provider":"email"}', '{}');

do $$
declare p1 uuid := 'e5f6a7b8-1111-0000-0000-000000000001'; p2 uuid := 'e5f6a7b8-1111-0000-0000-000000000002';
begin
  insert into public.projects (id, owner_id, github_owner, github_repo, title, verified_at) values
    (p1, 'e5f6a7b8-0000-0000-0000-000000000001', 'pcd-owner', 'one', 'Projet un', now()),
    (p2, 'e5f6a7b8-0000-0000-0000-000000000003', 'pcd-other', 'two', 'Projet deux', now());
  insert into public.project_stars (project_id, user_id) values (p1, 'e5f6a7b8-0000-0000-0000-000000000002'), (p2, 'e5f6a7b8-0000-0000-0000-000000000002'), (p2, 'e5f6a7b8-0000-0000-0000-000000000001');
  insert into public.project_comments (project_id, author_id, body) values (p1, 'e5f6a7b8-0000-0000-0000-000000000002', 'Bravo'), (p2, 'e5f6a7b8-0000-0000-0000-000000000001', 'Merci');

  -- 1. The owner of p1 goes away: p1 (with its star and comment) is deleted, no error
  delete from auth.users where id = 'e5f6a7b8-0000-0000-0000-000000000001';
  if exists (select 1 from public.projects where id = p1) then raise exception 'FAIL: the project stayed'; end if;

  -- 2. The other project lost one star and one comment (both came from the deleted member)
  if (select star_count from public.project_stats where project_id = p2) <> 1 then raise exception 'FAIL: star_count of the other project is %', (select star_count from public.project_stats where project_id = p2); end if;
  if (select comment_count from public.project_stats where project_id = p2) <> 0 then raise exception 'FAIL: comment_count of the other project is %', (select comment_count from public.project_stats where project_id = p2); end if;
  raise notice 'OK: deleting a member with a starred and commented project works, and other counters stay right';

  -- 3. The same for a blog post with two likes and two comments
  insert into public.blog_posts (id, author_id, slug, title, body, status, published_at)
  values ('e5f6a7b8-2222-0000-0000-000000000001', 'e5f6a7b8-0000-0000-0000-000000000003', 'pcd-article', 'Article', 'Texte', 'published', now());
  insert into public.blog_likes (post_id, user_id) values ('e5f6a7b8-2222-0000-0000-000000000001', 'e5f6a7b8-0000-0000-0000-000000000002'), ('e5f6a7b8-2222-0000-0000-000000000001', 'e5f6a7b8-0000-0000-0000-000000000003');
  insert into public.blog_comments (post_id, author_id, body) values ('e5f6a7b8-2222-0000-0000-000000000001', 'e5f6a7b8-0000-0000-0000-000000000002', 'a'), ('e5f6a7b8-2222-0000-0000-000000000001', 'e5f6a7b8-0000-0000-0000-000000000003', 'b');
  delete from auth.users where id = 'e5f6a7b8-0000-0000-0000-000000000003';
  if exists (select 1 from public.blog_posts where id = 'e5f6a7b8-2222-0000-0000-000000000001') then raise exception 'FAIL: the post stayed'; end if;
  raise notice 'OK: deleting a member with a liked and commented post works';

  delete from auth.users where id = 'e5f6a7b8-0000-0000-0000-000000000002';
end $$;
