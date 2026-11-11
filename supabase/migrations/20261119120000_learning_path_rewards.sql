-- jaajef.tech  -  Migration: a reward for finishing a learning path
--
--   * When every step of a path is done (lessons read, quests solved), the member can claim
--     a reward once: XP and Kopeks, from the settings learning_path_xp and learning_path_kopeks.
--     The values are marked "to be confirmed" and are set for real at the end.
--   * Claiming goes through grant_reward with a key per member and path, so it can never be paid twice.
--
-- Requires: learning_paths.

begin;

insert into public.game_config (key, value, status, description) values
  ('learning_path_xp', '200', 'tbc', 'XP for finishing a learning path'),
  ('learning_path_kopeks', '100', 'tbc', 'Kopeks for finishing a learning path')
on conflict (key) do nothing;

create table public.learning_path_rewards (
  user_id uuid not null references public.profiles (id) on delete cascade,
  path_id uuid not null references public.learning_paths (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (user_id, path_id)
);
alter table public.learning_path_rewards enable row level security;
revoke all on public.learning_path_rewards from public, anon, authenticated;
grant all on public.learning_path_rewards to service_role;

-- Where I stand on one path's reward.
create function public.learning_path_reward_state(p_path text)
returns table (complete boolean, claimed boolean, xp integer, kopeks integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_path public.learning_paths;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_path from public.learning_paths where slug = p_path and published;
  if not found then raise exception 'path_not_found'; end if;
  return query
  select exists (select 1 from public.learning_steps s where s.path_id = v_path.id)
         and not exists (select 1 from public.learning_steps s
                          where s.path_id = v_path.id and not public.learning_step_done(auth.uid(), s.id)),
         exists (select 1 from public.learning_path_rewards r where r.user_id = auth.uid() and r.path_id = v_path.id),
         public.chat_setting('learning_path_xp'),
         public.chat_setting('learning_path_kopeks');
end $$;

-- "Claim my reward." Only when the whole path is done, and only once.
create function public.claim_learning_path_reward(p_path text)
returns table (granted boolean, xp integer, kopeks integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_path public.learning_paths;
  v_xp integer := public.chat_setting('learning_path_xp');
  v_kopeks integer := public.chat_setting('learning_path_kopeks');
  v_new boolean;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  select * into v_path from public.learning_paths where slug = p_path and published;
  if not found then raise exception 'path_not_found'; end if;
  if not exists (select 1 from public.learning_steps s where s.path_id = v_path.id)
     or exists (select 1 from public.learning_steps s where s.path_id = v_path.id and not public.learning_step_done(v_me, s.id)) then
    raise exception 'path_not_finished';
  end if;

  insert into public.learning_path_rewards (user_id, path_id) values (v_me, v_path.id) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new then
    perform public.grant_reward(v_me, v_xp, v_kopeks, 'learning_path', 'learningpath:' || v_path.id || ':' || v_me, 'learning_path', v_path.id::text);
  end if;
  return query select v_new, v_xp, v_kopeks;
end $$;

revoke execute on function public.learning_path_reward_state(text) from public, anon;
revoke execute on function public.claim_learning_path_reward(text) from public, anon;
grant execute on function public.learning_path_reward_state(text) to authenticated;
grant execute on function public.claim_learning_path_reward(text) to authenticated;

commit;
