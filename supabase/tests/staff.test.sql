-- Tests for migration 7 (staff roles: admin and moderator).
-- Run AFTER migrations 1 to 7. psql -v ON_ERROR_STOP=1 -f staff.test.sql
--
-- People in this test:
--   ama     (...0001)  becomes the first admin
--   binta   (...0002)  an ordinary member
--   cheikh  (...0003)  becomes a moderator
--   demba   (...0004)  becomes a second admin

create schema sfkit;
grant usage on schema sfkit to public;

create function sfkit.uid(p_n int) returns uuid
language sql immutable as $$
  select ('abababab-0000-0000-0000-00000000000' || p_n)::uuid
$$;

create function sfkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', sfkit.uid(p_n)::text, true);
end $$;

create function sfkit.as_anon() returns void
language plpgsql as $$
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function sfkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function sfkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function sfkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := sfkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (sfkit.uid(1), 'ama@exemple.sn', '{"provider":"email"}', '{}'),
  (sfkit.uid(2), 'binta@exemple.sn', '{"provider":"email"}', '{}'),
  (sfkit.uid(3), 'cheikh@exemple.sn', '{"provider":"email"}', '{}'),
  (sfkit.uid(4), 'demba@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. Nobody is staff at the start, and members cannot make themselves staff -----
do $$
begin
  perform sfkit.as_user(1);
  if public.staff_role() is not null or public.is_admin() then raise exception 'FAIL: someone is staff before anyone was named'; end if;
  perform sfkit.must_fail('member makes themselves admin', format('select public.make_admin(%L)', sfkit.uid(1)), 'permission denied');
  perform sfkit.must_fail('member revokes staff', format('select public.revoke_staff(%L)', sfkit.uid(1)), 'permission denied');
  perform sfkit.must_fail('member writes to the log', $q$select public.log_admin_action(null, 'fake')$q$, 'permission denied');
  perform sfkit.must_fail('member inserts a role directly', format('insert into public.staff_roles (user_id, role) values (%L, %L)', sfkit.uid(1), 'admin'), 'permission denied');
  reset role;

  perform sfkit.as_anon();
  perform sfkit.must_fail('visitor reads roles', 'select count(*) from public.staff_roles', 'permission denied');
  perform sfkit.must_fail('visitor reads the log', 'select count(*) from public.admin_audit_log', 'permission denied');
  perform sfkit.must_fail('visitor makes an admin', format('select public.make_admin(%L)', sfkit.uid(1)), 'permission denied');
  reset role;
  raise notice 'OK 1: nobody is staff by default; members and visitors cannot create staff or write the log';
end $$;

-- ---- 2. The server creates the first admin ------------------------------------------
do $$
begin
  perform sfkit.as_server();
  perform public.make_admin(sfkit.uid(1));
  perform public.make_admin(sfkit.uid(1)); -- twice is harmless
  perform sfkit.must_fail('admin for a member that does not exist', $q$select public.make_admin('99999999-9999-9999-9999-999999999999')$q$, 'not found');
  reset role;

  if (select count(*) from public.staff_roles where role = 'admin') <> 1 then raise exception 'FAIL: expected exactly one admin'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'admin_created' and target_id = sfkit.uid(1)::text and actor_id is null) then
    raise exception 'FAIL: admin creation was not logged';
  end if;

  perform sfkit.as_user(1);
  if not public.is_admin() or public.staff_role() <> 'admin' then raise exception 'FAIL: ama should be admin'; end if;
  reset role;
  perform sfkit.as_user(2);
  if public.is_admin() or public.staff_role() is not null then raise exception 'FAIL: binta should not be staff'; end if;
  reset role;
  raise notice 'OK 2: the server creates an admin, and it is logged';
end $$;

-- ---- 3. Members cannot see staff or the log -----------------------------------------------
do $$
declare n int;
begin
  perform sfkit.as_user(2);
  select count(*) into n from public.staff_roles;
  if n <> 0 then raise exception 'FAIL: a member sees % staff roles', n; end if;
  select count(*) into n from public.admin_audit_log;
  if n <> 0 then raise exception 'FAIL: a member sees % log lines', n; end if;
  perform sfkit.must_fail('member names a moderator', format('select public.set_moderator(%L, true)', sfkit.uid(3)), 'Only an admin');
  perform sfkit.must_fail('member lists staff', 'select * from public.list_staff()', 'Only an admin');
  reset role;

  perform sfkit.as_user(1);
  select count(*) into n from public.staff_roles;
  if n <> 1 then raise exception 'FAIL: admin should see the staff list (1), saw %', n; end if;
  select count(*) into n from public.admin_audit_log;
  if n < 1 then raise exception 'FAIL: admin cannot read the log'; end if;
  reset role;
  raise notice 'OK 3: members see no staff and no log; admins see both';
end $$;

