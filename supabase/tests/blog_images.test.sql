-- Tests for blog pictures. Run AFTER all migrations.
-- People: ana (1) and bara (2). Everything created here is deleted at the end.

create schema bik;
grant usage on schema bik to public;
create function bik.uid(p_n int) returns uuid language sql immutable as $$ select ('a8c9d0e1-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function bik.as_user(p_n int) returns void language plpgsql as $$
begin set local role authenticated; perform set_config('request.jwt.claim.sub', bik.uid(p_n)::text, true); end $$;
create function bik.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function bik.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := bik.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e; end if;
end $$;
create function bik.img(p_n int, p_ext text default 'png') returns text language sql immutable as $$
  select bik.uid(p_n)::text || '/00000001-0000-0000-0000-000000000000.' || p_ext
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (bik.uid(1), 'ana-bi@exemple.sn', '{"provider":"email"}', '{}'),
  (bik.uid(2), 'bara-bi@exemple.sn', '{"provider":"email"}', '{}');

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'blog-images' and public) then
    raise exception 'FAIL: the blog-images bucket should exist and be public';
  end if;

  perform bik.as_user(1);
  insert into storage.objects (bucket_id, name) values ('blog-images', bik.img(1));
  insert into storage.objects (bucket_id, name) values ('blog-images', bik.img(1, 'webp'));
  perform bik.must_fail('uploading into someone else''s folder', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'blog-images', bik.img(2)), 'row-level security');
  perform bik.must_fail('uploading into the root', $q$insert into storage.objects (bucket_id, name) values ('blog-images', 'vrac.png')$q$, 'row-level security');
  perform bik.must_fail('uploading an SVG', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'blog-images', bik.img(1, 'svg')), 'row-level security');
  perform bik.must_fail('uploading with a made-up name', format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'blog-images', bik.uid(1)::text || '/autre.png'), 'row-level security');
  reset role;
  raise notice 'OK 1: members upload PNG, JPEG or WebP pictures into their own folder only';
end $$;

do $$
declare n int;
begin
  perform bik.as_user(2);
  delete from storage.objects where bucket_id = 'blog-images' and name = bik.img(1);
  reset role;
  if not exists (select 1 from storage.objects where bucket_id = 'blog-images' and name = bik.img(1)) then
    raise exception 'FAIL: another member deleted a picture';
  end if;
  perform bik.as_user(1);
  delete from storage.objects where bucket_id = 'blog-images' and name = bik.img(1);
  reset role;
  if exists (select 1 from storage.objects where bucket_id = 'blog-images' and name = bik.img(1)) then
    raise exception 'FAIL: a member could not delete their own picture';
  end if;
  select count(*) into n from public.account_files(bik.uid(1)) where bucket_id = 'blog-images';
  if n <> 1 then raise exception 'FAIL: account deletion should list the 1 remaining picture, got %', n; end if;
  raise notice 'OK 2: only the owner deletes a picture, and account deletion finds them';
end $$;

delete from storage.objects where bucket_id = 'blog-images' and name like (bik.uid(1)::text || '/%');
delete from auth.users where id in (bik.uid(1), bik.uid(2));
drop schema bik cascade;
