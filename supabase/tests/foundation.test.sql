-- Tests for migration 1. Run with:  psql -v ON_ERROR_STOP=1 -f foundation.test.sql
-- Any failed check raises an exception and stops the run.

-- ---- 1. Sign-ups ----------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'moussa@exemple.sn',
   '{"provider":"github"}',
   '{"user_name":"moussa-dev","full_name":"Moussa Diop","avatar_url":"https://example.com/a.png"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'awa@exemple.sn',
   '{"provider":"email"}',
   '{"user_name":"fake-github","full_name":"Fake Name","avatar_url":"https://evil.example/x.png"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'awa@autre.sn',
   '{"provider":"email"}', '{}');

do $$
declare p record; w bigint; n int;
begin
  -- GitHub login: username cleaned, GitHub verified, avatar kept
  select * into p from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if p.username <> 'moussa_dev' then raise exception 'FAIL username: %', p.username; end if;
  if p.github_username <> 'moussa-dev' then raise exception 'FAIL github_username'; end if;
  if p.display_name <> 'Moussa Diop' then raise exception 'FAIL display_name'; end if;

  -- Welcome Kopeks in wallet AND ledger
  select kopeks into w from public.wallets where user_id = p.id;
  if w <> 100 then raise exception 'FAIL welcome kopeks: %', w; end if;
  select count(*) into n from public.kopek_transactions where user_id = p.id and reason = 'welcome';
  if n <> 1 then raise exception 'FAIL welcome ledger row'; end if;

  -- Email sign-up cannot fake a GitHub identity or an avatar
  select * into p from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  if p.github_username is not null then raise exception 'FAIL spoofed github_username accepted'; end if;
  if p.avatar_url is not null then raise exception 'FAIL spoofed avatar accepted'; end if;
  if p.username <> 'awa' then raise exception 'FAIL username awa: %', p.username; end if;

  -- Username clash gets a suffix instead of failing the sign-up
  select * into p from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  if p.username <> 'awa_1' then raise exception 'FAIL username clash: %', p.username; end if;
  raise notice 'OK 1: sign-up creates profile, wallet and welcome Kopeks; spoofing refused';
end $$;

-- ---- 2. A browser cannot give itself points -------------------------
do $$
declare ok boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

  ok := false;
  begin update public.profiles set xp = 999999 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could edit own xp'; end if;

  ok := false;
  begin update public.profiles set is_verified = true where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could verify themselves'; end if;

  ok := false;
  begin update public.wallets set kopeks = 1000000 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could edit wallet'; end if;

  ok := false;
  begin insert into public.kopek_transactions (user_id, amount, balance_after, reason, idempotency_key)
        values ('aaaaaaaa-0000-0000-0000-000000000001', 500, 600, 'cheat', 'cheat:1');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could write the ledger'; end if;

  ok := false;
  begin perform public.grant_reward('aaaaaaaa-0000-0000-0000-000000000001', 1000, 1000, 'cheat', 'cheat:2');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could call grant_reward'; end if;

  ok := false;
  begin insert into public.profiles (id, username, display_name)
        values ('aaaaaaaa-0000-0000-0000-000000000099', 'ghost_user', 'Ghost');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: member could create a profile'; end if;

  reset role;
  raise notice 'OK 2: members cannot edit XP, wallet, ledger, verification or call grant_reward';
end $$;

-- ---- 3. Privacy: wallets are private, profiles are public -----------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  select count(*) into n from public.wallets;
  if n <> 1 then raise exception 'FAIL: member sees % wallets (expected 1)', n; end if;
  select count(*) into n from public.kopek_transactions;
  if n <> 1 then raise exception 'FAIL: member sees % ledger rows (expected 1)', n; end if;
  select count(*) into n from public.profiles;
  if n <> 3 then raise exception 'FAIL: profiles should be public (saw %)', n; end if;
  reset role;

  set local role anon;
  select count(*) into n from public.profiles;
  if n <> 3 then raise exception 'FAIL: anon should see public profiles'; end if;
  reset role;
  raise notice 'OK 3: wallets private, profiles public';
end $$;

-- A visitor who is not logged in sees no private data at all
do $$
declare ok boolean := false;
begin
  set local role anon;
  begin perform count(*) from public.wallets;
  exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: anon can read wallets'; end if;
  raise notice 'OK 3b: anonymous visitors cannot read wallets';
end $$;

