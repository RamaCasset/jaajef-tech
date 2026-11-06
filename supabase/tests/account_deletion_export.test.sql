-- Tests for deleting an account and exporting my data. Run AFTER all migrations.
-- psql -v ON_ERROR_STOP=1 -f account_deletion_export.test.sql
--
-- People: ana (1) leaves; bara (2) stays and shares things with ana; coumba (3) is an admin; dame (4) is suspended;
-- eve (5) owns a community with a member; fara (6) owns an employer with a published offer; gora (7) owns an empty community.

create schema adkit;
grant usage on schema adkit to public;

create function adkit.uid(p_n int) returns uuid
language sql immutable as $$ select ('ad0d0d0d-0000-0000-0000-00000000000' || p_n)::uuid $$;

create function adkit.as_user(p_n int) returns void
language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', adkit.uid(p_n)::text, true);
end $$;

create function adkit.as_server() returns void
language plpgsql as $$
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function adkit.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function adkit.must_fail(p_label text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare e text := adkit.error_of(p_sql);
begin
  if e is null then raise exception 'FAIL: % was allowed', p_label; end if;
  if e not ilike '%' || p_expect || '%' then
    raise exception 'FAIL: % was refused for the wrong reason: %', p_label, e;
  end if;
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select adkit.uid(n), 'ad' || n || '@exemple.sn', '{"provider":"email"}', '{}' from generate_series(1, 7) n;

-- ---- Set-up: things ana owns, things she shares with bara ------------------------------------------------------------
do $$
declare conv uuid; comm uuid; ch uuid; ana_proj uuid; bara_proj uuid;
begin
  -- projects: ana's (with a star and a comment from bara) and bara's (with a comment and a star from ana)
  insert into public.projects (owner_id, github_owner, github_repo, title) values (adkit.uid(1), 'ana-dev', 'depot-ana', 'Depot Ana') returning id into ana_proj;
  insert into public.projects (owner_id, github_owner, github_repo, title) values (adkit.uid(2), 'bara-dev', 'depot-bara', 'Depot Bara') returning id into bara_proj;
  insert into public.project_comments (project_id, author_id, body) values (ana_proj, adkit.uid(2), 'Joli projet'), (bara_proj, adkit.uid(1), 'Merci pour le depot');
  insert into public.project_stars (project_id, user_id) values (ana_proj, adkit.uid(2)), (bara_proj, adkit.uid(1));

  -- a private conversation
  perform adkit.as_user(1);
  conv := public.start_conversation(adkit.uid(2));
  perform adkit.as_user(2);
  reset role;
  insert into public.direct_messages (conversation_id, sender_id, body) values (conv, adkit.uid(1), 'Message prive de ana'), (conv, adkit.uid(2), 'Reponse de bara');

  -- a community owned by bara, where ana writes
  perform adkit.as_user(2);
  comm := public.create_community('club-bara', 'Club Bara', null, false, true);
  perform adkit.as_user(1);
  perform public.join_community(comm);
  select id into ch from public.channels where community_id = comm limit 1;
  perform public.send_message(ch, 'Bonjour a tous, ana ici', null, null);
  reset role;

  -- a quest attempt, a Souk item she created and one bara bought from her
  insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward, kopek_reward, published)
  values ('ad-quest', 'AD', 'griot_du_code', 'ndongo', 'python', 5, 100, 10, true);
  insert into public.quest_attempts (user_id, quest_id, status, code)
  select adkit.uid(1), id, 'in_progress', 'print("secret code")' from public.quests where slug = 'ad-quest';
  insert into public.souk_items (slug, kind, name, price_kopeks, creator_id) values ('ad-item', 'theme', 'Theme Ana', 50, adkit.uid(1));
  insert into public.souk_sales (item_id, item_name, creator_id, buyer_id, price, share_percent, creator_amount)
  select id, 'Theme Ana', adkit.uid(1), adkit.uid(2), 50, 70, 35 from public.souk_items where slug = 'ad-item';
  insert into public.souk_sales (item_id, item_name, creator_id, buyer_id, price, share_percent, creator_amount)
  select id, 'Theme Ana', adkit.uid(2), adkit.uid(1), 50, 70, 35 from public.souk_items where slug = 'ad-item';
