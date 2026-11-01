-- =====================================================================
-- jaajef.tech  -  Migration 2: Quests
--
-- What this does
--   * Seasons, quests, their tests, and each member's attempts.
--   * start_quest / save_attempt / submit_quest: the only way a member
--     touches attempts. Members cannot write to the tables directly.
--   * A solved quest pays XP and Kopeks ONCE through grant_reward().
--   * Streaks (days in a row) and the streak chest reward.
--   * Live leaderboards per quest and per season.
--
-- HONEST LIMIT (first version): quests run in the member's browser, so the
-- server cannot re-run the code. submit_quest trusts the browser's "all tests
-- passed" report, but it measures the time itself and refuses solves that are
-- implausibly fast. A determined cheater could still fake a pass. The fix is a
-- server-side runner (V2) that re-runs the code; the tables are ready for it.
--
-- Requires migration 1 (foundation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default false
);

-- Only one season can be active at a time.
create unique index seasons_one_active on public.seasons (is_active) where is_active;

-- ---------------------------------------------------------------------
-- Quests and their tests
-- ---------------------------------------------------------------------
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null,
  summary text,
  statement_md text,
  clan public.clan_type not null,
  mastery public.mastery_type not null, -- Ndongo / Bagne / Borom Xam-Xam
  kind text not null default 'code' check (kind in ('code', 'review')),
  language text check (language in ('python', 'javascript')),
  topic text, -- e.g. 'Data viz', 'Sécurité'
  est_minutes integer not null check (est_minutes > 0),
  xp_reward integer not null check (xp_reward > 0),
  kopek_reward bigint not null default 0 check (kopek_reward >= 0),
  min_seconds integer not null default 15 check (min_seconds >= 0),
  starter_code text,
  season_id uuid references public.seasons (id) on delete set null,
  daily_on date unique, -- the quest of the day
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- an auto-tested quest must say which language it runs in
  check (kind <> 'code' or language is not null)
);

create trigger quests_updated_at
  before update on public.quests
  for each row execute function public.set_updated_at();

create table public.quest_tests (
  id bigint generated always as identity primary key,
  quest_id uuid not null references public.quests (id) on delete cascade,
  position integer not null default 0,
  name text not null,
  input jsonb not null,
  expected jsonb not null
);
create index quest_tests_quest_idx on public.quest_tests (quest_id, position);

-- ---------------------------------------------------------------------
-- Attempts (one row per member per quest; private to the member)
-- ---------------------------------------------------------------------
create table public.quest_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id uuid not null references public.quests (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'solved')),
  code text check (char_length(code) <= 50000),
  tests_passed integer not null default 0 check (tests_passed >= 0),
  tests_total integer not null default 0 check (tests_total >= 0),
  started_at timestamptz not null default now(),
  solved_at timestamptz,
  duration_ms integer check (duration_ms >= 0),
  unique (user_id, quest_id)
);
create index quest_attempts_quest_idx on public.quest_attempts (quest_id, status, duration_ms);

