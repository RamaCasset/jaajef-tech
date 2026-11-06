-- jaajef.tech  -  Migration: images for Souk submissions
--
--   * A creator uploads one image (PNG or WebP, 500 KB at most) for a submission, into a private
--     bucket "souk-images", in a folder named after their member id. No SVG: it can carry code.
--   * Avatar frames must have an image to be approved; status badges and themes may.
--   * Staff open the image during review. When the submission is approved, the item points at that
--     same file (in its look as "image_path"), and everyone (visitors too) can open it while the item
--     is on sale; owners keep access after it is taken off sale.
--   * Creators cannot delete an image that is waiting for review or used by an item. They can list
--     and delete the ones nobody uses (rejected, withdrawn or replaced).
--   * "image_path" typed by a creator inside the look is ignored: only the checked upload counts.
--
-- Requires: Souk submissions, back-office roles.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('souk-images', 'souk-images', false, 512000, array['image/png', 'image/webp'])
on conflict (id) do nothing;

alter table public.souk_submissions add column image_path text
  check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|webp)$');

-- ---------------------------------------------------------------------
-- Helpers used by the storage rules
-- ---------------------------------------------------------------------
-- Waiting for review, or used by an item: it must not be deleted.
create function public.souk_image_in_use(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.souk_submissions s where s.image_path = p_path and s.status = 'pending')
    or exists (select 1 from public.souk_items i where i.data ->> 'image_path' = p_path)
  )
$$;

-- Everyone may open the image of an item on sale; owners may open it after it is taken off sale.
create function public.can_read_souk_image(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.souk_items i
     where i.data ->> 'image_path' = p_path
       and (i.is_active
            or (auth.uid() is not null and exists (
                  select 1 from public.member_items m where m.item_id = i.id and m.user_id = auth.uid())))
  )
$$;

-- ---------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------
-- Returns the previous image path (if any) so the app can delete that file.
create function public.attach_submission_image(p_submission uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_old text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_path is null or p_path !~ ('^' || v_me::text || '/[0-9a-f-]{36}\.(png|webp)$') then
    raise exception 'The image must be a PNG or WebP file in your own folder';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'souk-images' and name = p_path) then
    raise exception 'The file was not uploaded';
  end if;
  select image_path into v_old from public.souk_submissions
   where id = p_submission and creator_id = v_me and status = 'pending' for update;
  if not found then raise exception 'Submission not found, or it is no longer waiting for review'; end if;
  update public.souk_submissions set image_path = p_path, updated_at = now() where id = p_submission;
  return case when v_old is distinct from p_path then v_old end;
end $$;

