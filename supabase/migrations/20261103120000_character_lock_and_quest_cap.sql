-- =====================================================================
-- jaajef.tech  -  Migration 7: Lock the character, cap quests at 10 minutes
--
-- What this does (from Marie's answers)
--   * A member's clan (and mastery) is chosen once, during onboarding, and
--     cannot be changed afterwards. Calling set_character again with the same
--     choice is harmless (a double click or a retry); a different choice is
--     refused.
--   * Every quest takes at most 10 minutes. The 7 sample quests were drafts of
--     15 to 40 minutes: they are shortened to 10. Their XP and Kopeks are
--     placeholders and were not changed.
--   * Monthly big challenges are recorded as "to be confirmed" in game_config.
--
-- How the clans relate to years of experience, and how mastery ranks relate to
-- clans, are still to be decided. Nothing here depends on that.
--
-- Requires migrations 1 to 6.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- The character is chosen once
-- ---------------------------------------------------------------------
create or replace function public.set_character(p_clan public.clan_type, p_mastery public.mastery_type)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clan public.clan_type;
  v_mastery public.mastery_type;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_clan is null or p_mastery is null then
    raise exception 'Choose a clan and a mastery';
  end if;

  select clan, mastery into v_clan, v_mastery from public.profiles where id = auth.uid() for update;

  if v_clan is not null then
    -- Same choice again: nothing to do. Anything else: refused.
    if v_clan = p_clan and v_mastery is not distinct from p_mastery then
      return;
    end if;
    raise exception 'Your character is already chosen and cannot be changed';
  end if;

  update public.profiles
     set clan = p_clan,
         mastery = p_mastery,
         onboarding_step = greatest(onboarding_step, 3)
   where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Quests take at most 10 minutes
-- ---------------------------------------------------------------------
update public.quests set est_minutes = 10 where est_minutes > 10;

alter table public.quests
  add constraint quests_est_minutes_max check (est_minutes <= 10);

-- ---------------------------------------------------------------------
-- Monthly big challenges: to be confirmed
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('monthly_challenge', 'null', 'tbc',
   'Monthly big challenges. TBC: solo or teams, length, and reward (XP, Kopeks or a special badge)');

commit;