-- ---------------------------------------------------------------------
-- Streaks (internal; called only from submit_quest)
-- Senegal is on UTC, so current_date matches the members' day.
-- ---------------------------------------------------------------------
create function public.bump_streak(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak integer;
  v_reward_day bigint;
  v_reward_kopeks bigint;
begin
  update public.profiles
     set streak_days = case
           when last_active_on = current_date then streak_days -- already counted today
           when last_active_on = current_date - 1 then streak_days + 1 -- continues the chain
           else 1 -- new chain
         end,
         last_active_on = current_date
   where id = p_user
  returning streak_days into v_streak;

  select (value #>> '{}')::bigint into v_reward_day
    from public.game_config where key = 'streak_reward_day';
  select (value #>> '{}')::bigint into v_reward_kopeks
    from public.game_config where key = 'streak_reward_kopeks';

  -- Chest every N days. The date in the key makes it pay once per day at most.
  if v_reward_day > 0 and v_streak % v_reward_day = 0 then
    perform public.grant_reward(
      p_user, 0, coalesce(v_reward_kopeks, 0), 'streak_chest',
      'streak:' || p_user::text || ':' || current_date::text);
  end if;

  return v_streak;
end;
$$;

-- ---------------------------------------------------------------------
-- Member actions
-- ---------------------------------------------------------------------

-- Open a quest (or resume it). The server clock starts here.
create function public.start_quest(p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.quest_attempts;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.quests where id = p_quest_id and published) then
    raise exception 'quest not available';
  end if;

  insert into public.quest_attempts (user_id, quest_id)
  values (v_user, p_quest_id)
  on conflict (user_id, quest_id) do nothing;

  select * into v_attempt from public.quest_attempts
   where user_id = v_user and quest_id = p_quest_id;

  return jsonb_build_object(
    'status', v_attempt.status,
    'code', v_attempt.code,
    'tests_passed', v_attempt.tests_passed,
    'tests_total', v_attempt.tests_total,
    'started_at', v_attempt.started_at);
end;
$$;

-- Save progress so the member can resume later ("Reprendre", 3/4 tests).
create function public.save_attempt(p_quest_id uuid, p_code text, p_tests_passed integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(p_code, '')) > 50000 then
    raise exception 'code too long';
  end if;

  select count(*) into v_total from public.quest_tests where quest_id = p_quest_id;

  update public.quest_attempts
     set code = p_code,
         tests_total = v_total,
         tests_passed = least(greatest(coalesce(p_tests_passed, 0), 0), v_total)
   where user_id = v_user and quest_id = p_quest_id and status = 'in_progress';

  if not found then
    raise exception 'no open attempt for this quest';
  end if;
end;
$$;

-- Submit a solution. Returns a JSON result the app can show.
create function public.submit_quest(
  p_quest_id uuid,
  p_code text,
  p_tests_passed integer,
  p_tests_total integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_quest public.quests;
  v_attempt public.quest_attempts;
  v_required integer;
  v_elapsed integer;
  v_streak integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(p_code, '')) > 50000 then
    raise exception 'code too long';
  end if;

  select * into v_quest from public.quests
   where id = p_quest_id and published and kind = 'code';
  if not found then
    raise exception 'quest not available';
  end if;

  select * into v_attempt from public.quest_attempts
   where user_id = v_user and quest_id = p_quest_id for update;
  if not found then
    raise exception 'start the quest first';
  end if;

  -- Already solved: no second payment.
  if v_attempt.status = 'solved' then
    return jsonb_build_object('solved', true, 'already_solved', true,
                              'duration_ms', v_attempt.duration_ms);
  end if;

  select count(*) into v_required from public.quest_tests where quest_id = p_quest_id;
  if v_required = 0 then
    raise exception 'quest has no tests yet';
  end if;

  -- The report must cover every test of the quest and all of them must pass.
  if p_tests_total is distinct from v_required or p_tests_passed is distinct from v_required then
    update public.quest_attempts
       set code = p_code,
           tests_total = v_required,
           tests_passed = least(greatest(coalesce(p_tests_passed, 0), 0), v_required)
     where id = v_attempt.id;
    return jsonb_build_object('solved', false, 'reason', 'tests_not_passed',
                              'tests_passed', least(greatest(coalesce(p_tests_passed, 0), 0), v_required),
                              'tests_total', v_required);
  end if;

  -- The SERVER measures time, not the browser.
  v_elapsed := least(extract(epoch from (now() - v_attempt.started_at)) * 1000, 2147483647)::integer;
  if v_elapsed < v_quest.min_seconds * 1000 then
    return jsonb_build_object('solved', false, 'reason', 'too_fast',
                              'min_seconds', v_quest.min_seconds);
  end if;

  update public.quest_attempts
     set status = 'solved', code = p_code, tests_passed = v_required,
         tests_total = v_required, solved_at = now(), duration_ms = v_elapsed
   where id = v_attempt.id;

  -- One payment per member per quest, however many times this is called.
  perform public.grant_reward(
    v_user, v_quest.xp_reward, v_quest.kopek_reward, 'quest_solved',
    'quest:' || p_quest_id::text || ':' || v_user::text, 'quest', p_quest_id::text);

  v_streak := public.bump_streak(v_user);

  return jsonb_build_object(
    'solved', true, 'already_solved', false,
    'xp', v_quest.xp_reward, 'kopeks', v_quest.kopek_reward,
    'duration_ms', v_elapsed, 'streak_days', v_streak);
end;
$$;

-- ---------------------------------------------------------------------
-- Leaderboards (public, never expose anyone's code)
-- ---------------------------------------------------------------------
create function public.quest_leaderboard(p_quest_id uuid, p_limit integer default 20)
returns table (
  rank bigint,
  username text,
  display_name text,
  avatar_url text,
  clan public.clan_type,
  duration_ms integer,
  solved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select row_number() over (order by a.duration_ms, a.solved_at, a.id),
         p.username, p.display_name, p.avatar_url, p.clan, a.duration_ms, a.solved_at
    from public.quest_attempts a
    join public.profiles p on p.id = a.user_id
    join public.quests q on q.id = a.quest_id and q.published
   where a.quest_id = p_quest_id and a.status = 'solved'
   order by a.duration_ms, a.solved_at, a.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function public.season_leaderboard(p_season_id uuid, p_limit integer default 20)
returns table (
  rank bigint,
  username text,
  display_name text,
  avatar_url text,
  clan public.clan_type,
  points bigint,
  quests_solved bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select row_number() over (order by sum(q.xp_reward) desc, count(*) desc, p.username),
         p.username, p.display_name, p.avatar_url, p.clan,
         sum(q.xp_reward)::bigint, count(*)
    from public.quest_attempts a
    join public.quests q on q.id = a.quest_id and q.published and q.season_id = p_season_id
    join public.profiles p on p.id = a.user_id
   where a.status = 'solved'
   group by p.id, p.username, p.display_name, p.avatar_url, p.clan
   order by sum(q.xp_reward) desc, count(*) desc, p.username
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.seasons enable row level security;
alter table public.quests enable row level security;
alter table public.quest_tests enable row level security;
alter table public.quest_attempts enable row level security;

revoke all on public.seasons, public.quests, public.quest_tests, public.quest_attempts
  from anon, authenticated;

-- Public: seasons, and published quests with their tests (the browser runs them).
grant select on public.seasons, public.quests, public.quest_tests to anon, authenticated;
create policy "seasons are public" on public.seasons for select to anon, authenticated using (true);
create policy "published quests are public" on public.quests
  for select to anon, authenticated using (published);
create policy "tests of published quests are public" on public.quest_tests
  for select to anon, authenticated
  using (exists (select 1 from public.quests q where q.id = quest_id and q.published));

-- Private: a member reads only their own attempts. No direct writes.
grant select on public.quest_attempts to authenticated;
create policy "own attempts" on public.quest_attempts
  for select to authenticated using (user_id = (select auth.uid()));

-- Functions: lock down, then open only what is meant to be called.
revoke execute on function public.bump_streak(uuid) from public, anon, authenticated;
grant execute on function public.bump_streak(uuid) to service_role;

revoke execute on function public.start_quest(uuid) from public, anon;
grant execute on function public.start_quest(uuid) to authenticated;
revoke execute on function public.save_attempt(uuid, text, integer) from public, anon;
grant execute on function public.save_attempt(uuid, text, integer) to authenticated;
revoke execute on function public.submit_quest(uuid, text, integer, integer) from public, anon;
grant execute on function public.submit_quest(uuid, text, integer, integer) to authenticated;

grant execute on function public.quest_leaderboard(uuid, integer) to anon, authenticated;
grant execute on function public.season_leaderboard(uuid, integer) to anon, authenticated;

grant all on public.seasons, public.quests, public.quest_tests, public.quest_attempts to service_role;

-- ---------------------------------------------------------------------
-- Starting content, taken from Marie's quest screens.
-- Only the first quest is complete and published. The others are drafts
-- waiting for their statement and tests (to be written in the back-office).
-- ---------------------------------------------------------------------
insert into public.seasons (slug, name, is_active)
values ('saison-04', 'Saison 04 · Les gardiens du baobab', true);

insert into public.quests
  (slug, title, summary, statement_md, clan, mastery, kind, language, topic,
   est_minutes, xp_reward, kopek_reward, starter_code, season_id, published)
select 'la-malediction-du-loop', 'La Malédiction du Loop',
       'Brise la boucle et retrouve le premier nombre répété dans les signaux de la Cité.',
$md$Le Saltigué a piégé les signaux de la Cité dans une boucle. Repérez le premier nombre qui apparaît une seconde fois pour briser le sort.

## Votre mission

Complétez `first_repeat(values)`. Renvoyez la première valeur répétée dans l'ordre de lecture, ou `None` si toutes les valeurs sont uniques.

## Exemples

```
[1, 2, 1, 3] -> 1
[7, 7]       -> 7
[1, 2, 3]    -> None
```

## Contraintes

- 0 ≤ len(values) ≤ 100 000
- Valeurs entières
- Temps O(n), mémoire O(n)
- Ne modifiez pas la liste source

*Indice : un ensemble garde la mémoire des valeurs déjà rencontrées.*$md$,
       'saltigue', 'bagne', 'code', 'python', 'Algorithmes',
       25, 250, 50,
$py$# Brisez le cycle avant qu'il ne se répète.
def first_repeat(values):
    seen = set()

    for i in range(len(values) - 1):
        value = values[i]
        if value in seen:
            return value
        seen.add(value)

    return None

# TODO: vérifier la borne de la boucle
# Complexité cible : O(n)
$py$,
       s.id, true
  from public.seasons s where s.slug = 'saison-04';

insert into public.quest_tests (quest_id, position, name, input, expected)
select q.id, t.position, t.name, t.input::jsonb, t.expected::jsonb
  from public.quests q,
       (values
         (1, 'test_repeat_middle', '[1, 2, 1, 3]', '1'),
         (2, 'test_unique', '[1, 2, 3]', 'null'),
         (3, 'test_empty', '[]', 'null'),
         (4, 'test_repeat_last', '[7, 7]', '7')
       ) as t(position, name, input, expected)
 where q.slug = 'la-malediction-du-loop';

-- Draft quests (not published): title, rewards and level are from the screens.
insert into public.quests
  (slug, title, summary, clan, mastery, kind, language, topic,
   est_minutes, xp_reward, kopek_reward, season_id, published)
select d.slug, d.title, d.summary, d.clan::public.clan_type, d.mastery::public.mastery_type,
       d.kind, d.language, d.topic, d.est_minutes, d.xp, d.kopeks, s.id, false
  from public.seasons s,
       (values
         ('un-peu-de-code-beaucoup-de-racines', 'Un peu de code, beaucoup de racines',
          'Aide le petit baobab à retrouver ses messages : crée une fonction de bienvenue pour les nouveaux de la Cité.',
          'griot_du_code', 'ndongo', 'code', 'javascript', 'Fonctions', 15, 150, 30),
         ('un-car-rapide-haut-en-couleur', 'Un car rapide haut en couleur',
          'Imagine une carte de trajet accessible, aussi vivante que les rues de Dakar.',
          'forgeron', 'ndongo', 'review', null, 'UI design', 20, 180, 35),
         ('le-gardien-des-mots-de-passe', 'Le gardien des mots de passe',
          'Aide le petit gardien à repérer les secrets trop fragiles avant la nuit.',
          'buur_linguere', 'ndongo', 'code', 'javascript', 'Sécurité', 15, 150, 30),
         ('teranga-dans-l-api', 'Teranga dans l''API',
          'Offre un accueil sans accroc : construis une route pour les nouveaux membres.',
          'griot_du_code', 'bagne', 'code', 'javascript', 'API', 30, 300, 60),
         ('les-etoiles-de-saint-louis', 'Les étoiles de Saint-Louis',
          'Fais parler les données météo et dessine une jolie carte du ciel.',
          'saltigue', 'borom_xam_xam', 'code', 'python', 'Data viz', 40, 400, 80),
         ('le-petit-atelier-du-souk', 'Le petit atelier du Souk',
          'Des icônes claires et des coins tout doux : ton premier kit de composants est prêt.',
          'forgeron', 'ndongo', 'review', null, 'Figma', 20, 180, 35)
       ) as d(slug, title, summary, clan, mastery, kind, language, topic, est_minutes, xp, kopeks)
 where s.slug = 'saison-04';
