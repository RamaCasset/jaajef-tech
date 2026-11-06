-- Tests for Souk submission images.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f souk_images.test.sql
-- Each DO block is its own transaction on purpose. Everything created here is deleted at the end.
--
-- People: ana (1) creator; bara (2) another member; sam (3) shop manager; dame (4) admin; eli (5) buyer.

create schema sik;
grant usage on schema sik to public;

-- Like real Supabase, visitors may try to read storage; the rules decide. (Removed at the end.)
grant select on storage.objects to anon;

create function sik.uid(p_n int) returns uuid
language sql immutable as $$ select ('d4d4d4d4-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function sik.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', sik.uid(p_n)::text, true);
end $$;

create function sik.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function sik.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function sik.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := sik.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

-- A valid image path in member n's folder.
create function sik.img(p_n int, p_k int, p_ext text default 'png') returns text
language sql immutable as $$
  select sik.uid(p_n)::text || '/0000000' || p_k || '-0000-0000-0000-000000000000.' || p_ext
$$;

-- Can member n (0 = visitor) open this file?
create function sik.can_open(p_n int, p_path text) returns boolean
language plpgsql as $$
declare v boolean;
begin
  if p_n = 0 then perform sik.as_anon(); else perform sik.as_user(p_n); end if;
  v := exists (select 1 from storage.objects where bucket_id = 'souk-images' and name = p_path);
  reset role;
  return v;
end $$;

create function sik.sub(p_name text) returns uuid
language sql stable security definer as $$ select id from public.souk_submissions where name = p_name order by created_at desc limit 1 $$;

create function sik.item(p_name text) returns uuid
language sql stable security definer as $$ select id from public.souk_items where name = p_name $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (sik.uid(1), 'ana@exemple.sn', '{"provider":"email"}', '{}'),
  (sik.uid(2), 'bara@exemple.sn', '{"provider":"email"}', '{}'),
  (sik.uid(3), 'sam@exemple.sn', '{"provider":"email"}', '{}'),
  (sik.uid(4), 'dame@exemple.sn', '{"provider":"email"}', '{}'),
  (sik.uid(5), 'eli@exemple.sn', '{"provider":"email"}', '{}');

update public.game_config set value = '10'::jsonb where key = 'souk_submissions_max_per_day';

do $$
begin
  set local role service_role;
  perform public.make_admin(sik.uid(4));
  perform public.grant_reward(sik.uid(5), 0, 500, 'test_credit', 'sik:credit', null, null);
  reset role;
  perform sik.as_user(4);
  perform public.set_back_office_role(sik.uid(3), 'shop_manager', true);
  reset role;
  perform sik.as_user(1);
  perform public.submit_souk_item('avatar_frame', 'Cadre dore', 'Un cadre', '{"border":"gold"}', 100);
  perform public.submit_souk_item('status_badge', 'Badge texte', null, '{"text":"Dev"}', 20);
  perform public.submit_souk_item('avatar_frame', 'Cadre faux', null, '{"image_path":"x"}', 50);
  perform public.submit_souk_item('status_badge', 'Badge faux', null, jsonb_build_object('image_path', sik.uid(1)::text || '/00000001-0000-0000-0000-000000000000.png'), 25);
  reset role;
end $$;

-- ---- 1. Uploading ---------------------------------------------------------------------------------------------
do $$
begin
  perform sik.as_user(1);
  insert into storage.objects (bucket_id, name) values ('souk-images', sik.img(1, 1));
  perform sik.must_fail('uploading into someone else''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'souk-images', sik.img(2, 1)), 'row-level security');
  perform sik.must_fail('uploading into the root', $q$insert into storage.objects (bucket_id, name) values ('souk-images', 'vrac.png')$q$, 'row-level security');
  perform sik.must_fail('uploading an SVG', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'souk-images', sik.img(1, 2, 'svg')), 'row-level security');
  perform sik.must_fail('uploading a JPG', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'souk-images', sik.img(1, 2, 'jpg')), 'row-level security');
  insert into storage.objects (bucket_id, name) values ('souk-images', sik.img(1, 2, 'webp'));
  reset role;
  perform sik.as_anon();
  perform sik.must_fail('a visitor uploads', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'souk-images', sik.img(1, 3)), 'permission denied');
  reset role;
  if (select file_size_limit from storage.buckets where id = 'souk-images') <> 512000 or (select public from storage.buckets where id = 'souk-images') then raise exception 'FAIL: bucket is private with a 500 KB limit'; end if;
  if (select allowed_mime_types from storage.buckets where id = 'souk-images') <> array['image/png', 'image/webp'] then raise exception 'FAIL: only PNG and WebP'; end if;
  raise notice 'OK 1: uploads go into your own folder, as PNG or WebP only, into a private bucket';
end $$;

