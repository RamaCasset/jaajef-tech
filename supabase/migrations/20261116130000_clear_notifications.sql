-- Lets a member delete their own notifications: one at a time, or all of them.
-- Notifications stay closed to direct writes; these two functions are the only way, and only touch the caller's own rows.

create or replace function public.delete_notification(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.notifications where id = p_id and user_id = auth.uid();
end;
$$;

create or replace function public.clear_my_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.notifications where user_id = auth.uid();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.delete_notification(bigint) from public, anon;
revoke execute on function public.clear_my_notifications() from public, anon;
grant execute on function public.delete_notification(bigint) to authenticated;
grant execute on function public.clear_my_notifications() to authenticated;
