-- jaajef.tech  -  Migration: cleaning up files nothing uses any more
--
--   * Two kinds of private files can be left behind: CV uploads and Souk images that were uploaded but
--     never used (or that nothing uses any more). Until now each member could list their own leftovers,
--     but nothing removed them.
--   * files_to_clean (service role only) lists leftovers for everyone, so a scheduled job can delete them
--     with Supabase Storage. Deleting a file means asking Storage, never the table, so the job is a small
--     Edge Function (file-cleanup).
--   * A file is only listed once it is older than a grace period (file_cleanup_grace_hours, 24), so a file
--     that was just uploaded and is about to be attached is never taken away.
--   * "In use" means exactly what the members' own lists already mean:
--       CV: the member's current CV, or the CV sent with any application.
--       Souk image: the image of a waiting submission, or the image of a shop item.
--   * Private message files are not touched.
--
-- Requires: jobs applying (application_files, job_applications), Souk images.

begin;

insert into public.game_config (key, value, status, description) values
  ('file_cleanup_grace_hours', '24', 'tbc', 'A CV or Souk image nothing uses is only deleted after this many hours. To confirm with Marie');

create function public.files_to_clean(p_limit integer default 200)
returns table (bucket_id text, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hours integer := greatest(coalesce((select (value #>> '{}')::integer from public.game_config where key = 'file_cleanup_grace_hours'), 24), 1);
begin
  return query
  select u.bucket_id, u.name
    from (
      select o.bucket_id, o.name, o.created_at
        from storage.objects o
       where o.bucket_id = 'cv-files'
         and o.created_at < now() - make_interval(hours => v_hours)
         and not exists (select 1 from public.application_files f where f.cv_path = o.name)
         and not exists (select 1 from public.job_applications a where a.cv_path = o.name)
      union all
      select o.bucket_id, o.name, o.created_at
        from storage.objects o
       where o.bucket_id = 'souk-images'
         and o.created_at < now() - make_interval(hours => v_hours)
         and not exists (select 1 from public.souk_submissions s where s.image_path = o.name and s.status = 'pending')
         and not exists (select 1 from public.souk_items i where i.data ->> 'image_path' = o.name)
    ) u
   order by u.created_at, u.name
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

revoke execute on function public.files_to_clean(integer) from public, anon, authenticated;
grant execute on function public.files_to_clean(integer) to service_role;

commit;
