-- Tests for migration 7 (character lock, 10-minute quests).
-- Run AFTER migrations 1 to 7. psql -v ON_ERROR_STOP=1 -f fixes.test.sql

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'ndeye@exemple.sn', '{"provider":"email"}', '{}'),
  ('f1f1f1f1-0000-0000-0000-000000000002', 'omar@exemple.sn', '{"provider":"email"}', '{}');

-- ---- 1. The character is chosen once ----------------------------------------------
do $$
declare p record; e text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'f1f1f1f1-0000-0000-0000-000000000001', true);
  perform public.set_character('saltigue', 'bagne');
  perform public.set_character('saltigue', 'bagne'); -- same choice again: harmless

  begin
    perform public.set_character('forgeron', 'bagne');
    raise exception 'FAIL: the clan was changed';
  exception when raise_exception then
    get stacked diagnostics e = message_text;
    if e not like '%already chosen%' then raise; end if;
  end;

  begin
    perform public.set_character('saltigue', 'ndongo');
    raise exception 'FAIL: the mastery was changed';
  exception when raise_exception then
    get stacked diagnostics e = message_text;
    if e not like '%already chosen%' then raise; end if;
  end;
  reset role;

  select * into p from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000001';
  if p.clan <> 'saltigue' or p.mastery <> 'bagne' then raise exception 'FAIL: the character changed (% / %)', p.clan, p.mastery; end if;
  if p.onboarding_step < 3 then raise exception 'FAIL: onboarding did not move forward'; end if;
  raise notice 'OK 1: the clan and mastery are chosen once; repeating the same choice is harmless';
end $$;

-- ---- 2. Another member can still choose their own ---------------------------------------
do $$
declare p record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'f1f1f1f1-0000-0000-0000-000000000002', true);
  perform public.set_character('forgeron', 'ndongo');
  reset role;
  select * into p from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000002';
  if p.clan <> 'forgeron' then raise exception 'FAIL: second member could not choose'; end if;
  if (select clan from public.profiles where id = 'f1f1f1f1-0000-0000-0000-000000000001') <> 'saltigue' then
    raise exception 'FAIL: the first member was affected';
  end if;
  raise notice 'OK 2: each member chooses their own character once';
end $$;

-- ---- 3. Quests take at most 10 minutes -----------------------------------------------------
do $$
declare ok boolean := false;
begin
  if (select max(est_minutes) from public.quests) > 10 then raise exception 'FAIL: a quest is longer than 10 minutes'; end if;

  insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward)
  values ('dix-minutes', 'Dix minutes', 'forgeron', 'ndongo', 'python', 10, 5);

  begin
    insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward)
    values ('onze-minutes', 'Onze minutes', 'forgeron', 'ndongo', 'python', 11, 5);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: an 11-minute quest was accepted'; end if;

  ok := false;
  begin
    insert into public.quests (slug, title, clan, mastery, language, est_minutes, xp_reward)
    values ('zero-minute', 'Zero', 'forgeron', 'ndongo', 'python', 0, 5);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: a 0-minute quest was accepted'; end if;

  ok := false;
  begin update public.quests set est_minutes = 30 where slug = 'dix-minutes';
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAIL: a quest was stretched to 30 minutes'; end if;
  raise notice 'OK 3: quests last between 1 and 10 minutes';
end $$;

-- ---- 4. Monthly challenges are recorded as to be confirmed ------------------------------------
do $$
begin
  if not exists (select 1 from public.game_config where key = 'monthly_challenge' and status = 'tbc') then
    raise exception 'FAIL: the monthly challenge setting is missing';
  end if;
  raise notice 'OK 4: monthly challenges are listed as to be confirmed';
end $$;

select 'ALL FIXES TESTS PASSED' as result;
