-- Tests for @mentions and quest-solved notices.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f mentions.test.sql
-- Everything created here is deleted at the end.
--
-- People: ana (1) owns a project and writes a blog post; bara (2) comments and tags; coumba (3) and dame (4) get tagged.

create schema mtkit;
grant usage on schema mtkit to public;

create function mtkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('7b7b7b7b-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function mtkit.n(p_user int, p_kind text) returns int
language sql stable security definer as $$
  select count(*)::int from public.notifications where user_id = mtkit.uid(p_user) and kind = p_kind
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (mtkit.uid(1), 'ana-mt@exemple.sn', '{"provider":"email"}', '{}'),
  (mtkit.uid(2), 'bara-mt@exemple.sn', '{"provider":"email"}', '{}'),
  (mtkit.uid(3), 'coumba-mt@exemple.sn', '{"provider":"email"}', '{}'),
  (mtkit.uid(4), 'dame-mt@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  update public.profiles set username = 'ana_mt' where id = mtkit.uid(1);
  update public.profiles set username = 'bara_mt' where id = mtkit.uid(2);
  update public.profiles set username = 'coumba_mt' where id = mtkit.uid(3);
  update public.profiles set username = 'dame_mt' where id = mtkit.uid(4);
  insert into public.projects (owner_id, github_owner, github_repo, title, verified_at) values (mtkit.uid(1), 'ana-dev', 'mt-ana', 'Projet Ana', now());
end $$;

-- ---- 1. Reading the tags -------------------------------------------------------------------------------------------
do $$
begin
  if public.mentioned_usernames('Salut @Coumba_MT et @dame_mt, @coumba_mt encore') <> array['coumba_mt', 'dame_mt'] and public.mentioned_usernames('Salut @Coumba_MT et @dame_mt, @coumba_mt encore') <> array['dame_mt', 'coumba_mt'] then
    raise exception 'FAIL: names are lower-cased and listed once, got %', public.mentioned_usernames('Salut @Coumba_MT et @dame_mt, @coumba_mt encore');
  end if;
  if cardinality(public.mentioned_usernames('mail: ana@exemple.sn')) <> 0 then raise exception 'FAIL: an e-mail address is not a tag'; end if;
  if cardinality(public.mentioned_usernames('@ab trop court')) <> 0 then raise exception 'FAIL: names under 3 characters are not tags'; end if;
  if cardinality(public.mentioned_usernames(null)) <> 0 then raise exception 'FAIL: nothing to read'; end if;
  raise notice 'OK 1: tags are read as lower-case names, once each; e-mails and short names are ignored';
end $$;

-- ---- 2. Project comments -----------------------------------------------------------------------------------------
do $$
declare p uuid := (select id from public.projects where github_repo = 'mt-ana');
begin
  insert into public.project_comments (project_id, author_id, body) values (p, mtkit.uid(2), 'Bravo ! @coumba_mt regarde, et @ana_mt aussi, et @bara_mt moi-meme');
  if mtkit.n(3, 'mention') <> 1 then raise exception 'FAIL: the tagged member should be told once'; end if;
  if mtkit.n(2, 'mention') <> 0 then raise exception 'FAIL: nobody is told about tagging themselves'; end if;
  if mtkit.n(1, 'mention') <> 0 then raise exception 'FAIL: the owner hears about the comment already, no second notice'; end if;
  if mtkit.n(1, 'project_comment') <> 1 then raise exception 'FAIL: the owner still gets the comment notice'; end if;
  if (select data ->> 'place' from public.notifications where user_id = mtkit.uid(3) and kind = 'mention') <> 'project' then raise exception 'FAIL: the notice says where'; end if;
  if (select data ->> 'actor_username' from public.notifications where user_id = mtkit.uid(3) and kind = 'mention') <> 'bara_mt' then raise exception 'FAIL: the notice says who'; end if;
  raise notice 'OK 2: a project comment tells the tagged member, not the author, and not the owner twice';
end $$;

-- ---- 3. Blog comments ----------------------------------------------------------------------------------------------
do $$
declare post uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', mtkit.uid(1)::text, true);
  post := public.create_blog_post('Article des tags', 'Un texte assez long pour passer.', 'Resume', null, array['tag'], true);
  reset role;
  insert into public.blog_comments (post_id, author_id, body) values (post, mtkit.uid(2), '@dame_mt lis ceci');
  if mtkit.n(4, 'mention') <> 1 then raise exception 'FAIL: a blog comment tags too'; end if;
  if (select data ->> 'place' from public.notifications where user_id = mtkit.uid(4) and kind = 'mention') <> 'blog' then raise exception 'FAIL: the place is the blog'; end if;
  if (select data ->> 'post_slug' from public.notifications where user_id = mtkit.uid(4) and kind = 'mention') is null then raise exception 'FAIL: the slug is in the notice'; end if;
  -- a member who muted mentions hears nothing
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', mtkit.uid(3)::text, true);
  perform public.set_notification_mute('mention', true);
  reset role;
  insert into public.blog_comments (post_id, author_id, body) values (post, mtkit.uid(2), 'Encore @coumba_mt');
  if mtkit.n(3, 'mention') <> 1 then raise exception 'FAIL: a muted kind stays quiet'; end if;
  raise notice 'OK 3: blog comments tag too, and a muted kind stays quiet';
end $$;

-- ---- 4. A quest solved ---------------------------------------------------------------------------------------------
do $$
declare q uuid;
begin
  insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward, kopek_reward, min_seconds, published)
  values ('mt-quest', 'Quete des tags', 'griot_du_code', 'ndongo', 'python', 5, 100, 10, 0, true) returning id into q;
  insert into public.quest_attempts (user_id, quest_id) values (mtkit.uid(2), q);
  if mtkit.n(2, 'quest_completed') <> 0 then raise exception 'FAIL: starting a quest tells nobody'; end if;
  update public.quest_attempts set status = 'solved', solved_at = now() where user_id = mtkit.uid(2) and quest_id = q;
  if mtkit.n(2, 'quest_completed') <> 1 then raise exception 'FAIL: solving tells the member'; end if;
  if (select (data ->> 'xp')::int from public.notifications where user_id = mtkit.uid(2) and kind = 'quest_completed') <> 100 then raise exception 'FAIL: the notice has the XP'; end if;
  update public.quest_attempts set code = 'x' where user_id = mtkit.uid(2) and quest_id = q;
  update public.quest_attempts set status = 'solved' where user_id = mtkit.uid(2) and quest_id = q;
  if mtkit.n(2, 'quest_completed') <> 1 then raise exception 'FAIL: only once'; end if;
  raise notice 'OK 4: solving a quest tells the member once, with what it paid';
end $$;

-- ---- Clean up ----------------------------------------------------------------------------------------------------------
delete from public.quests where slug = 'mt-quest';
delete from public.blog_posts where author_id::text like '7b7b7b7b-%';
delete from public.projects where owner_id::text like '7b7b7b7b-%';
delete from public.profiles where id::text like '7b7b7b7b-%';
delete from auth.users where id::text like '7b7b7b7b-%';
drop schema mtkit cascade;

do $$
begin
  if exists (select 1 from public.notifications where user_id::text like '7b7b7b7b-%') then raise exception 'FAIL: notices left behind'; end if;
  raise notice 'OK 5: the test left nothing behind';
end $$;

select 'ALL MENTION TESTS PASSED' as result;