end $$;

-- ---- Set-up: people who cannot delete ---------------------------------------------------------------------------------
do $$
declare comm uuid; emp uuid; off uuid;
begin
  insert into public.staff_roles (user_id, role) values (adkit.uid(3), 'admin');
  insert into public.member_suspensions (user_id, reason, until) values (adkit.uid(4), 'test', now() + interval '3 days');

  perform adkit.as_user(5);
  comm := public.create_community('club-eve', 'Club Eve', null, false, true);
  perform adkit.as_user(2);
  perform public.join_community(comm);
  perform adkit.as_user(7);
  perform public.create_community('club-gora', 'Club Gora', null, false, true);
  reset role;

  insert into public.employers (owner_id, kind, name, status) values (adkit.uid(6), 'company', 'Atelier Fara', 'approved') returning id into emp;
  insert into public.job_offers (employer_id, posted_by, title, kind, employment_type, description, status, published_at)
  values (emp, adkit.uid(6), 'Dev Fara', 'job', 'full_time', 'Un poste', 'published', now()) returning id into off;
end $$;

-- ---- 1. Who may call what ----------------------------------------------------------------------------------------------
do $$
begin
  perform adkit.must_fail('a visitor asks to delete', 'set local role anon; select public.request_account_deletion()', 'permission denied');
  reset role;
  perform adkit.must_fail('a visitor exports', 'set local role anon; select public.export_my_data()', 'permission denied');
  reset role;
  perform adkit.as_user(1);
  perform adkit.must_fail('a member lists due accounts', 'select * from public.accounts_due_for_deletion(10)', 'permission denied');
  perform adkit.must_fail('a member purges an account', format('select public.purge_account(%L)', adkit.uid(2)), 'permission denied');
  perform adkit.must_fail('a member reads the blocker check of someone else', format('select * from public.account_deletion_blockers(%L)', adkit.uid(2)), 'permission denied');
  perform adkit.must_fail('a member lists another member''s files', format('select * from public.account_files(%L)', adkit.uid(2)), 'permission denied');
  perform adkit.must_fail('a member writes the request column directly', format('update public.profiles set deletion_requested_at = now() where id = %L', adkit.uid(1)), 'permission denied');
  reset role;
  raise notice 'OK 1: members and visitors cannot reach the purge tools or write the request themselves';
end $$;

-- ---- 2. Accounts that cannot be deleted are told why -----------------------------------------------------------------
do $$
declare r record;
begin
  perform adkit.as_user(3);
  perform adkit.must_fail('an admin deletes', 'select public.request_account_deletion()', 'staff');
  perform adkit.as_user(4);
  perform adkit.must_fail('a suspended member deletes', 'select public.request_account_deletion()', 'suspended');
  perform adkit.as_user(5);
  perform adkit.must_fail('a community owner with members deletes', 'select public.request_account_deletion()', 'community_owner');
  select * into r from public.my_account_deletion();
  if r.blockers -> 0 ->> 'code' <> 'community_owner' or (r.blockers -> 0 ->> 'count')::int <> 1 then raise exception 'FAIL: blockers not shown: %', r.blockers; end if;
  perform adkit.as_user(6);
  perform adkit.must_fail('an employer with a live offer deletes', 'select public.request_account_deletion()', 'employer_active');
  reset role;
  if exists (select 1 from public.profiles where id in (adkit.uid(3), adkit.uid(4), adkit.uid(5), adkit.uid(6)) and deletion_requested_at is not null) then
    raise exception 'FAIL: a refused request was still recorded';
  end if;
  raise notice 'OK 2: staff, suspended, community owners with members and employers with live offers are refused with the reason';
