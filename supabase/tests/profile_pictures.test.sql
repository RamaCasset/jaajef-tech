-- Tests for profile pictures and the short title. Run AFTER all migrations.
-- psql -v ON_ERROR_STOP=1 -f profile_pictures.test.sql
-- People: ana (1) and bara (2). Everything created here is deleted at the end.

create schema ppk;
grant usage on schema ppk to public;
create function ppk.uid(p_n int) returns uuid language sql immutable as $$ select ('b7b7b7b7-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function ppk.as_user(p_n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', ppk.uid(p_n)::text, true);
end $$;
create function ppk.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function ppk.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := ppk.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;
create function ppk.img(p_n int, p_kind text, p_ext text default 'png') returns text language sql immutable as $$
  select ppk.uid(p_n)::text || '/' || p_kind || '-00000001-0000-0000-0000-000000000000.' || p_ext
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (ppk.uid(1), 'ana-pp@exemple.sn', '{"provider":"email"}', '{}'),
  (ppk.uid(2), 'bara-pp@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'profile-images' and public) then
    raise exception 'FAIL: the profile-images bucket should exist and be public';
  end if;

  perform ppk.as_user(1);
  insert into storage.objects (bucket_id, name) values ('profile-images', ppk.img(1, 'avatar'));
  insert into storage.objects (bucket_id, name) values ('profile-images', ppk.img(1, 'cover', 'webp'));
  insert into storage.objects (bucket_id, name) values ('profile-images', ppk.img(1, 'avatar', 'jpg'));
  perform ppk.must_fail('uploading into someone else''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'profile-images', ppk.img(2, 'avatar')), 'row-level security');
  perform ppk.must_fail('uploading into the root', $q$insert into storage.objects (bucket_id, name) values ('profile-images', 'vrac.png')$q$, 'row-level security');
  perform ppk.must_fail('uploading an SVG', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'profile-images', ppk.img(1, 'avatar', 'svg')), 'row-level security');
  perform ppk.must_fail('uploading with a made-up name', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'profile-images', ppk.uid(1)::text || '/autre.png'), 'row-level security');
  reset role;
  raise notice 'OK 1: members upload PNG, JPEG or WebP pictures into their own folder only';
end $$;

do $$
declare n int;
begin
  perform ppk.as_user(2);
  delete from storage.objects where bucket_id = 'profile-images' and name = ppk.img(1, 'avatar');
  reset role;
  if not exists (select 1 from storage.objects where bucket_id = 'profile-images' and name = ppk.img(1, 'avatar')) then
    raise exception 'FAIL: another member deleted a picture';
  end if;
  perform ppk.as_user(1);
  delete from storage.objects where bucket_id = 'profile-images' and name = ppk.img(1, 'avatar');
  reset role;
  if exists (select 1 from storage.objects where bucket_id = 'profile-images' and name = ppk.img(1, 'avatar')) then
    raise exception 'FAIL: a member could not delete their own picture';
  end if;
  select count(*) into n from public.account_files(ppk.uid(1)) where bucket_id = 'profile-images';
  if n <> 2 then raise exception 'FAIL: account deletion should list the 2 remaining pictures, got %', n; end if;
  raise notice 'OK 2: only the owner deletes a picture, and account deletion finds them';
end $$;

do $$
begin
  perform ppk.as_user(1);
  update public.profiles set headline = 'Développeuse web à Dakar' where id = ppk.uid(1);
  update public.profiles set headline = null where id = ppk.uid(1);
  perform ppk.must_fail('a title over 80 characters', format('update public.profiles set headline = %L where id = %L', repeat('x', 81), ppk.uid(1)), 'check');
  update public.profiles set headline = 'Pirate' where id = ppk.uid(2);
  reset role;
  if (select headline from public.profiles where id = ppk.uid(2)) is not null then
    raise exception 'FAIL: a member changed someone else''s title';
  end if;
  raise notice 'OK 3: a member edits their own title only, 80 characters at most';
end $$;

delete from storage.objects where bucket_id = 'profile-images';
delete from auth.users where id::text like 'b7b7b7b7-%';
drop schema ppk cascade;
select 'ALL PROFILE PICTURE TESTS PASSED' as result;
