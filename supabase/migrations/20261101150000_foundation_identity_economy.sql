-- =====================================================================
-- jaajef.tech  -  Migration 1: identity, XP, Kopeks, badges
--
-- What this does
--   * Every new sign-up automatically gets a profile and a wallet
--     (with the welcome Kopeks from game_config).
--   * XP and Kopeks can ONLY be changed by the server through
--     grant_reward(). Browsers cannot give themselves points.
--   * Every Kopek movement is written to an append-only ledger.
--
-- Values still to be confirmed are marked TBC in game_config.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
-- Clan spelling of the 4th clan is TBC with Marie ("Buur/Lingeer" vs
-- "Linguere"). The stored value is neutral; display names live in the app.
create type public.clan_type as enum (
  'griot_du_code', -- Software Engineer
  'forgeron', -- UI/UX & 3D Designer
  'saltigue', -- Data & AI Scientist
  'buur_linguere' -- Cybersecurity & DevOps
);

create type public.mastery_type as enum (
  'ndongo', -- Junior
  'bagne', -- Mid
  'borom_xam_xam' -- Senior
);

-- ---------------------------------------------------------------------
-- Shared helper
-- ---------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Game settings (tunable without touching code)
-- ---------------------------------------------------------------------
create table public.game_config (
  key text primary key,
  value jsonb not null,
  status text not null default 'defined' check (status in ('defined', 'tbc')),
  description text,
  updated_at timestamptz not null default now()
);

create trigger game_config_updated_at
  before update on public.game_config
  for each row execute function public.set_updated_at();

insert into public.game_config (key, value, status, description) values
  ('start_xp', '0', 'defined', 'XP given to a new member'),
  ('start_kopeks', '100', 'defined', 'Kopeks given to a new member (from the onboarding screen)'),
  ('start_level', '1', 'defined', 'Level of a new member'),
  ('streak_reward_day', '7', 'defined', 'Streak length that unlocks the reward chest (from the quests screen)'),
  ('streak_reward_kopeks', '100', 'defined', 'Kopeks in the streak chest (from the quests screen)'),
  ('xp_per_level', '10000', 'tbc', 'PLACEHOLDER: fixed XP per level. Real level formula TBC'),
  ('souk_creator_share_percent', 'null', 'tbc', 'Creator share of a Souk sale. TBC');

