-- Profile picture, cover picture and a short title ("headline") for members.
--
--   * Pictures go into a public bucket "profile-images" (a profile is public, so its pictures are too), in a
--     folder named after the member. PNG, JPEG or WebP, 2 MB at most. No SVG: it can carry code.
--   * A member can upload and delete only inside their own folder.
--   * The short title (80 characters at most) is shown under the name on the member's page.
--   * When an account is deleted, its pictures are removed with the rest of its files.

begin;

alter table public.profiles add column headline text check (char_length(headline) <= 80);
grant update (headline) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "members upload a profile picture into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-images'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name ~ ('^' || auth.uid()::text || '/(avatar|cover)-[0-9a-f-]{36}\.(png|jpg|webp)$'));

-- Needed so a member can find (and so delete or replace) their own files; opening a picture by its web address works for everyone.
create policy "members see their own profile pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members delete their own profile pictures"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.account_files(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('dm-files', 'cv-files', 'souk-images', 'profile-images')
     and (storage.foldername(o.name))[1] = p_user::text
$$;

commit;
