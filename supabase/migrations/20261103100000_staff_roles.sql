-- =====================================================================
-- jaajef.tech  -  Migration 7: Staff roles (admin and moderator)
--
-- What this does
--   * Two platform roles, kept in a private table: admin (can do
--     everything) and moderator (platform-wide moderation, reports to come).
--   * Staff are normal member accounts that carry a role. The role is stored in
--     the database, not in a link or a screen, so a separate back-office address
--     adds convenience but the real protection is this table.
--   * Only the server can create an admin (you, from the Supabase SQL Editor).
--     Admins can name and remove moderators, but cannot create or remove
--     other admins.
--   * The last admin can never be removed.
--   * Every staff action is written to a permanent log that nobody can edit or
--     delete. Only admins can read it.
--   * Members cannot see who is staff.
--
-- Not in this migration: reports, quest back-office, Souk and job review. They
-- will use these roles.
--
-- Recommended outside the database: turn on two-factor sign-in for every staff
-- account in Supabase.
--
-- Requires migrations 1 to 6.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.staff_roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  granted_by uuid,
  granted_at timestamptz not null default now()
);

-- actor_id has no foreign key on purpose: the log must survive deleted accounts.
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_recent on public.admin_audit_log (created_at desc);
create index admin_audit_log_actor on public.admin_audit_log (actor_id, created_at desc);

-- Nobody can edit or delete the log, not even the server.
create function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log cannot be changed';
end $$;

create trigger admin_audit_log_no_change
  before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_is_append_only();

create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.audit_log_is_append_only();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create function public.staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff_roles where user_id = auth.uid()
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.staff_role() = 'admin', false)
$$;

-- Writes one line in the log. Used only by other server functions.
create function public.log_admin_action(
  p_actor uuid,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------
-- Server only: create and remove staff (run from the Supabase SQL Editor)
-- ---------------------------------------------------------------------
create function public.make_admin(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found';
  end if;

  -- Already an admin: nothing to do, nothing to log.
  if exists (select 1 from public.staff_roles where user_id = p_user and role = 'admin') then
    return;
  end if;

  insert into public.staff_roles (user_id, role, granted_by)
  values (p_user, 'admin', null)
  on conflict (user_id) do update set role = 'admin', granted_by = null, granted_at = now();

  perform public.log_admin_action(null, 'admin_created', 'member', p_user::text);
end $$;

create function public.revoke_staff(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.staff_roles where user_id = p_user for update;
  if v_role is null then raise exception 'That member is not staff'; end if;

  if v_role = 'admin' and (select count(*) from public.staff_roles where role = 'admin') <= 1 then
    raise exception 'The last admin cannot be removed';
  end if;

  delete from public.staff_roles where user_id = p_user;
  perform public.log_admin_action(null, 'staff_revoked', 'member', p_user::text, jsonb_build_object('role', v_role));
end $$;

-- ---------------------------------------------------------------------
-- Admins: name and remove moderators, see the staff list
-- ---------------------------------------------------------------------
create function public.set_moderator(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found';
  end if;

  select role into v_current from public.staff_roles where user_id = p_user;

  if v_current = 'admin' then
    raise exception 'This member is an admin: admins are managed by the server only';
  end if;

  if p_on then
    if v_current = 'moderator' then return; end if;
    insert into public.staff_roles (user_id, role, granted_by) values (p_user, 'moderator', auth.uid());
    perform public.log_admin_action(auth.uid(), 'moderator_granted', 'member', p_user::text);
  else
    if v_current is null then return; end if;
    delete from public.staff_roles where user_id = p_user;
    perform public.log_admin_action(auth.uid(), 'moderator_revoked', 'member', p_user::text);
  end if;
end $$;

create function public.list_staff()
returns table (user_id uuid, username text, role text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can do this'; end if;
  return query
    select s.user_id, p.username, s.role, s.granted_at
      from public.staff_roles s
      join public.profiles p on p.id = s.user_id
     order by s.role, p.username;
end $$;

-- ---------------------------------------------------------------------
-- Privacy rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.staff_roles enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.staff_roles, public.admin_audit_log from public, anon, authenticated;
grant select on public.staff_roles, public.admin_audit_log to authenticated;

create policy "you see your own role, admins see everyone's"
  on public.staff_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "only admins read the audit log"
  on public.admin_audit_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.staff_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.staff_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

revoke execute on function public.log_admin_action(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.make_admin(uuid) from public, anon, authenticated;
revoke execute on function public.revoke_staff(uuid) from public, anon, authenticated;
grant execute on function public.log_admin_action(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.make_admin(uuid) to service_role;
grant execute on function public.revoke_staff(uuid) to service_role;

revoke execute on function public.set_moderator(uuid, boolean) from public, anon;
revoke execute on function public.list_staff() from public, anon;
grant execute on function public.set_moderator(uuid, boolean) to authenticated;
grant execute on function public.list_staff() to authenticated;

-- The server may read the tables; it writes them only through the functions above.
grant select on public.staff_roles, public.admin_audit_log to service_role;

commit;