-- ---- 4. Admins name moderators -------------------------------------------------------------
do $$
declare n int;
begin
  perform sfkit.as_user(1);
  perform public.set_moderator(sfkit.uid(3), true);
  perform public.set_moderator(sfkit.uid(3), true); -- twice is harmless
  perform sfkit.must_fail('moderator for a ghost', $q$select public.set_moderator('99999999-9999-9999-9999-999999999999', true)$q$, 'not found');
  select count(*) into n from public.list_staff();
  if n <> 2 then raise exception 'FAIL: staff list should have 2 people, has %', n; end if;
  reset role;

  if (select granted_by from public.staff_roles where user_id = sfkit.uid(3)) <> sfkit.uid(1) then raise exception 'FAIL: granted_by is wrong'; end if;
  if (select count(*) from public.admin_audit_log where action = 'moderator_granted' and target_id = sfkit.uid(3)::text and actor_id = sfkit.uid(1)) <> 1 then
    raise exception 'FAIL: naming a moderator should be logged exactly once';
  end if;

  -- a moderator has no admin powers and sees only their own role
  perform sfkit.as_user(3);
  if public.staff_role() <> 'moderator' or public.is_admin() then raise exception 'FAIL: cheikh should be a moderator, not admin'; end if;
  perform sfkit.must_fail('moderator names a moderator', format('select public.set_moderator(%L, true)', sfkit.uid(2)), 'Only an admin');
  perform sfkit.must_fail('moderator lists staff', 'select * from public.list_staff()', 'Only an admin');
  if (select count(*) from public.staff_roles) <> 1 then raise exception 'FAIL: a moderator should see only their own role'; end if;
  if (select count(*) from public.admin_audit_log) <> 0 then raise exception 'FAIL: a moderator can read the log'; end if;
  reset role;
  raise notice 'OK 4: only admins name moderators; moderators have no admin powers';
end $$;

-- ---- 5. Admins cannot touch other admins ------------------------------------------------------
do $$
begin
  perform sfkit.as_server();
  perform public.make_admin(sfkit.uid(4));
  reset role;

  perform sfkit.as_user(1);
  perform sfkit.must_fail('admin demotes another admin', format('select public.set_moderator(%L, false)', sfkit.uid(4)), 'admin');
  perform sfkit.must_fail('admin turns another admin into a moderator', format('select public.set_moderator(%L, true)', sfkit.uid(4)), 'admin');
  perform sfkit.must_fail('admin demotes themselves', format('select public.set_moderator(%L, false)', sfkit.uid(1)), 'admin');
  reset role;
  if (select count(*) from public.staff_roles where role = 'admin') <> 2 then raise exception 'FAIL: both admins should still be admins'; end if;
  raise notice 'OK 5: admins cannot create, change or remove other admins';
end $$;

-- ---- 6. Removing staff -------------------------------------------------------------------------------
do $$
begin
  perform sfkit.as_user(1);
  perform public.set_moderator(sfkit.uid(3), false);
  reset role;
  if exists (select 1 from public.staff_roles where user_id = sfkit.uid(3)) then raise exception 'FAIL: moderator was not removed'; end if;
  if (select count(*) from public.admin_audit_log where action = 'moderator_revoked' and target_id = sfkit.uid(3)::text) <> 1 then
    raise exception 'FAIL: removal was not logged';
  end if;

  perform sfkit.as_server();
  perform sfkit.must_fail('removing someone who is not staff', format('select public.revoke_staff(%L)', sfkit.uid(2)), 'not staff');
  perform public.revoke_staff(sfkit.uid(4)); -- a second admin can go
  perform sfkit.must_fail('removing the last admin', format('select public.revoke_staff(%L)', sfkit.uid(1)), 'last admin');
  reset role;

  if (select count(*) from public.staff_roles where role = 'admin') <> 1 then raise exception 'FAIL: one admin must remain'; end if;
  raise notice 'OK 6: moderators and extra admins can be removed; the last admin never can';
end $$;

-- ---- 7. Nobody writes the tables directly ---------------------------------------------------------------
do $$
begin
  perform sfkit.as_user(1); -- even an admin
  perform sfkit.must_fail('admin inserts a role', format('insert into public.staff_roles (user_id, role) values (%L, %L)', sfkit.uid(2), 'admin'), 'permission denied');
  perform sfkit.must_fail('admin updates a role', $q$update public.staff_roles set role = 'admin'$q$, 'permission denied');
  perform sfkit.must_fail('admin deletes a role', 'delete from public.staff_roles', 'permission denied');
  perform sfkit.must_fail('admin writes the log', $q$insert into public.admin_audit_log (action) values ('fake')$q$, 'permission denied');
  perform sfkit.must_fail('admin edits the log', $q$update public.admin_audit_log set action = 'x'$q$, 'permission denied');
  perform sfkit.must_fail('admin deletes log lines', 'delete from public.admin_audit_log', 'permission denied');
  reset role;
  raise notice 'OK 7: tables are read-only for everyone, admins included';
end $$;

-- ---- 8. The log cannot be altered, even by the database owner -----------------------------------------
do $$
begin
  perform sfkit.must_fail('editing the log as owner', $q$update public.admin_audit_log set action = 'x'$q$, 'cannot be changed');
  perform sfkit.must_fail('deleting log lines as owner', 'delete from public.admin_audit_log', 'cannot be changed');
  perform sfkit.must_fail('emptying the log as owner', 'truncate public.admin_audit_log', 'cannot be changed');
  raise notice 'OK 8: the audit log is append-only';
end $$;

-- ---- 9. The log tells the story ----------------------------------------------------------------------------
do $$
declare actions text;
begin
  select string_agg(action, ',' order by id) into actions from public.admin_audit_log;
  if actions <> 'admin_created,moderator_granted,admin_created,moderator_revoked,staff_revoked' then
    raise exception 'FAIL: the log reads %', actions;
  end if;
  raise notice 'OK 9: every staff action appears once, in order';
end $$;

select 'ALL STAFF TESTS PASSED' as result;