-- ---- 4. Server rewards: applied once, atomically --------------------
do $$
declare r1 boolean; r2 boolean; p record; w bigint; n int;
begin
  set local role service_role;
  r1 := public.grant_reward('aaaaaaaa-0000-0000-0000-000000000001', 250, 50, 'quest_solved', 'quest:SQ-042:aaaaaaaa-0000-0000-0000-000000000001', 'quest', 'SQ-042');
  r2 := public.grant_reward('aaaaaaaa-0000-0000-0000-000000000001', 250, 50, 'quest_solved', 'quest:SQ-042:aaaaaaaa-0000-0000-0000-000000000001', 'quest', 'SQ-042');
  reset role;

  if r1 is not true  then raise exception 'FAIL: first grant not applied'; end if;
  if r2 is not false then raise exception 'FAIL: replayed grant was applied twice'; end if;

  select * into p from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select kopeks into w from public.wallets where user_id = p.id;
  if p.xp <> 250 then raise exception 'FAIL: xp is % (expected 250)', p.xp; end if;
  if w <> 150 then raise exception 'FAIL: wallet is % (expected 150)', w; end if;
  select count(*) into n from public.kopek_transactions where user_id = p.id;
  if n <> 2 then raise exception 'FAIL: ledger rows % (expected 2)', n; end if;
  if (select balance_after from public.kopek_transactions where user_id = p.id order by id desc limit 1) <> 150 then
    raise exception 'FAIL: balance_after does not match wallet';
  end if;
  raise notice 'OK 4: reward applied once, replay ignored, wallet and ledger agree';
end $$;

-- ---- 5. Overspending is refused and nothing changes -----------------
do $$
declare ok boolean := false; w bigint; n int;
begin
  set local role service_role;
  begin perform public.grant_reward('aaaaaaaa-0000-0000-0000-000000000001', 0, -1000, 'purchase', 'buy:too-expensive');
  exception when check_violation then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: overspend was allowed'; end if;
  select kopeks into w from public.wallets where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if w <> 150 then raise exception 'FAIL: wallet changed after refused spend: %', w; end if;
  select count(*) into n from public.kopek_transactions where idempotency_key = 'buy:too-expensive';
  if n <> 0 then raise exception 'FAIL: refused spend left a ledger row'; end if;

  -- a valid spend works
  set local role service_role;
  perform public.grant_reward('aaaaaaaa-0000-0000-0000-000000000001', 0, -100, 'purchase', 'buy:theme-1');
  reset role;
  select kopeks into w from public.wallets where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if w <> 50 then raise exception 'FAIL: wallet after spend % (expected 50)', w; end if;
  raise notice 'OK 5: overspend refused, valid spend applied';
end $$;

-- ---- 6. Onboarding --------------------------------------------------
do $$
declare p record; ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  perform public.set_character('griot_du_code', 'ndongo');
  perform public.set_onboarding_step(4::smallint);
  perform public.set_onboarding_step(2::smallint);   -- must not go backwards
  reset role;

  select * into p from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if p.clan <> 'griot_du_code' or p.mastery <> 'ndongo' then raise exception 'FAIL: character not saved'; end if;
  if p.onboarding_step <> 4 then raise exception 'FAIL: onboarding step % (expected 4)', p.onboarding_step; end if;

  -- another member's character is untouched
  if (select clan from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000002') is not null then
    raise exception 'FAIL: set_character changed someone else';
  end if;

  -- visitors cannot call it
  set local role anon;
  begin perform public.set_character('forgeron', 'bagne');
  exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL: anon called set_character'; end if;
  raise notice 'OK 6: onboarding works, forward only, own profile only';
end $$;

-- ---- 7. Safe edits still work ---------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  update public.profiles set bio = 'Je construis des outils ouverts.', available_to_collab = true
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if not found then raise exception 'FAIL: member cannot edit own bio'; end if;

  -- cannot edit someone else's profile (RLS hides the row)
  update public.profiles set bio = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  if found then raise exception 'FAIL: member edited another profile'; end if;
  reset role;
  raise notice 'OK 7: members edit only their own safe fields';
end $$;

-- ---- 8. Levels (placeholder formula) --------------------------------
do $$
begin
  if public.level_for_xp(0) <> 1 then raise exception 'FAIL level 0'; end if;
  if public.level_for_xp(9999) <> 1 then raise exception 'FAIL level 9999'; end if;
  if public.level_for_xp(10000) <> 2 then raise exception 'FAIL level 10000'; end if;
  raise notice 'OK 8: level_for_xp works (placeholder formula, TBC)';
end $$;

select 'ALL TESTS PASSED' as result;
