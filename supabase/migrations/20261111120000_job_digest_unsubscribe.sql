-- jaajef.tech - Unsubscribe from the job-alert e-mail without signing in
--
-- Every e-mail carries an "unsubscribe" link. The member may be signed out when they click it, so the
-- e-mail sender (service role only) switches the e-mail off for them. The sender proves the request is
-- genuine with a signed link; this function only does the switch.

create function public.set_job_alert_email_for(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_on is null then raise exception 'Say who and whether the email is on'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found'; end if;
  insert into public.job_alert_settings (user_id, email_digest) values (p_user, p_on)
  on conflict (user_id) do update set email_digest = excluded.email_digest, updated_at = now();
end $$;

revoke execute on function public.set_job_alert_email_for(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_job_alert_email_for(uuid, boolean) to service_role;