end $$;

-- ---- 3. Ask, change my mind, ask again -----------------------------------------------------------------------------------
do $$
declare d1 timestamptz; d2 timestamptz; r record;
begin
  -- a community owner with nobody else in it is not blocked
  perform adkit.as_user(7);
  select * into r from public.my_account_deletion();
  if jsonb_array_length(r.blockers) <> 0 then raise exception 'FAIL: an empty community blocks deletion: %', r.blockers; end if;

  perform adkit.as_user(1);
  select * into r from public.my_account_deletion();
  if r.requested_at is not null or r.delete_on is not null then raise exception 'FAIL: a request exists before asking'; end if;

  d1 := public.request_account_deletion();
  select * into r from public.my_account_deletion();
  if r.requested_at is null then raise exception 'FAIL: request not recorded'; end if;
  if r.delete_on <> d1 then raise exception 'FAIL: dates disagree'; end if;
  if d1 < now() + interval '13 days 23 hours' or d1 > now() + interval '14 days 1 hour' then raise exception 'FAIL: waiting period is not 14 days: %', d1; end if;

  -- asking again does not push the date back
  d2 := public.request_account_deletion();
  if d2 <> d1 then raise exception 'FAIL: asking twice moved the date'; end if;

  perform public.cancel_account_deletion();
  select * into r from public.my_account_deletion();
  if r.requested_at is not null then raise exception 'FAIL: cancel did not clear the request'; end if;
  perform public.cancel_account_deletion();  -- harmless when nothing is pending
  reset role;
  raise notice 'OK 3: ask, 14-day wait, asking twice keeps the date, cancel clears it, cancel is harmless';
end $$;

-- ---- 4. Nothing is due before the wait is over; the purge refuses an account that is not due -------------------------
do $$
begin
  perform adkit.as_user(1);
  perform public.request_account_deletion();
  reset role;
  perform adkit.as_server();
  if exists (select 1 from public.accounts_due_for_deletion(50) where user_id = adkit.uid(1)) then raise exception 'FAIL: due on day 0'; end if;
  perform adkit.must_fail('purge before the wait', format('select public.purge_account(%L)', adkit.uid(1)), 'not due');
  perform adkit.must_fail('purge an account nobody asked to delete', format('select public.purge_account(%L)', adkit.uid(2)), 'not due');
  reset role;

  update public.profiles set deletion_requested_at = now() - interval '13 days' where id = adkit.uid(1);
  perform adkit.as_server();
  if exists (select 1 from public.accounts_due_for_deletion(50) where user_id = adkit.uid(1)) then raise exception 'FAIL: due on day 13'; end if;
  reset role;

  update public.profiles set deletion_requested_at = now() - interval '14 days 1 minute' where id = adkit.uid(1);
  perform adkit.as_server();
  if not exists (select 1 from public.accounts_due_for_deletion(50) where user_id = adkit.uid(1)) then raise exception 'FAIL: not due after 14 days'; end if;
  reset role;
  raise notice 'OK 4: due only after the wait; the purge refuses accounts that are not due';
end $$;

