-- =====================================================================
-- jaajef.tech  -  Migration 7: Badges that unlock by themselves
--
-- What this does
--   * A rules table says how each badge is earned (what is counted and how
--     many). The numbers can be changed without touching any code.
--   * Progress is tracked as members act (for example 42 out of 100), and a
--     badge unlocks when the goal is reached. Once unlocked, it is never taken
--     back, and progress never goes down.
--   * Three badges are automatic today:
--       Gardien du Baobab : quests solved
--       L'Architecte      : projects confirmed on GitHub
--       Maitre Griot      : contributions (see below)
--   * The other four need things that do not exist yet or are not defined
--     (a Gold II ranking, Data & AI challenges, security audits, karma). They
--     are "manual": the server can award them by hand until they are defined.
--
-- What counts as a contribution (TO BE CONFIRMED)
--   A forum thread or reply, not deleted, in a community that has at least 3
--   members. The minimum stops anyone from farming the badge by spamming their
--   own empty community. It is a setting in game_config.
--
-- Badges give no XP or Kopeks. Unlocking is done by database triggers, so it
-- works whichever way the action happens.
--
-- Requires migrations 1 to 6 (it reads quests, projects and forum messages).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.game_config (key, value, status, description) values
  ('badge_min_community_members', '3', 'tbc', 'A forum post counts as a contribution only in a community with at least this many members. Definition of a contribution TBC');

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
create table public.badge_rules (
  badge_slug text primary key references public.badges (slug) on delete cascade,
  metric text not null check (metric in ('contributions', 'quests_solved', 'projects_published', 'manual')),
  threshold integer,
  check ((metric = 'manual' and threshold is null) or (metric <> 'manual' and threshold is not null and threshold > 0))
);

insert into public.badge_rules (badge_slug, metric, threshold) values
  ('maitre_griot', 'contributions', 100),
  ('gardien_du_baobab', 'quests_solved', 128),
  ('l_architecte', 'projects_published', 20),
  -- Not automatic yet: the thing they count is not defined or not built.
  ('champion_du_sahel', 'manual', null),
  ('oeil_du_saltigue', 'manual', null),
  ('sceau_securite', 'manual', null),
  ('teranga_legendaire', 'manual', null);

-- ---------------------------------------------------------------------
-- Counting
-- ---------------------------------------------------------------------
create function public.badge_metric(p_user uuid, p_metric text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case p_metric
    when 'quests_solved' then
      (select count(*)::integer from public.quest_attempts where user_id = p_user and status = 'solved')
    when 'projects_published' then
      (select count(*)::integer from public.projects where owner_id = p_user and verified_at is not null)
    when 'contributions' then
      (select count(*)::integer
         from public.messages m
         join public.channels c on c.id = m.channel_id
        where m.author_id = p_user
          and c.kind = 'forum'
          and m.deleted_at is null
          and (select count(*) from public.community_members cm where cm.community_id = m.community_id)
                >= public.chat_setting('badge_min_community_members'))
    else 0
  end
$$;

-- Recounts one kind of progress for one member, and unlocks what is reached.
-- Progress never goes down, and an unlocked badge stays unlocked.
create function public.refresh_badges(p_user uuid, p_metric text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.badge_rules;
  v_value integer;
begin
  for v_rule in select * from public.badge_rules where metric = p_metric loop
    v_value := public.badge_metric(p_user, p_metric);
    if v_value <= 0 then continue; end if;

    insert into public.user_badges (user_id, badge_slug, progress, unlocked_at)
    values (
      p_user,
      v_rule.badge_slug,
      least(v_value, v_rule.threshold),
      case when v_value >= v_rule.threshold then now() end
    )
    on conflict (user_id, badge_slug) do update
      set progress = greatest(public.user_badges.progress, excluded.progress),
          unlocked_at = coalesce(public.user_badges.unlocked_at, excluded.unlocked_at);
  end loop;
end $$;

-- Gives a badge by hand (for the badges that are not automatic yet).
create function public.award_badge(p_user uuid, p_badge text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found'; end if;
  if not exists (select 1 from public.badges where slug = p_badge) then raise exception 'Badge not found'; end if;

  insert into public.user_badges (user_id, badge_slug, progress, unlocked_at)
  values (p_user, p_badge, 0, now())
  on conflict (user_id, badge_slug) do update
    set unlocked_at = coalesce(public.user_badges.unlocked_at, now());
end $$;

-- ---------------------------------------------------------------------
-- Triggers: recount at the moment something relevant happens
-- ---------------------------------------------------------------------
create function public.badges_after_quest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'solved' and (tg_op = 'INSERT' or old.status is distinct from 'solved') then
    perform public.refresh_badges(new.user_id, 'quests_solved');
  end if;
  return null;
end $$;

create trigger quest_attempts_badges
  after insert or update on public.quest_attempts
  for each row execute function public.badges_after_quest();

create function public.badges_after_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verified_at is not null and (tg_op = 'INSERT' or old.verified_at is null) then
    perform public.refresh_badges(new.owner_id, 'projects_published');
  end if;
  return null;
end $$;

create trigger projects_badges
  after insert or update on public.projects
  for each row execute function public.badges_after_project();

create function public.badges_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.channels where id = new.channel_id and kind = 'forum') then
    perform public.refresh_badges(new.author_id, 'contributions');
  end if;
  return null;
end $$;

create trigger messages_badges
  after insert on public.messages
  for each row execute function public.badges_after_message();

-- ---------------------------------------------------------------------
-- Privacy rules and who may call what
-- ---------------------------------------------------------------------
alter table public.badge_rules enable row level security;

revoke all on public.badge_rules from public, anon, authenticated;
grant select on public.badge_rules to anon, authenticated;

create policy "badge rules are public" on public.badge_rules for select to anon, authenticated using (true);

revoke execute on function public.badge_metric(uuid, text) from public, anon, authenticated;
revoke execute on function public.refresh_badges(uuid, text) from public, anon, authenticated;
revoke execute on function public.award_badge(uuid, text) from public, anon, authenticated;
revoke execute on function public.badges_after_quest() from public, anon, authenticated;
revoke execute on function public.badges_after_project() from public, anon, authenticated;
revoke execute on function public.badges_after_message() from public, anon, authenticated;

grant execute on function public.badge_metric(uuid, text) to service_role;
grant execute on function public.refresh_badges(uuid, text) to service_role;
grant execute on function public.award_badge(uuid, text) to service_role;

grant all on public.badge_rules to service_role;

-- ---------------------------------------------------------------------
-- Catch up: count what members have already done
-- ---------------------------------------------------------------------
do $$
declare
  v_member uuid;
begin
  for v_member in select id from public.profiles loop
    perform public.refresh_badges(v_member, 'quests_solved');
    perform public.refresh_badges(v_member, 'projects_published');
    perform public.refresh_badges(v_member, 'contributions');
  end loop;
end $$;

commit;
