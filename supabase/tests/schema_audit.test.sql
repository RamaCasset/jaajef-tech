-- Safety audit of the whole database.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f schema_audit.test.sql
--
-- This does not test one feature. It looks at the finished database and fails
-- when it finds the kind of mistake that causes security holes, in any piece,
-- old or new. When a new piece needs something these rules forbid, the test
-- fails on purpose and says what to review. If the choice is right, add the
-- name to the matching list below, in the same change.
--
-- The lists may name things that do not exist yet (pieces not merged); only
-- things that exist and are NOT on a list make the test fail.

-- ---- 1. Every table has row level security on ----------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then
    raise exception 'FAIL: tables without row level security: %. Turn it on (alter table ... enable row level security) and add policies.', bad;
  end if;
  raise notice 'OK 1: every table has row level security';
end $$;

-- ---- 2. Server functions pin their search path ---------------------------------------------------------
-- A security definer function without a fixed search path can be tricked into running someone else's code.
do $$
declare bad text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then
    raise exception 'FAIL: security definer functions without a fixed search path: %. Add: set search_path = public', bad;
  end if;
  raise notice 'OK 2: every security definer function pins its search path';
end $$;

-- ---- 3. Functions anyone can run, even visitors ---------------------------------------------------------
-- Functions run by "public" by default unless revoked. Only these may stay open to everyone.
do $$
declare
  open_to_all text[] := array[
    'audit_log_is_append_only', 'can_read_dm_file', 'chat_setting', 'clean_tags', 'community_member_count',
    'in_conversation', 'is_member', 'level_for_xp', 'member_role', 'notification_kinds',
    'notification_kinds_locked', 'quest_leaderboard', 'season_leaderboard', 'set_updated_at'
  ];
  bad text;
begin
  select string_agg(distinct p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     and p.proname <> all (open_to_all);
  if bad is not null then
    raise exception 'FAIL: functions open to everyone by default: %. Revoke execute from public (revoke execute on function ... from public).', bad;
  end if;
  raise notice 'OK 3: only the known helper functions are open to everyone by default';
end $$;

-- ---- 4. Functions a visitor (not signed in) can run -----------------------------------------------------
do $$
declare
  visitor_functions text[] := array[
    'activity_calendar', 'audit_log_is_append_only', 'blog_post_is_listed', 'can_read_dm_file', 'can_read_souk_image', 'chat_setting',
    'clean_tags', 'community_member_count', 'featured_item', 'in_conversation', 'is_member', 'job_offer_is_listed', 'level_for_xp',
    'list_blog_posts', 'list_good_first_issues', 'member_role', 'notification_kinds', 'notification_kinds_locked', 'popular_project_tags',
    'project_good_first_issues', 'project_is_listed', 'project_languages', 'quest_leaderboard', 'quest_of_the_day', 'search_everything',
    'search_job_offers', 'search_projects', 'season_leaderboard', 'set_updated_at', 'souk_shop', 'top_streaks', 'trending_creators'
  ];
  bad text;
begin
  select string_agg(distinct p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> all (visitor_functions);
  if bad is not null then
    raise exception 'FAIL: functions a visitor can run: %. If visitors really need them, add them to visitor_functions; otherwise revoke execute from anon.', bad;
  end if;
  raise notice 'OK 4: visitors can run only the known public functions';
end $$;

-- ---- 5. Writing straight into tables ---------------------------------------------------------------------------
-- Everything is written through functions. The one exception is a member editing their own profile.
do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' || r.rolname || ')', ', ') into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (
       has_table_privilege(r.rolname, c.oid, 'INSERT') or has_table_privilege(r.rolname, c.oid, 'DELETE')
       or has_table_privilege(r.rolname, c.oid, 'UPDATE') or has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
       or has_any_column_privilege(r.rolname, c.oid, 'INSERT') or has_any_column_privilege(r.rolname, c.oid, 'UPDATE')
     )
     and not (r.rolname = 'authenticated' and c.relname = 'profiles');
  if bad is not null then
    raise exception 'FAIL: tables that can be written directly: %. Revoke the write rights and use a function.', bad;
  end if;

  -- profiles: a member may edit only these columns, never points, streaks, character or verification.
  if has_table_privilege('authenticated', 'public.profiles', 'INSERT') or has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     or has_any_column_privilege('authenticated', 'public.profiles', 'INSERT') or has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     or has_table_privilege('anon', 'public.profiles', 'UPDATE') then
    raise exception 'FAIL: profiles may only be edited column by column, by signed-in members';
  end if;
  select string_agg(a.attname, ', ' order by a.attname) into bad
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE')
     and a.attname not in ('display_name', 'username', 'avatar_url', 'banner_url', 'bio', 'location', 'available_to_collab');
  if bad is not null then
    raise exception 'FAIL: members can edit these profile columns: %. Points, streaks, character and verification must stay server-only.', bad;
  end if;
  raise notice 'OK 5: nothing is written straight into tables, except a member''s own profile text';