-- Level from XP. Placeholder formula until the real one is decided (TBC).
create function public.level_for_xp(p_xp bigint)
returns integer
language sql
stable
set search_path = public
as $$
  select 1 + (
    greatest(p_xp, 0)
    / greatest((select (value #>> '{}')::bigint from public.game_config where key = 'xp_per_level'), 1)
  )::integer;
$$;

-- ---------------------------------------------------------------------
-- Profiles (public identity) and wallets (private balance)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  banner_url text,
  bio text check (char_length(bio) <= 500),
  location text check (char_length(location) <= 100),
  github_username text, -- only ever set from a verified GitHub login
  clan public.clan_type,
  mastery public.mastery_type,
  xp bigint not null default 0 check (xp >= 0),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_active_on date,
  available_to_collab boolean not null default false,
  is_verified boolean not null default false,
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kopeks bigint not null default 0 check (kopeks >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ledgers (append-only history; the source of truth for rewards)
-- ---------------------------------------------------------------------
create table public.xp_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  ref_type text,
  ref_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index xp_events_user_idx on public.xp_events (user_id, created_at desc);

create table public.kopek_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  ref_type text,
  ref_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index kopek_transactions_user_idx on public.kopek_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Badges
-- ---------------------------------------------------------------------
create table public.badges (
  slug text primary key,
  name text not null,
  description text,
  tier text not null default 'common' check (tier in ('common', 'rare', 'legendary')),
  created_at timestamptz not null default now()
);

create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_slug text not null references public.badges (slug) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  unlocked_at timestamptz,
  primary key (user_id, badge_slug)
);

-- Starter badges taken from the profile screen. Names and rules can change.
insert into public.badges (slug, name, description, tier) values
  ('maitre_griot', 'Maître Griot', '100 contributions', 'common'),
  ('gardien_du_baobab', 'Gardien du Baobab', '128 quêtes terminées', 'common'),
  ('champion_du_sahel', 'Champion du Sahel', 'Gold II, saison 04', 'rare'),
  ('oeil_du_saltigue', 'Œil du Saltigué', '10 défis Data & AI', 'common'),
  ('sceau_securite', 'Sceau de Linguère', '5 audits de sécurité', 'common'),
  ('teranga_legendaire', 'Teranga légendaire', '1 000 points de karma', 'legendary'),
  ('l_architecte', 'L''Architecte', '20 projets publiés', 'rare');

-- ---------------------------------------------------------------------
-- The ONLY way to change XP or Kopeks (server side only)
--   * idempotent: the same key can never pay twice
--   * atomic: profile, wallet and ledger change together
--   * a negative p_kopeks spends Kopeks; overspending raises an error
-- ---------------------------------------------------------------------
create function public.grant_reward(
  p_user uuid,
  p_xp integer,
  p_kopeks bigint,
  p_reason text,
  p_key text,
  p_ref_type text default null,
  p_ref_id text default null
)
returns boolean -- true = applied, false = already applied
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'idempotency key required';
  end if;

  -- Lock the member so two rewards for the same person cannot interleave.
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception 'unknown user %', p_user;
  end if;

  if exists (select 1 from public.xp_events where idempotency_key = p_key)
     or exists (select 1 from public.kopek_transactions where idempotency_key = p_key) then
    return false;
  end if;

  if coalesce(p_xp, 0) <> 0 then
    update public.profiles set xp = xp + p_xp where id = p_user;
    insert into public.xp_events (user_id, amount, reason, ref_type, ref_id, idempotency_key)
    values (p_user, p_xp, p_reason, p_ref_type, p_ref_id, p_key);
  end if;

  if coalesce(p_kopeks, 0) <> 0 then
    update public.wallets
       set kopeks = kopeks + p_kopeks, updated_at = now()
     where user_id = p_user
    returning kopeks into v_balance;

    insert into public.kopek_transactions
      (user_id, amount, balance_after, reason, ref_type, ref_id, idempotency_key)
    values
      (p_user, p_kopeks, v_balance, p_reason, p_ref_type, p_ref_id, p_key);
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- New sign-up -> profile + wallet + welcome Kopeks
-- Only data from a verified provider (GitHub / Google) is trusted:
-- sign-up metadata typed by the user is never used for github_username,
-- avatar or verification.
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := new.raw_app_meta_data ->> 'provider';
  v_trusted boolean := coalesce(v_provider, '') in ('github', 'google');
  v_base text;
  v_candidate text;
  v_name text;
  v_avatar text;
  v_github text;
  v_start bigint;
  n integer := 0;
begin
  v_github := case when v_provider = 'github' then new.raw_user_meta_data ->> 'user_name' end;

  v_base := lower(coalesce(v_github, split_part(coalesce(new.email, ''), '@', 1), ''));
  v_base := left(regexp_replace(v_base, '[^a-z0-9_]', '_', 'g'), 24);
  if char_length(v_base) < 3 then
    v_base := left('membre_' || v_base, 24);
  end if;
  v_candidate := v_base;

  v_name := case when v_trusted
                 then coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
            end;
  v_avatar := case when v_trusted and (new.raw_user_meta_data ->> 'avatar_url') like 'https://%'
                   then new.raw_user_meta_data ->> 'avatar_url'
              end;

  loop
    begin
      insert into public.profiles (id, username, display_name, avatar_url, github_username)
      values (new.id, v_candidate, left(coalesce(nullif(v_name, ''), v_candidate), 60), v_avatar, v_github);
      exit;
    exception when unique_violation then
      n := n + 1;
      if n > 50 then
        raise exception 'could not find a free username for %', v_base;
      end if;
      v_candidate := left(v_base, 24) || '_' || n::text;
    end;
  end loop;

  insert into public.wallets (user_id) values (new.id);

  select (value #>> '{}')::bigint into v_start from public.game_config where key = 'start_kopeks';
  perform public.grant_reward(new.id, 0, coalesce(v_start, 0), 'welcome', 'welcome:' || new.id::text);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Onboarding calls (a member may only change their OWN character)
-- ---------------------------------------------------------------------
create function public.set_character(p_clan public.clan_type, p_mastery public.mastery_type)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles
     set clan = p_clan,
         mastery = p_mastery,
         onboarding_step = greatest(onboarding_step, 3)
   where id = auth.uid();
end;
$$;

-- Moves onboarding forward only (never back), up to step 4.
create function public.set_onboarding_step(p_step smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_step < 1 or p_step > 4 then
    raise exception 'step must be between 1 and 4';
  end if;
  update public.profiles
     set onboarding_step = greatest(onboarding_step, p_step)
   where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Security: row-level security + explicit privileges
-- Start from zero access, then open only what each role needs.
-- ---------------------------------------------------------------------
alter table public.game_config enable row level security;
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.xp_events enable row level security;
alter table public.kopek_transactions enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

revoke all on public.game_config, public.profiles, public.wallets, public.xp_events,
              public.kopek_transactions, public.badges, public.user_badges
  from anon, authenticated;

-- Public reads (showcase pages are visible without logging in)
grant select on public.game_config, public.profiles, public.badges, public.user_badges
  to anon, authenticated;
create policy "game_config is public" on public.game_config for select to anon, authenticated using (true);
create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "badges are public" on public.badges for select to anon, authenticated using (true);
create policy "user badges are public" on public.user_badges for select to anon, authenticated using (true);

-- A member edits only safe columns of their own profile.
-- xp, clan, mastery, is_verified, github_username, onboarding_step,
-- streak_days are NOT editable from the browser.
grant update (username, display_name, avatar_url, banner_url, bio, location, available_to_collab)
  on public.profiles to authenticated;
create policy "members edit their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Private data: a member reads only their own wallet and history. No writes.
grant select on public.wallets, public.xp_events, public.kopek_transactions to authenticated;
create policy "own wallet" on public.wallets for select to authenticated using (user_id = (select auth.uid()));
create policy "own xp history" on public.xp_events for select to authenticated using (user_id = (select auth.uid()));
create policy "own kopek ledger" on public.kopek_transactions for select to authenticated using (user_id = (select auth.uid()));

-- Functions: lock everything, then open only what is meant to be called.
revoke execute on function public.grant_reward(uuid, integer, bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_reward(uuid, integer, bigint, text, text, text, text)
  to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.set_character(public.clan_type, public.mastery_type) from public, anon;
grant execute on function public.set_character(public.clan_type, public.mastery_type) to authenticated;

revoke execute on function public.set_onboarding_step(smallint) from public, anon;
grant execute on function public.set_onboarding_step(smallint) to authenticated;

grant execute on function public.level_for_xp(bigint) to anon, authenticated;

-- The server (service role) manages everything else.
grant all on public.game_config, public.profiles, public.wallets, public.xp_events,
             public.kopek_transactions, public.badges, public.user_badges
  to service_role;