-- ---- 5. Export holds my data, only mine ---------------------------------------------------------------------------------------
do $$
declare j jsonb;
begin
  perform adkit.as_user(1);
  j := public.export_my_data();
  reset role;
  if j -> 'account' ->> 'email' <> 'ad1@exemple.sn' then raise exception 'FAIL: e-mail missing'; end if;
  if j -> 'profile' ->> 'id' <> adkit.uid(1)::text then raise exception 'FAIL: profile missing'; end if;
  if (j -> 'wallet' ->> 'kopeks')::int <> 100 then raise exception 'FAIL: wallet missing'; end if;
  if jsonb_array_length(j -> 'kopek_history') <> 1 then raise exception 'FAIL: kopek history'; end if;
  if j -> 'quest_attempts' -> 0 ->> 'code' <> 'print("secret code")' then raise exception 'FAIL: quest code missing'; end if;
  if j -> 'projects' -> 0 ->> 'title' <> 'Depot Ana' or jsonb_array_length(j -> 'projects') <> 1 then raise exception 'FAIL: projects'; end if;
  if j -> 'project_comments' -> 0 ->> 'body' <> 'Merci pour le depot' or jsonb_array_length(j -> 'project_comments') <> 1 then raise exception 'FAIL: own comment only'; end if;
  if jsonb_array_length(j -> 'private_messages_sent') <> 1 or j -> 'private_messages_sent' -> 0 ->> 'body' <> 'Message prive de ana' then
    raise exception 'FAIL: only the messages ana sent: %', j -> 'private_messages_sent';
  end if;
  if j::text like '%Reponse de bara%' then raise exception 'FAIL: another member''s private message is in the export'; end if;
  if j::text like '%Joli projet%' then raise exception 'FAIL: another member''s comment is in the export'; end if;
  if j -> 'communities' -> 'messages_written' -> 0 ->> 'body' <> 'Bonjour a tous, ana ici' then raise exception 'FAIL: community message'; end if;
  if jsonb_array_length(j -> 'souk' -> 'purchases') <> 1 or jsonb_array_length(j -> 'souk' -> 'sales_as_creator') <> 1 then raise exception 'FAIL: souk'; end if;
  if (j -> 'souk' -> 'sales_as_creator' -> 0) ? 'buyer_id' then raise exception 'FAIL: a buyer is identified in the sales as creator'; end if;
  if j::text like '%ad2@exemple.sn%' then raise exception 'FAIL: another member''s e-mail in the export'; end if;
  raise notice 'OK 5: the export has the member''s own data and none of anyone else''s';
end $$;

-- ---- 6. The purge: the member goes, everything of theirs goes, other people keep theirs ---------------------------------
do $$
declare before_users int; n int;
begin
  perform adkit.as_server();
  perform public.purge_account(adkit.uid(1));
  reset role;

  if exists (select 1 from auth.users where id = adkit.uid(1)) then raise exception 'FAIL: login still there'; end if;
  if exists (select 1 from public.profiles where id = adkit.uid(1)) then raise exception 'FAIL: profile still there'; end if;
  for n in select 1 where exists (select 1 from public.wallets where user_id = adkit.uid(1))
      or exists (select 1 from public.kopek_transactions where user_id = adkit.uid(1))
      or exists (select 1 from public.quest_attempts where user_id = adkit.uid(1))
      or exists (select 1 from public.projects where owner_id = adkit.uid(1))
      or exists (select 1 from public.project_comments where author_id = adkit.uid(1))
      or exists (select 1 from public.direct_messages where sender_id = adkit.uid(1))
      or exists (select 1 from public.messages where author_id = adkit.uid(1))
      or exists (select 1 from public.community_members where user_id = adkit.uid(1))
  loop raise exception 'FAIL: some of ana''s data is still there'; end loop;

  -- the things that depended on ana's projects went with them; bara's own things stay
  if exists (select 1 from public.project_comments where body = 'Joli projet') then raise exception 'FAIL: comment on a deleted project remains'; end if;
  if not exists (select 1 from public.projects where owner_id = adkit.uid(2)) then raise exception 'FAIL: bara''s project was deleted'; end if;
  if exists (select 1 from public.project_stars where project_id in (select id from public.projects where owner_id = adkit.uid(2)) and user_id = adkit.uid(1)) then raise exception 'FAIL: ana''s star remains'; end if;
  if not exists (select 1 from public.profiles where id = adkit.uid(2)) then raise exception 'FAIL: bara disappeared'; end if;
  if exists (select 1 from public.conversations where user_a = adkit.uid(1) or user_b = adkit.uid(1)) then raise exception 'FAIL: the conversation remains'; end if;
  if not exists (select 1 from public.communities where slug = 'club-bara') then raise exception 'FAIL: bara''s community was deleted'; end if;

  -- the Souk keeps the item, without a creator name; bara keeps her purchase record without a buyer reference to ana
  if not exists (select 1 from public.souk_items where slug = 'ad-item' and creator_id is null) then raise exception 'FAIL: souk item should stay, without creator'; end if;
  if exists (select 1 from public.souk_sales where buyer_id = adkit.uid(1) or creator_id = adkit.uid(1)) then raise exception 'FAIL: sales mentioning ana remain'; end if;

  -- a record with no name, e-mail or id
  select count(*) into n from public.account_deletion_log;
  if n <> 1 then raise exception 'FAIL: deletion log has % rows', n; end if;
  if exists (select 1 from public.account_deletion_log where id_fingerprint = adkit.uid(1)::text or id_fingerprint like '%ad1@%') then raise exception 'FAIL: the log holds the id itself'; end if;
  if (select length(id_fingerprint) from public.account_deletion_log) <> 64 then raise exception 'FAIL: fingerprint shape'; end if;
  raise notice 'OK 6: the purge removes the member and everything of theirs, and leaves everyone else''s data alone';