-- ---- 2. Attaching to a submission --------------------------------------------------------------------------
do $$
declare s uuid := sik.sub('Cadre dore'); r text;
begin
  perform sik.as_user(1);
  perform sik.must_fail('an SVG path', format('select public.attach_submission_image(%L, %L)', s, sik.img(1, 2, 'svg')), 'PNG or WebP');
  perform sik.must_fail('someone else''s folder', format('select public.attach_submission_image(%L, %L)', s, sik.img(2, 1)), 'PNG or WebP');
  perform sik.must_fail('a file never uploaded', format('select public.attach_submission_image(%L, %L)', s, sik.img(1, 9)), 'not uploaded');
  perform sik.must_fail('an unknown submission', format('select public.attach_submission_image(%L, %L)', gen_random_uuid(), sik.img(1, 1)), 'not found');
  r := public.attach_submission_image(s, sik.img(1, 1));
  if r is not null then raise exception 'FAIL: nothing to delete the first time'; end if;
  r := public.attach_submission_image(s, sik.img(1, 1));
  if r is not null then raise exception 'FAIL: same file again: nothing to delete'; end if;
  r := public.attach_submission_image(s, sik.img(1, 2, 'webp'));
  if r <> sik.img(1, 1) then raise exception 'FAIL: replacing returns the old path, got %', r; end if;
  r := public.remove_submission_image(s);
  if r <> sik.img(1, 2, 'webp') then raise exception 'FAIL: removing returns the path'; end if;
  perform public.attach_submission_image(s, sik.img(1, 1));
  reset role;
  perform sik.as_user(2);
  insert into storage.objects (bucket_id, name) values ('souk-images', sik.img(2, 1));
  perform sik.must_fail('another member attaches', format('select public.attach_submission_image(%L, %L)', s, sik.img(2, 1)), 'not found');
  perform sik.must_fail('another member removes', format('select public.remove_submission_image(%L)', s), 'not found');
  reset role;
  perform sik.as_anon();
  perform sik.must_fail('a visitor attaches', format('select public.attach_submission_image(%L, %L)', s, sik.img(1, 1)), 'permission denied');
  reset role;
  raise notice 'OK 2: only the creator attaches a checked image of her own to a waiting submission';
end $$;

-- ---- 3. Who can open the image during review ------------------------------------------------------------
do $$
declare p text := sik.img(1, 1);
begin
  if not sik.can_open(1, p) then raise exception 'FAIL: the creator opens it'; end if;
  if not sik.can_open(3, p) then raise exception 'FAIL: shop staff open it'; end if;
  if not sik.can_open(4, p) then raise exception 'FAIL: an admin opens it'; end if;
  if sik.can_open(2, p) then raise exception 'FAIL: another member must not open an unreviewed image'; end if;
  if sik.can_open(0, p) then raise exception 'FAIL: a visitor must not open an unreviewed image'; end if;
  perform sik.as_user(3);
  if (select image_path from public.list_souk_submissions('pending') where name = 'Cadre dore') <> p then raise exception 'FAIL: the queue shows the image path'; end if;
  reset role;
  -- the creator cannot delete an image waiting for review, even with an unfiltered delete
  perform sik.as_user(1);
  delete from storage.objects where bucket_id = 'souk-images';
  reset role;
  if not exists (select 1 from storage.objects where name = p) then raise exception 'FAIL: an image waiting for review cannot be deleted'; end if;
  raise notice 'OK 3: creator and shop staff open an unreviewed image; nobody else; the creator cannot delete it';
end $$;

-- ---- 4. Approving ---------------------------------------------------------------------------------------
do $$
declare p text := sik.img(1, 1); item uuid;
begin
  perform sik.as_user(3);
  perform sik.must_fail('a frame with no image', format('select public.review_souk_submission(%L, true)', sik.sub('Cadre faux')), 'needs an image');
  -- a status badge with no image is fine
  perform public.review_souk_submission(sik.sub('Badge texte'), true);
  if (select data ->> 'image_path' from public.souk_items where name = 'Badge texte') is not null then raise exception 'FAIL: no image on a text badge'; end if;
  item := public.review_souk_submission(sik.sub('Cadre dore'), true);
  reset role;
  if (select data ->> 'image_path' from public.souk_items where id = item) <> p then raise exception 'FAIL: the item points at the checked image'; end if;
  if (select data ->> 'border' from public.souk_items where id = item) <> 'gold' then raise exception 'FAIL: the rest of the look is kept'; end if;

  -- an image_path typed inside the look is ignored
  perform sik.as_user(1);
  insert into storage.objects (bucket_id, name) values ('souk-images', sik.img(1, 5));
  perform public.attach_submission_image(sik.sub('Cadre faux'), sik.img(1, 5));
  reset role;
  perform sik.as_user(3);
  item := public.review_souk_submission(sik.sub('Cadre faux'), true);
  reset role;
  if (select data ->> 'image_path' from public.souk_items where id = item) <> sik.img(1, 5) then raise exception 'FAIL: only the checked upload counts'; end if;
  -- a badge with a typed image_path and no real upload: the path is dropped
  perform sik.as_user(3);
  item := public.review_souk_submission(sik.sub('Badge faux'), true);
  reset role;
  if (select data ->> 'image_path' from public.souk_items where id = item) is not null then raise exception 'FAIL: a typed image_path with no upload must be dropped'; end if;
  raise notice 'OK 4: frames need an image; the item keeps the checked file; a typed image_path is ignored';
