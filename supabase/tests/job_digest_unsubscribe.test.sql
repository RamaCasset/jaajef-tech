-- Tests for the e-mail unsubscribe switch. Run AFTER all migrations.
-- psql -v ON_ERROR_STOP=1 -f job_digest_unsubscribe.test.sql

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('ac000000-0000-0000-0000-000000000001', 'jd1@exemple.sn', '{"provider":"email"}', '{}'),
  ('ac000000-0000-0000-0000-000000000002', 'jd2@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Nobody but the server can use it ------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  ok := false;
  set local role anon;
  begin perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', false); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: a visitor switched someone''s e-mail off'; end if;

  ok := false;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-000000000002', true);
  begin perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', false); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: a member switched another member''s e-mail off'; end if;
  raise notice 'OK 1: only the server can switch the e-mail for someone';
end $$;

-- ---- 2. It switches the e-mail off and on, only for the named member -------------------------------------------
do $$
declare on1 boolean; on2 boolean;
begin
  set local role service_role;
  perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', false);
  reset role;
  select email_digest into on1 from public.job_alert_settings where user_id = 'ac000000-0000-0000-0000-000000000001';
  if on1 is distinct from false then raise exception 'FAIL: e-mail not switched off'; end if;
  if exists (select 1 from public.job_alert_settings where user_id = 'ac000000-0000-0000-0000-000000000002') then
    raise exception 'FAIL: another member was touched';
  end if;

  -- the member's own view agrees
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-000000000001', true);
  select email_digest into on2 from public.my_job_alert_settings();
  reset role;
  if on2 is distinct from false then raise exception 'FAIL: the member still sees the e-mail as on'; end if;

  set local role service_role;
  perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', true);
  perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', true);
  reset role;
  select email_digest into on1 from public.job_alert_settings where user_id = 'ac000000-0000-0000-0000-000000000001';
  if on1 is distinct from true then raise exception 'FAIL: e-mail not switched back on'; end if;
  raise notice 'OK 2: off and on again, repeatable, only the named member';
end $$;

-- ---- 3. Bad input is refused ------------------------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  set local role service_role;
  ok := false;
  begin perform public.set_job_alert_email_for(gen_random_uuid(), false); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: unknown member accepted'; end if;
  ok := false;
  begin perform public.set_job_alert_email_for(null, false); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: empty member accepted'; end if;
  ok := false;
  begin perform public.set_job_alert_email_for('ac000000-0000-0000-0000-000000000001', null); exception when raise_exception then ok := true; end;
  if not ok then raise exception 'FAIL: empty choice accepted'; end if;
  reset role;
  raise notice 'OK 3: unknown member and empty input refused';
end $$;

delete from auth.users where id in ('ac000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000002');

select 'ALL JOB DIGEST UNSUBSCRIBE TESTS PASSED' as result;
