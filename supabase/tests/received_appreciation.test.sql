-- Test for received_appreciation. Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f received_appreciation.test.sql
-- Everything this test creates is deleted at the end.
-- People: ana (...1) owns projects and writes posts; bara (...2) and coumba (...3) star and like.

create schema apkit;
grant usage on schema apkit to public;
create function apkit.uid(p_n int) returns uuid language sql immutable as $$ select ('a9a9a9a9-0000-0000-0000-00000000000' || p_n)::uuid $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (apkit.uid(1), 'ana-ap@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(2), 'bara-ap@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(3), 'coumba-ap@exemple.sn', '{"provider":"email"}', '{}'),
  (apkit.uid(4), 'dior-ap@exemple.sn', '{"provider":"email"}', '{}');

do $$
declare shown uuid; pending uuid; hidden uuid; pub uuid; draft uuid;
begin
  if public.received_appreciation(apkit.uid(1)) <> 0 then raise exception 'FAIL: a new member should have 0'; end if;

  insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public, staff_hidden) values
    (apkit.uid(1), 'ana-ap', 'shown', 'Visible', now(), true, false) returning id into shown;
  insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public, staff_hidden) values
    (apkit.uid(1), 'ana-ap', 'pending', 'En attente', null, true, false) returning id into pending;
  insert into public.projects (owner_id, github_owner, github_repo, title, verified_at, is_public, staff_hidden) values
    (apkit.uid(1), 'ana-ap', 'hidden', 'Cache', now(), true, true) returning id into hidden;
  insert into public.project_stars (project_id, user_id) values
    (shown, apkit.uid(2)), (shown, apkit.uid(3)), (pending, apkit.uid(2)), (hidden, apkit.uid(2));
  if public.received_appreciation(apkit.uid(1)) <> 2 then
    raise exception 'FAIL: only stars on a visible project count, got %', public.received_appreciation(apkit.uid(1));
  end if;

  insert into public.blog_posts (author_id, slug, title, body, status, published_at) values
    (apkit.uid(1), 'ap-publie', 'Publie', 'corps', 'published', now()) returning id into pub;
  insert into public.blog_posts (author_id, slug, title, body, status) values
    (apkit.uid(1), 'ap-brouillon', 'Brouillon', 'corps', 'draft') returning id into draft;
  insert into public.blog_likes (post_id, user_id) values (pub, apkit.uid(2)), (pub, apkit.uid(3)), (draft, apkit.uid(2));
  if public.received_appreciation(apkit.uid(1)) <> 4 then
    raise exception 'FAIL: likes on a published post should be added, and a draft ignored, got %', public.received_appreciation(apkit.uid(1));
  end if;

  update public.projects set staff_hidden = true where id = shown;
  if public.received_appreciation(apkit.uid(1)) <> 2 then raise exception 'FAIL: hiding a project should remove its stars'; end if;
  if public.received_appreciation(apkit.uid(2)) <> 0 then raise exception 'FAIL: giving stars should earn nothing'; end if;

  set local role authenticated;
  if public.received_appreciation(apkit.uid(1)) <> 2 then raise exception 'FAIL: a signed-in member should see the same number'; end if;
  reset role;
  set local role anon;
  begin
    perform public.received_appreciation(apkit.uid(1));
    raise exception 'FAIL: a visitor should not be able to run it';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'OK 1: stars on visible projects plus likes on published posts, nothing else';
end $$;

-- The "Teranga légendaire" badge unlocks from this number. The goal is lowered to 3 for the test and put back.
do $$
declare shown uuid;
begin
  if (select metric from public.badge_rules where badge_slug = 'teranga_legendaire') <> 'appreciation' then
    raise exception 'FAIL: the badge should be counted from appreciation';
  end if;
  if (select threshold from public.badge_rules where badge_slug = 'teranga_legendaire') <> 100 then
    raise exception 'FAIL: the goal should be 100';
  end if;
  if exists (select 1 from public.badges where slug = 'teranga_legendaire' and description ilike '%karma%') then
    raise exception 'FAIL: the word karma should be gone';
  end if;
  update public.badge_rules set threshold = 3 where badge_slug = 'teranga_legendaire';
  select id into shown from public.projects where owner_id = apkit.uid(1) and github_repo = 'shown';
  update public.projects set staff_hidden = false where id = shown;
  if exists (select 1 from public.user_badges where user_id = apkit.uid(1) and badge_slug = 'teranga_legendaire' and unlocked_at is not null) then
    raise exception 'FAIL: the badge unlocked too early';
  end if;
  insert into public.project_stars (project_id, user_id) values (shown, apkit.uid(4));
  if not exists (select 1 from public.user_badges where user_id = apkit.uid(1) and badge_slug = 'teranga_legendaire' and unlocked_at is not null) then
    raise exception 'FAIL: reaching the goal should unlock the badge';
  end if;
  update public.badge_rules set threshold = 100 where badge_slug = 'teranga_legendaire';
  raise notice 'OK 2: the Teranga légendaire badge unlocks when the goal is reached';
end $$;

-- Clean up
delete from public.blog_posts where author_id = apkit.uid(1);
delete from public.projects where owner_id = apkit.uid(1);
delete from auth.users where id in (apkit.uid(1), apkit.uid(2), apkit.uid(3), apkit.uid(4));
drop schema apkit cascade;