end $$;

-- ---- 5. After approval -------------------------------------------------------------------------------------
do $$
declare p text := sik.img(1, 1);
begin
  if not sik.can_open(0, p) then raise exception 'FAIL: a visitor opens the image of an item on sale'; end if;
  if not sik.can_open(2, p) then raise exception 'FAIL: any member opens it'; end if;
  -- the creator still cannot delete it: an item uses it
  perform sik.as_user(1);
  delete from storage.objects where name = p;
  reset role;
  if not exists (select 1 from storage.objects where name = p) then raise exception 'FAIL: an image used by an item cannot be deleted'; end if;

  -- eli buys it, then the item is taken off sale
  perform sik.as_user(5);
  perform public.buy_item(sik.item('Cadre dore'));
  reset role;
  update public.souk_items set is_active = false where name = 'Cadre dore';
  if sik.can_open(0, p) then raise exception 'FAIL: a visitor must not open an image of an item off sale'; end if;
  if sik.can_open(2, p) then raise exception 'FAIL: a non-owner must not open it'; end if;
  if not sik.can_open(5, p) then raise exception 'FAIL: the owner keeps access'; end if;
  if not sik.can_open(1, p) then raise exception 'FAIL: the creator keeps access to her own file'; end if;
  update public.souk_items set is_active = true where name = 'Cadre dore';
  raise notice 'OK 5: items on sale show their image to everyone; off sale, only owners and the creator can';
end $$;

-- ---- 6. Unused files --------------------------------------------------------------------------------------
do $$
declare s uuid; extra text := sik.img(1, 6);
begin
  perform sik.as_user(1);
  insert into storage.objects (bucket_id, name) values ('souk-images', extra);
  s := public.submit_souk_item('avatar_frame', 'Cadre rejete', null, '{}', 30);
  perform public.attach_submission_image(s, extra);
  if exists (select 1 from public.list_unused_souk_images() f where f = extra) then raise exception 'FAIL: a waiting image is in use'; end if;
  reset role;
  perform sik.as_user(3);
  perform public.review_souk_submission(s, false, 'Pas assez net');
  reset role;
  perform sik.as_user(1);
  if (select count(*) from public.list_unused_souk_images()) <> 1 then raise exception 'FAIL: only the rejected image is unused (the earlier unused file went in the unfiltered delete), got %', (select count(*) from public.list_unused_souk_images()); end if;
  delete from storage.objects where name = extra;
  if exists (select 1 from storage.objects where name = extra) then raise exception 'FAIL: an unused image can be deleted'; end if;
  reset role;
  perform sik.as_user(2);
  if (select count(*) from public.list_unused_souk_images()) <> 1 or (select min(f) from public.list_unused_souk_images() f) <> sik.img(2, 1) then raise exception 'FAIL: bara sees only her own unused file'; end if;
  reset role;
  perform sik.as_anon();
  perform sik.must_fail('a visitor lists files', 'select * from public.list_unused_souk_images()', 'permission denied');
  reset role;
  raise notice 'OK 6: images nobody uses are listed and can be deleted by their creator';
end $$;

-- ---- Clean up ---------------------------------------------------------------------------------------------------------
delete from storage.objects where bucket_id = 'souk-images';
delete from public.member_items where user_id::text like 'd4d4d4d4-%';
delete from public.souk_items where creator_id::text like 'd4d4d4d4-%';
delete from public.profiles where id::text like 'd4d4d4d4-%';
delete from auth.users where id::text like 'd4d4d4d4-%';
revoke select on storage.objects from anon;
update public.game_config set value = '3'::jsonb where key = 'souk_submissions_max_per_day';
drop schema sik cascade;

do $$
begin
  if exists (select 1 from public.souk_submissions) or exists (select 1 from public.souk_items where creator_id is not null) or exists (select 1 from storage.objects where bucket_id = 'souk-images') then
    raise exception 'FAIL: data left behind';
  end if;
  if exists (select 1 from public.back_office_roles) or exists (select 1 from public.staff_roles) then raise exception 'FAIL: roles left behind'; end if;
  raise notice 'OK 7: the test left nothing behind';
end $$;

select 'ALL SOUK IMAGES TESTS PASSED' as result;