create function public.remove_submission_image(p_submission uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_old text;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  select image_path into v_old from public.souk_submissions
   where id = p_submission and creator_id = v_me and status = 'pending' for update;
  if not found then raise exception 'Submission not found, or it is no longer waiting for review'; end if;
  update public.souk_submissions set image_path = null, updated_at = now() where id = p_submission;
  return v_old;
end $$;

-- My image files that nothing uses: the app deletes them from storage.
create function public.list_unused_souk_images()
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
  select o.name
    from storage.objects o
   where o.bucket_id = 'souk-images' and (storage.foldername(o.name))[1] = auth.uid()::text
     and not exists (select 1 from public.souk_submissions s where s.image_path = o.name and s.status = 'pending')
     and not exists (select 1 from public.souk_items i where i.data ->> 'image_path' = o.name);
end $$;

-- ---------------------------------------------------------------------
-- Staff: the queue now shows the image, and approving checks it
-- ---------------------------------------------------------------------
drop function public.list_souk_submissions(text, integer);
create function public.list_souk_submissions(p_status text default 'pending', p_limit integer default 50)
returns table (
  id uuid, creator_id uuid, creator_username text, kind public.souk_item_kind, name text, description text,
  data jsonb, proposed_price bigint, image_path text, status text, review_note text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.can_manage_shop() then raise exception 'Only shop staff can see the submissions'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected', 'withdrawn') then raise exception 'Unknown status'; end if;
  return query
  select s.id, s.creator_id, p.username, s.kind, s.name, s.description, s.data, s.proposed_price, s.image_path, s.status, s.review_note, s.created_at
    from public.souk_submissions s
    join public.profiles p on p.id = s.creator_id
   where p_status is null or s.status = p_status
   order by s.created_at, s.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- Approving: frames need an image; the item keeps the checked image and nothing typed by the creator.
create or replace function public.review_souk_submission(
  p_submission uuid, p_approve boolean, p_note text default null, p_price bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  s public.souk_submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_price bigint;
  v_slug text;
  v_item uuid;
begin
  if not public.can_manage_shop() then raise exception 'Only shop staff can review submissions'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'The note is too long (500 characters at most)'; end if;
  if not p_approve and v_note is null then raise exception 'Say why the item is rejected'; end if;

  select * into s from public.souk_submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'This submission has already been handled'; end if;
  if s.creator_id = v_me then raise exception 'You cannot review your own submission: ask another shop manager'; end if;
  if p_approve and s.kind = 'avatar_frame' and s.image_path is null then raise exception 'An avatar frame needs an image'; end if;

  if p_approve then
    v_price := coalesce(p_price, s.proposed_price);
    if v_price < 1 or v_price > 1000000 then raise exception 'The price must be between 1 and 1000000 Kopeks'; end if;
    v_slug := trim(both '-' from regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'));
    v_slug := left(coalesce(nullif(v_slug, ''), 'item'), 40) || '-' || left(replace(s.id::text, '-', ''), 8);
    insert into public.souk_items (slug, kind, name, description, price_kopeks, data, is_active, creator_id)
    values (v_slug, s.kind, s.name, s.description, v_price,
            (s.data - 'image_path') || case when s.image_path is not null then jsonb_build_object('image_path', s.image_path) else '{}'::jsonb end,
            true, s.creator_id)
    returning id into v_item;
    update public.souk_submissions
       set status = 'approved', review_note = v_note, reviewed_by = v_me, reviewed_at = now(), item_id = v_item, updated_at = now()
     where id = p_submission;
    perform public.notify(s.creator_id, 'souk_submission_approved',
      jsonb_build_object('submission_id', s.id, 'item_id', v_item, 'item_name', s.name, 'price', v_price, 'note', v_note));
  else
    update public.souk_submissions
       set status = 'rejected', review_note = v_note, reviewed_by = v_me, reviewed_at = now(), updated_at = now()
     where id = p_submission;
    perform public.notify(s.creator_id, 'souk_submission_rejected',
      jsonb_build_object('submission_id', s.id, 'item_name', s.name, 'note', v_note));
  end if;

  perform public.log_admin_action(v_me, case when p_approve then 'souk_submission_approved' else 'souk_submission_rejected' end,
                                  'souk_submission', p_submission::text,
                                  jsonb_build_object('creator_id', s.creator_id, 'item_id', v_item, 'price', v_price));
  return v_item;
end $$;

-- ---------------------------------------------------------------------
-- Security and storage rules
-- ---------------------------------------------------------------------
revoke execute on function public.souk_image_in_use(text) from public, anon;
revoke execute on function public.can_read_souk_image(text) from public;
revoke execute on function public.attach_submission_image(uuid, text) from public, anon;
revoke execute on function public.remove_submission_image(uuid) from public, anon;
revoke execute on function public.list_unused_souk_images() from public, anon;
revoke execute on function public.list_souk_submissions(text, integer) from public, anon;
grant execute on function public.souk_image_in_use(text) to authenticated;
grant execute on function public.can_read_souk_image(text) to anon, authenticated;
grant execute on function public.attach_submission_image(uuid, text) to authenticated;
grant execute on function public.remove_submission_image(uuid) to authenticated;
grant execute on function public.list_unused_souk_images() to authenticated;
grant execute on function public.list_souk_submissions(text, integer) to authenticated;

create policy "creators upload a Souk image into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'souk-images'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(png|webp)$'));

create policy "creators open their own Souk images"
  on storage.objects for select to authenticated
  using (bucket_id = 'souk-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "shop staff open Souk images"
  on storage.objects for select to authenticated
  using (bucket_id = 'souk-images' and public.can_manage_shop());

create policy "everyone opens the images of items on sale"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'souk-images' and public.can_read_souk_image(name));

create policy "creators delete their Souk images that nothing uses"
  on storage.objects for delete to authenticated
  using (bucket_id = 'souk-images'
         and (storage.foldername(name))[1] = auth.uid()::text
         and not public.souk_image_in_use(name));

commit;
