-- =====================================================================
-- jaajef.tech  -  Migration 3: making quests teach
--
-- What this does
--   * Every quest is a coding quest. The "review" type is removed and a
--     language is now required (HTML and CSS added for front-end quests).
--   * Hints: revealed one at a time, never public. The server counts how many
--     a member used (for the "quests without hints" goal on the design).
--   * A short explanation per quest, locked until the member solves it.
--   * A position, so each clan's quests can be ordered from easy to hard.
--
-- Requires migrations 1 and 2.
-- =====================================================================

-- All-or-nothing: if any step fails, nothing is changed.
begin;

-- ---------------------------------------------------------------------
-- 1. Every quest is a coding quest
-- ---------------------------------------------------------------------
-- The old rule only allowed python and javascript, so it goes first.
alter table public.quests drop constraint quests_language_check;

update public.quests
   set language = 'html_css'
 where kind = 'review';

-- Dropping the column also drops the checks that mention it.
alter table public.quests drop column kind;

alter table public.quests
  add constraint quests_language_check check (language in ('python', 'javascript', 'html_css'));
alter table public.quests alter column language set not null;

-- ---------------------------------------------------------------------
-- 2. Order inside a clan's path (1 = first), and hint counting
-- ---------------------------------------------------------------------
alter table public.quests
  add column position integer check (position > 0);

alter table public.quest_attempts
  add column hints_used integer not null default 0 check (hints_used >= 0);

-- ---------------------------------------------------------------------
-- 3. Hints and explanations (private tables, opened only through rules)
-- ---------------------------------------------------------------------
create table public.quest_hints (
  quest_id uuid not null references public.quests (id) on delete cascade,
  level smallint not null check (level >= 1),
  body text not null,
  primary key (quest_id, level)
);

create table public.quest_explanations (
  quest_id uuid primary key references public.quests (id) on delete cascade,
  explanation_md text not null
);

-- ---------------------------------------------------------------------
-- 4. Member actions for hints
-- ---------------------------------------------------------------------

-- Reveals the NEXT hint. Each call costs one hint in the member's count.
create function public.use_hint(p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.quest_attempts;
  v_hint public.quest_hints;
  v_total integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_attempt from public.quest_attempts
   where user_id = v_user and quest_id = p_quest_id for update;
  if not found then
    raise exception 'start the quest first';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'quest already solved';
  end if;

  select count(*) into v_total from public.quest_hints where quest_id = p_quest_id;

  select * into v_hint from public.quest_hints
   where quest_id = p_quest_id and level = v_attempt.hints_used + 1;
  if not found then
    return jsonb_build_object('no_more_hints', true,
                              'hints_used', v_attempt.hints_used, 'hints_total', v_total);
  end if;

  update public.quest_attempts set hints_used = hints_used + 1 where id = v_attempt.id;

  return jsonb_build_object('level', v_hint.level, 'body', v_hint.body,
                            'hints_used', v_attempt.hints_used + 1, 'hints_total', v_total);
end;
$$;

-- Re-read the hints the member has already unlocked (and only those).
create function public.get_unlocked_hints(p_quest_id uuid)
returns table (level smallint, body text)
language sql
stable
security definer
set search_path = public
as $$
  select h.level, h.body
    from public.quest_hints h
    join public.quest_attempts a on a.quest_id = h.quest_id
   where a.user_id = auth.uid()
     and a.quest_id = p_quest_id
     and h.level <= a.hints_used
   order by h.level;
$$;

-- ---------------------------------------------------------------------
-- 5. submit_quest, rewritten without the removed "review" type.
-- It now also reports how many hints were used.
-- ---------------------------------------------------------------------
create or replace function public.submit_quest(
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

  select * into v_quest from public.quests where id = p_quest_id and published;
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
                              'duration_ms', v_attempt.duration_ms,
                              'hints_used', v_attempt.hints_used);
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
    'duration_ms', v_elapsed, 'streak_days', v_streak,
    'hints_used', v_attempt.hints_used);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Security
-- Hints and explanations are never public. Hints come only through
-- use_hint / get_unlocked_hints. The explanation opens only for members
-- who have solved that quest.
-- ---------------------------------------------------------------------
alter table public.quest_hints enable row level security;
alter table public.quest_explanations enable row level security;

revoke all on public.quest_hints, public.quest_explanations from anon, authenticated;

grant select on public.quest_explanations to authenticated;
create policy "explanation opens after solving" on public.quest_explanations
  for select to authenticated
  using (exists (
    select 1 from public.quest_attempts a
     where a.quest_id = quest_explanations.quest_id
       and a.user_id = (select auth.uid())
       and a.status = 'solved'
  ));

revoke execute on function public.use_hint(uuid) from public, anon;
grant execute on function public.use_hint(uuid) to authenticated;
revoke execute on function public.get_unlocked_hints(uuid) from public, anon;
grant execute on function public.get_unlocked_hints(uuid) to authenticated;

grant all on public.quest_hints, public.quest_explanations to service_role;

-- ---------------------------------------------------------------------
-- 7. Starting content
-- The hints and explanation below were written as a SAMPLE of a finished
-- lesson. They are a draft to be reviewed and edited.
-- Topics and html_css languages for the other quests are guesses, to confirm.
-- ---------------------------------------------------------------------
update public.quests
   set topic = 'Boucles et ensembles', position = 1
 where slug = 'la-malediction-du-loop';

update public.quests set topic = 'HTML et CSS'
 where slug in ('un-car-rapide-haut-en-couleur', 'le-petit-atelier-du-souk');

insert into public.quest_hints (quest_id, level, body)
select q.id, h.level, h.body
  from public.quests q,
       (values
         (1, 'Relis ta boucle : combien d''éléments parcourt-elle vraiment ? Compare avec le nombre d''éléments de la liste.'),
         (2, 'Le test qui échoue est celui où le doublon est à la fin. Qu''est-ce qui empêche la boucle de lire le dernier élément ?'),
         (3, 'range(len(values) - 1) s''arrête un élément trop tôt. Essaie range(len(values)), ou parcours directement for value in values.')
       ) as h(level, body)
 where q.slug = 'la-malediction-du-loop';

insert into public.quest_explanations (quest_id, explanation_md)
select q.id,
$md$## Pourquoi ça échouait

La boucle s'arrêtait un élément trop tôt : `range(len(values) - 1)` ne regarde jamais le dernier élément. Avec `[7, 7]`, elle lit le premier 7, puis s'arrête sans voir le second.

## La solution

```python
def first_repeat(values):
    seen = set()
    for value in values:
        if value in seen:
            return value
        seen.add(value)
    return None
```

## Ce qu'il faut retenir

- Un ensemble (`set`) permet de savoir très vite si une valeur a déjà été vue. Le total reste en O(n).
- Parcourir directement les valeurs (`for value in values`) évite les erreurs de borne, appelées « off-by-one ».
- Teste toujours les cas limites : liste vide, doublon à la fin, aucune répétition.$md$
  from public.quests q
 where q.slug = 'la-malediction-du-loop';

commit;
