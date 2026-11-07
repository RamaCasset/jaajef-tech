-- The talent directory is open to every signed-in member (decision of 7 November).
-- Members still choose to appear in it. Visitors who are not signed in still cannot browse.
create or replace function public.can_browse_talent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
$$;
