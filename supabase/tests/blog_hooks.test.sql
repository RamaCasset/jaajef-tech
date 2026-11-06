-- Tests for the blog hooks: notices, global search, and reports on blog posts,
-- blog comments and job offers.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f blog_hooks.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) writes the blog; bara (2) reads, comments, reports; coumba (3) company with an offer;
-- dame (4) admin; eli (5) a bystander.

create schema bhkit;
grant usage on schema bhkit to public;

create function bhkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('9a9a9a9a-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function bhkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', bhkit.uid(p_n)::text, true);
end $$;

create function bhkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function bhkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function bhkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := bhkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

create function bhkit.notices(p_n int, p_kind text) returns bigint
language sql stable security definer as $$
  select count(*) from public.notifications where user_id = bhkit.uid(p_n) and kind = p_kind
$$;

create function bhkit.post(p_title text) returns uuid
language sql stable security definer as $$ select id from public.blog_posts where title = p_title $$;

create function bhkit.offer(p_title text) returns uuid
language sql stable security definer as $$ select id from public.job_offers where title = p_title $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (bhkit.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (bhkit.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (bhkit.uid(3), 'coumba@exemple.sn', '{"provider":"email"}', '{}'),
  (bhkit.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (bhkit.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}');

-- ---- Setup ------------------------------------------------------------------------------------------------------
do $$
declare e uuid;
begin
  set local role service_role;
  perform public.make_admin(bhkit.uid(4));
  reset role;
  perform bhkit.as_user(1);
  perform public.create_blog_post('Apprendre Rust au Senegal', 'Un long article sur Rust.', 'Un resume', null, array['rust'], true);
  perform public.create_blog_post('Article en brouillon rustique', 'Pas encore publie.');
  reset role;
  perform bhkit.as_user(3);
  e := public.create_employer('company', 'Atelier Coumba');
  reset role;
  perform bhkit.as_user(4);
  perform public.review_employer(e, true);
  reset role;
  perform bhkit.as_user(3);
  perform public.create_job_offer('Dev Rust a Dakar', 'job', 'Poste de developpeur', 'full_time', 'Dakar', 'onsite', null, null, null, false, array['rust'], null, true);
  reset role;
end $$;

-- ---- 1. Notices ----------------------------------------------------------------------------------------------------
do $$
declare p uuid := bhkit.post('Apprendre Rust au Senegal');
begin
  perform bhkit.as_user(2);
  perform public.like_blog_post(p);
  perform public.unlike_blog_post(p);
  perform public.like_blog_post(p);
  perform public.post_blog_comment(p, 'Merci pour cet article');
  reset role;
  if bhkit.notices(1, 'blog_like') <> 1 then raise exception 'FAIL: one like notice only, even after unlike and like again, got %', bhkit.notices(1, 'blog_like'); end if;
  if bhkit.notices(1, 'blog_comment') <> 1 then raise exception 'FAIL: one comment notice'; end if;
  if (select data ->> 'excerpt' from public.notifications where user_id = bhkit.uid(1) and kind = 'blog_comment') <> 'Merci pour cet article' then raise exception 'FAIL: comment excerpt'; end if;
  if (select data ->> 'post_slug' from public.notifications where user_id = bhkit.uid(1) and kind = 'blog_like') is null then raise exception 'FAIL: slug in the notice'; end if;

  -- your own like and comment do not notify you
  perform bhkit.as_user(1);
  perform public.like_blog_post(p);
  perform public.post_blog_comment(p, 'Merci a tous');
  reset role;
  if bhkit.notices(1, 'blog_like') <> 1 or bhkit.notices(1, 'blog_comment') <> 1 then raise exception 'FAIL: no notice for your own actions'; end if;

  -- a muted kind stays quiet
  perform bhkit.as_user(1);
  perform public.set_notification_mute('blog_like', true);
  reset role;
  perform bhkit.as_user(5);
  perform public.like_blog_post(p);
  reset role;
  if bhkit.notices(1, 'blog_like') <> 1 then raise exception 'FAIL: muted like notices'; end if;
  perform bhkit.as_user(1);
  perform public.set_notification_mute('blog_like', false);
  perform bhkit.must_fail('muting a locked kind', 'select public.set_notification_mute(''blog_hidden'', true)', 'cannot');
  perform bhkit.must_fail('muting a locked kind', 'select public.set_notification_mute(''job_offer_hidden'', true)', 'cannot');
  reset role;
  raise notice 'OK 1: authors get one notice per comment and per liker, none for their own actions, and mutes are respected';
end $$;

-- ---- 2. Search ---------------------------------------------------------------------------------------------------
do $$
begin
  perform bhkit.as_anon();
  if (select count(*) from public.search_everything('rust') where kind = 'post') <> 1 then raise exception 'FAIL: the published post is found by a visitor, got %', (select count(*) from public.search_everything('rust') where kind = 'post'); end if;
  if (select title from public.search_everything('rust') where kind = 'post') <> 'Apprendre Rust au Senegal' then raise exception 'FAIL: the draft must not show'; end if;
  if (select count(*) from public.search_everything('resume') where kind = 'post') <> 1 then raise exception 'FAIL: found by summary'; end if;
  reset role;
  raise notice 'OK 2: published posts are searchable by everyone, drafts are not';
end $$;

-- ---- 3. Reporting a blog post and its comments --------------------------------------------------------------
do $$
declare p uuid := bhkit.post('Apprendre Rust au Senegal'); r uuid; c bigint; r2 uuid;
begin
  perform bhkit.as_anon();
  perform bhkit.must_fail('a visitor reports', format('select public.report_content(%L, %L, %L)', 'blog_post', p::text, 'spam'), 'permission denied');
  reset role;
  perform bhkit.as_user(2);
  perform bhkit.must_fail('a draft', format('select public.report_content(%L, %L, %L)', 'blog_post', bhkit.post('Article en brouillon rustique')::text, 'spam'), 'Target not found');
  perform bhkit.must_fail('a bad id', 'select public.report_content(''blog_post'', ''pas-un-id'', ''spam'')', 'Target not found');
  r := public.report_content('blog_post', p::text, 'spam', 'Publicite deguisee');
  perform bhkit.must_fail('reporting twice', format('select public.report_content(%L, %L, %L)', 'blog_post', p::text, 'spam'), 'already reported');
  select id into c from public.blog_comments where author_id = bhkit.uid(1);
  r2 := public.report_content('blog_comment', c::text, 'harassment');
  reset role;
  perform bhkit.as_user(1);
  perform bhkit.must_fail('reporting your own post', format('select public.report_content(%L, %L, %L)', 'blog_post', p::text, 'spam'), 'own content');
  reset role;
  if (select snapshot ->> 'title' from public.reports where id = r) <> 'Apprendre Rust au Senegal' then raise exception 'FAIL: snapshot of the post'; end if;
  if (select target_author_id from public.reports where id = r) <> bhkit.uid(1) then raise exception 'FAIL: author of the report'; end if;

  -- staff remove the comment
  perform bhkit.as_user(4);
  perform public.resolve_report(r2, 'remove_content');
  if exists (select 1 from public.blog_comments where id = c) then raise exception 'FAIL: the comment is deleted'; end if;
  -- staff remove the post: it is hidden and the author is told
  perform public.resolve_report(r, 'remove_content', 'Spam');
  reset role;
  if not (select staff_hidden from public.blog_posts where id = p) then raise exception 'FAIL: the post is hidden'; end if;
  if bhkit.notices(1, 'blog_hidden') <> 1 then raise exception 'FAIL: the author is told'; end if;
  perform bhkit.as_anon();
  if exists (select 1 from public.search_everything('rust') where kind = 'post') then raise exception 'FAIL: a hidden post leaves the search'; end if;
  reset role;
  perform bhkit.as_user(2);
  perform bhkit.must_fail('reporting a hidden post', format('select public.report_content(%L, %L, %L)', 'blog_post', p::text, 'scam'), 'Target not found');
  reset role;
  -- the staff tool for hiding also tells the author, once
  perform bhkit.as_user(4);
  perform public.set_blog_post_hidden(p, false);
  perform public.set_blog_post_hidden(p, true, 'Encore');
  reset role;
  if bhkit.notices(1, 'blog_hidden') <> 2 then raise exception 'FAIL: each new hide tells the author, got %', bhkit.notices(1, 'blog_hidden'); end if;
  perform bhkit.as_user(4);
  perform public.set_blog_post_hidden(p, false);
  reset role;
  raise notice 'OK 3: blog posts and comments can be reported and handled; hiding tells the author';
end $$;

-- ---- 4. Reporting a job offer --------------------------------------------------------------------------------
do $$
declare o uuid := bhkit.offer('Dev Rust a Dakar'); r uuid;
begin
  perform bhkit.as_user(2);
  perform bhkit.must_fail('an unknown offer', format('select public.report_content(%L, %L, %L)', 'job_offer', gen_random_uuid()::text, 'scam'), 'Target not found');
  r := public.report_content('job_offer', o::text, 'scam', 'Demande de l''argent');
  reset role;
  perform bhkit.as_user(3);
  perform bhkit.must_fail('reporting your own offer', format('select public.report_content(%L, %L, %L)', 'job_offer', o::text, 'scam'), 'own content');
  reset role;
  if (select target_author_id from public.reports where id = r) <> bhkit.uid(3) then raise exception 'FAIL: the poster is the author'; end if;
  perform bhkit.as_user(4);
  perform public.resolve_report(r, 'remove_content');
  reset role;
  if not (select staff_hidden from public.job_offers where id = o) then raise exception 'FAIL: the offer is hidden'; end if;
  if bhkit.notices(3, 'job_offer_hidden') <> 1 then raise exception 'FAIL: the poster is told'; end if;
  perform bhkit.as_anon();
  if exists (select 1 from public.search_job_offers() where id = o) then raise exception 'FAIL: hidden offers leave the board'; end if;
  reset role;
  perform bhkit.as_user(2);
  perform bhkit.must_fail('reporting a hidden offer', format('select public.report_content(%L, %L, %L)', 'job_offer', o::text, 'scam'), 'Target not found');
  reset role;
  -- the staff tool also tells the poster
  perform bhkit.as_user(4);
  perform public.set_job_offer_hidden(o, false);
  perform public.set_job_offer_hidden(o, true, 'Verification');
  reset role;
  if bhkit.notices(3, 'job_offer_hidden') <> 2 then raise exception 'FAIL: second hide tells the poster'; end if;
  raise notice 'OK 4: job offers can be reported and handled; hiding tells the poster';
end $$;

-- ---- 5. The old report types still work and others are still refused -------------------------------------
do $$
begin
  perform bhkit.as_user(2);
  perform bhkit.must_fail('reporting a community', format('select public.report_content(%L, %L, %L)', 'community', 'x', 'spam'), 'You can report');
  perform public.report_content('member', bhkit.uid(5)::text, 'spam');
  reset role;
  raise notice 'OK 5: members can still be reported; unknown targets are still refused';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from public.reports where reporter_id::text like '9a9a9a9a-%';
delete from public.member_warnings where user_id::text like '9a9a9a9a-%';
delete from public.profiles where id::text like '9a9a9a9a-%';
delete from auth.users where id::text like '9a9a9a9a-%';
drop schema bhkit cascade;

do $$
begin
  if exists (select 1 from public.blog_posts) or exists (select 1 from public.job_offers) or exists (select 1 from public.employers)
     or exists (select 1 from public.reports) then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: staff left behind'; end if;
  raise notice 'OK 6: the test left nothing behind';
end $$;

select 'ALL BLOG HOOKS TESTS PASSED' as result;