end $$;

-- ---- 6. Policies that allow writing ------------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(tablename || ': ' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and cmd <> 'SELECT'
     and not (tablename = 'profiles' and cmd = 'UPDATE');
  if bad is not null then
    raise exception 'FAIL: policies that allow writing: %. Writes go through functions.', bad;
  end if;
  raise notice 'OK 6: no policy allows writing except a member editing their profile';
end $$;

-- ---- 7. Tables a visitor can read ---------------------------------------------------------------------------------
-- Only data that is public by design. A new table here is a conscious decision.
-- Known and accepted: the expected answers of quest tests are readable, because quests run in the browser
-- (see "Honest limit of the first version" in docs/ARCHITECTURE.md).
do $$
declare
  public_tables text[] := array[
    'badge_rules', 'badges', 'blog_comments', 'blog_posts', 'blog_stats', 'communities', 'employers',
    'equipped_items', 'featured_projects', 'job_offers', 'game_config', 'member_activity_days', 'profiles', 'project_collaborators',
    'project_comments', 'project_stats', 'projects', 'quests', 'seasons', 'souk_featured',
    'souk_item_stats', 'souk_items', 'user_badges'
  ];
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT'))
     and c.relname <> all (public_tables);
  if bad is not null then
    raise exception 'FAIL: tables a visitor can read: %. If this data is public by design, add it to public_tables; otherwise revoke select from anon.', bad;
  end if;
  raise notice 'OK 7: visitors can read only the known public tables';
end $$;

-- ---- 8. Signed-in functions that never look at who is calling ---------------------------------------------
-- A server function run by members should check who the caller is (auth.uid, admin or staff role, or a
-- helper that does). Those that read only public data are listed here on purpose.
do $$
declare
  by_design text[] := array[
    'activity_calendar', 'blog_post_is_listed', 'community_member_count', 'featured_item', 'job_offer_is_listed',
    'list_good_first_issues', 'popular_project_tags', 'project_good_first_issues', 'project_is_listed', 'project_languages', 'quest_leaderboard', 'search_everything',
    'search_job_offers', 'search_projects',
    'season_leaderboard', 'top_streaks', 'trending_creators'
  ];
  bad text;
begin
  select string_agg(distinct p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc !~* '(auth\.uid\(\)|is_admin\(|staff_role\(|auth\.role\(|member_role\(|is_member\(|in_conversation\(|can_read_dm_file\()'
     and p.proname <> all (by_design);
  if bad is not null then
    raise exception 'FAIL: functions members can run that never check who is calling: %. Add a check, revoke execute from authenticated, or list them in by_design if they only read public data.', bad;
  end if;
  raise notice 'OK 8: every member function checks who is calling, or is known to read public data only';
end $$;

-- ---- 9. Live updates (Realtime) --------------------------------------------------------------------------------
-- Tables sent live to the browser. Each one must have row level security (check 1) and be listed here.
do $$
declare
  live_tables text[] := array['direct_messages', 'messages', 'notifications'];
  bad text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    select string_agg(tablename, ', ') into bad
      from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename <> all (live_tables);
    if bad is not null then
      raise exception 'FAIL: tables sent live to the browser: %. If intended, add them to live_tables.', bad;
    end if;
  end if;
  raise notice 'OK 9: only the known tables are sent live';
end $$;

-- ---- 10. Views do not bypass row level security ------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and not coalesce('security_invoker=true' = any (c.reloptions), false);
  if bad is not null then
    raise exception 'FAIL: views that ignore row level security: %. Create them with (security_invoker = true).', bad;
  end if;
  raise notice 'OK 10: views respect row level security';
end $$;

-- ---- 11. The audit log cannot be rewritten ---------------------------------------------------------------------
do $$
begin
  -- Visitors never read it; members only through the policy that lets admins in.
  if has_table_privilege('anon', 'public.admin_audit_log', 'SELECT') then
    raise exception 'FAIL: visitors must not read the audit log';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_audit_log' and cmd in ('SELECT', 'ALL')
              and (qual is null or qual !~* 'is_admin\(\)')) then
    raise exception 'FAIL: the audit log may only be read by admins';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.admin_audit_log'::regclass and not t.tgisinternal and t.tgfoid = 'public.audit_log_is_append_only'::regproc
  ) then
    raise exception 'FAIL: the audit log lost its append-only protection';
  end if;
  raise notice 'OK 11: only admins read the audit log, and it is append-only';
end $$;

select 'ALL SAFETY AUDIT CHECKS PASSED' as result;
