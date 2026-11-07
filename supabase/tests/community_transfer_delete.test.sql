-- Tests for handing a community over and deleting it.
-- Run AFTER all migrations. psql -v ON_ERROR_STOP=1 -f community_transfer_delete.test.sql
--
-- People: ana (owner), bara (member), coumba (outsider), dame (member, already owns 3 communities)

create schema ctkit;
grant usage on schema ctkit to public;

create function ctkit.as_user(n int) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'c8c8c8c8-0000-0000-0000-00000000000' || n, true);
end $$;

create function ctkit.error_of(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create function ctkit.must_fail(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare e text := ctkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then raise exception 'FAIL: % refused for the wrong reason: %', p_label, e; end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c8c8c8c8-0000-0000-0000-000000000001', 'ctana@exemple.sn', '{"provider":"email"}', '{}'),
  ('c8c8c8c8-0000-0000-0000-000000000002', 'ctbara@exemple.sn', '{"provider":"email"}', '{}'),
  ('c8c8c8c8-0000-0000-0000-000000000003', 'ctcoumba@exemple.sn', '{"provider":"email"}', '{}'),
  ('c8c8c8c8-0000-0000-0000-000000000004', 'ctdame@exemple.sn', '{"provider":"email"}', '{}');

-- 1. Set up: ana owns "clan-ana" with bara and dame; dame owns the maximum number of communities
do $$
declare v_c uuid; v_max int := public.chat_setting('chat_max_communities_per_member');
begin
  perform ctkit.as_user(1);
  v_c := public.create_community('clan-ana', 'Clan Ana');
  reset role;
  insert into public.community_members (community_id, user_id) values
    (v_c, 'c8c8c8c8-0000-0000-0000-000000000002'), (v_c, 'c8c8c8c8-0000-0000-0000-000000000004');
  for i in 1..v_max loop
    insert into public.communities (slug, name, owner_id) values ('dame-' || i, 'Dame ' || i, 'c8c8c8c8-0000-0000-0000-000000000004');
    insert into public.community_members (community_id, user_id, role)
      select id, 'c8c8c8c8-0000-0000-0000-000000000004', 'owner' from public.communities where slug = 'dame-' || i;
  end loop;
  raise notice 'OK 1: set up';
end $$;

-- 2. Who may call what
do $$
begin
  perform ctkit.as_user(1);
  if not has_function_privilege('authenticated', 'public.transfer_community(uuid,uuid)', 'execute') then raise exception 'FAIL: members cannot transfer'; end if;
  if has_function_privilege('anon', 'public.transfer_community(uuid,uuid)', 'execute') then raise exception 'FAIL: anon can transfer'; end if;
  if has_function_privilege('anon', 'public.delete_community(uuid,text)', 'execute') then raise exception 'FAIL: anon can delete'; end if;
  raise notice 'OK 2: only signed-in members can call them';
end $$;

-- 3. Transfer: refusals
do $$
declare v_c uuid := (select id from public.communities where slug = 'clan-ana');
begin
  perform ctkit.as_user(2);
  perform ctkit.must_fail('member transfers', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000002'), 'Only the owner');
  perform ctkit.as_user(3);
  perform ctkit.must_fail('outsider transfers', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000003'), 'Only the owner');
  perform ctkit.as_user(1);
  perform ctkit.must_fail('to self', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000001'), 'another member');
  perform ctkit.must_fail('to an outsider', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000003'), 'not in this community');
  perform ctkit.must_fail('to someone at the limit', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000004'), 'maximum');
  reset role;
  if (select owner_id from public.communities where id = v_c) <> 'c8c8c8c8-0000-0000-0000-000000000001' then raise exception 'FAIL: owner changed by a refused call'; end if;
  raise notice 'OK 3: only the owner can hand over, only to another member below the limit';
end $$;

-- 4. Transfer works: new owner, old owner becomes moderator, owner cannot leave before, can after
do $$
declare v_c uuid := (select id from public.communities where slug = 'clan-ana');
begin
  perform ctkit.as_user(1);
  perform ctkit.must_fail('owner leaves', format('select public.leave_community(%L)', v_c), 'hand the community');
  perform public.transfer_community(v_c, 'c8c8c8c8-0000-0000-0000-000000000002');
  reset role;
  if (select owner_id from public.communities where id = v_c) <> 'c8c8c8c8-0000-0000-0000-000000000002' then raise exception 'FAIL: owner not changed'; end if;
  if (select role from public.community_members where community_id = v_c and user_id = 'c8c8c8c8-0000-0000-0000-000000000002') <> 'owner' then raise exception 'FAIL: new owner role'; end if;
  if (select role from public.community_members where community_id = v_c and user_id = 'c8c8c8c8-0000-0000-0000-000000000001') <> 'moderator' then raise exception 'FAIL: old owner role'; end if;
  if (select count(*) from public.community_members where community_id = v_c and role = 'owner') <> 1 then raise exception 'FAIL: not exactly one owner'; end if;
  perform ctkit.as_user(1);
  perform ctkit.must_fail('old owner transfers again', format('select public.transfer_community(%L, %L)', v_c, 'c8c8c8c8-0000-0000-0000-000000000001'), 'Only the owner');
  perform public.leave_community(v_c);
  raise notice 'OK 4: handed over; one owner; the previous owner can now leave';
end $$;

-- 5. Delete: refusals
do $$
declare v_c uuid := (select id from public.communities where slug = 'clan-ana');
begin
  perform ctkit.as_user(1);
  perform ctkit.must_fail('non-member deletes', format('select public.delete_community(%L, %L)', v_c, 'clan-ana'), 'Only the owner');
  perform ctkit.as_user(4);
  perform ctkit.must_fail('member deletes', format('select public.delete_community(%L, %L)', v_c, 'clan-ana'), 'Only the owner');
  perform ctkit.as_user(2);
  perform ctkit.must_fail('no confirmation', format('select public.delete_community(%L, %L)', v_c, null), 'confirm');
  perform ctkit.must_fail('wrong confirmation', format('select public.delete_community(%L, %L)', v_c, 'clan-ana-x'), 'confirm');
  reset role;
  if not exists (select 1 from public.communities where id = v_c) then raise exception 'FAIL: deleted by a refused call'; end if;
  raise notice 'OK 5: only the owner, and only with the right name typed';
end $$;

-- 6. Delete works and takes the community's content with it, nothing else
do $$
declare v_c uuid := (select id from public.communities where slug = 'clan-ana'); v_ch uuid;
begin
  reset role;
  select id into v_ch from public.channels where community_id = v_c and slug = 'general';
  insert into public.messages (channel_id, community_id, author_id, body) values (v_ch, v_c, 'c8c8c8c8-0000-0000-0000-000000000002', 'bonjour');
  perform ctkit.as_user(2);
  perform public.delete_community(v_c, 'clan-ana');
  reset role;
  if exists (select 1 from public.communities where id = v_c) then raise exception 'FAIL: community still there'; end if;
  if exists (select 1 from public.channels where community_id = v_c) or exists (select 1 from public.messages where community_id = v_c)
     or exists (select 1 from public.community_members where community_id = v_c) then raise exception 'FAIL: content left behind'; end if;
  if (select count(*) from public.communities where owner_id = 'c8c8c8c8-0000-0000-0000-000000000004') = 0 then raise exception 'FAIL: other communities touched'; end if;
  if not exists (select 1 from public.profiles where id = 'c8c8c8c8-0000-0000-0000-000000000002') then raise exception 'FAIL: a profile was touched'; end if;
  raise notice 'OK 6: deleted with channels, messages and members; others untouched';
end $$;