end $$;

-- ---- 7. The purge re-checks: an account that became un-deletable is refused, and can be sent back to normal ------------
do $$
begin
  update public.profiles set deletion_requested_at = now() - interval '20 days' where id = adkit.uid(6);
  perform adkit.as_server();
  perform adkit.must_fail('purge an employer with a live offer', format('select public.purge_account(%L)', adkit.uid(6)), 'cannot be deleted');
  if not exists (select 1 from public.account_blockers_for(adkit.uid(6))) then raise exception 'FAIL: blockers not reported to the server'; end if;
  perform public.abort_account_deletion(adkit.uid(6));
  reset role;
  if (select deletion_requested_at from public.profiles where id = adkit.uid(6)) is not null then raise exception 'FAIL: abort did not clear the request'; end if;
  if not exists (select 1 from auth.users where id = adkit.uid(6)) then raise exception 'FAIL: the refused purge deleted the login'; end if;
  raise notice 'OK 7: the purge refuses an account that is no longer deletable; the server can send it back to normal';
end $$;

-- ---- 8. Files to delete are listed by folder ----------------------------------------------------------------------------------
do $$
declare n int;
begin
  insert into storage.buckets (id, name) values ('dm-files', 'dm-files'), ('cv-files', 'cv-files'), ('souk-images', 'souk-images'), ('other', 'other')
  on conflict (id) do nothing;
  insert into storage.objects (bucket_id, name) values
    ('dm-files', adkit.uid(2)::text || '/a.png'), ('cv-files', adkit.uid(2)::text || '/cv.pdf'), ('souk-images', adkit.uid(2)::text || '/i.webp'),
    ('dm-files', adkit.uid(3)::text || '/b.png'), ('other', adkit.uid(2)::text || '/c.png');
  perform adkit.as_server();
  select count(*) into n from public.account_files(adkit.uid(2));
  reset role;
  if n <> 3 then raise exception 'FAIL: expected 3 files of bara, got %', n; end if;
  raise notice 'OK 8: the member''s files are found by folder in the three upload buckets only';
end $$;

-- ---- Clean up -----------------------------------------------------------------------------------------------------------------------
delete from storage.objects where name like adkit.uid(2)::text || '/%' or name like adkit.uid(3)::text || '/%';
delete from public.job_offers where posted_by = adkit.uid(6);
delete from public.employers where owner_id = adkit.uid(6);
delete from public.souk_sales where item_name = 'Theme Ana';
delete from public.souk_items where slug = 'ad-item';
delete from public.quests where slug = 'ad-quest';
delete from public.communities where slug in ('club-bara', 'club-eve', 'club-gora');
delete from public.account_deletion_log;
delete from auth.users where id in (select adkit.uid(n) from generate_series(1, 7) n);
drop schema adkit cascade;

select 'ALL ACCOUNT DELETION AND EXPORT TESTS PASSED' as result;
