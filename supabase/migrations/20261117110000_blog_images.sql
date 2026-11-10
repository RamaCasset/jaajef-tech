-- Pictures for blog posts: a member uploads the cover picture of a post instead of pasting a link.
--
--   * Pictures go into a public bucket "blog-images" (published posts are public, so their pictures are too),
--     in a folder named after the member. PNG, JPEG or WebP, 2 MB at most. No SVG: it can carry code.
--   * A member can upload and delete only inside their own folder.
--   * When an account is deleted, its blog pictures are removed with the rest of its files.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "members upload a blog picture into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'blog-images'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(png|jpg|webp)$'));

-- Needed so a member can find (and so delete or replace) their own files; opening a picture by its web address works for everyone.
create policy "members see their own blog pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'blog-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members delete their own blog pictures"
  on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.account_files(p_user uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('dm-files', 'cv-files', 'souk-images', 'profile-images', 'project-covers', 'blog-images')
     and (storage.foldername(o.name))[1] = p_user::text
$$;

commit;
