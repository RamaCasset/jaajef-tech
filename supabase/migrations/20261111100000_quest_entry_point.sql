-- jaajef.tech - Which function does the player's code have to provide?
--
-- A code quest is graded by calling one function of the player's code, e.g. first_repeat, once per hidden test.
-- Convention (to confirm with Marie): the test "input" is passed as the function's single argument, and the
-- value it returns must equal "expected" (compared as JSON; Python None / JavaScript null are both "null").
--
-- begin_quest_run now also gives the server that function name. A quest without one cannot be run yet.

alter table public.quests
  add column entry_point text check (entry_point ~ '^[A-Za-z_][A-Za-z0-9_]{0,59}$');

comment on column public.quests.entry_point is
  'Name of the function the player must write. The hidden tests call it with each test input as its single argument.';

-- The quest that already exists.
update public.quests set entry_point = 'first_repeat' where slug = 'la-malediction-du-loop';

create or replace function public.begin_quest_run(p_user uuid, p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quest public.quests;
  v_status text;
  v_minute integer;
  v_day integer;
begin
  if p_user is null then raise exception 'not authenticated'; end if;

  select * into v_quest from public.quests where id = p_quest_id and published;
  if not found then raise exception 'quest not available'; end if;

  select status into v_status from public.quest_attempts where user_id = p_user and quest_id = p_quest_id;
  if not found then raise exception 'start the quest first'; end if;
  if v_status = 'solved' then raise exception 'quest already solved'; end if;
  if v_quest.entry_point is null then raise exception 'quest has no entry point yet'; end if;

  delete from public.quest_runs where ran_at < now() - interval '1 day';
  select count(*) filter (where ran_at > now() - interval '1 minute'), count(*)
    into v_minute, v_day from public.quest_runs where user_id = p_user;
  if v_minute >= 6 or v_day >= 150 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_runs');
  end if;
  insert into public.quest_runs (user_id, quest_id) values (p_user, p_quest_id);

  return jsonb_build_object(
    'allowed', true,
    'language', v_quest.language,
    'entry_point', v_quest.entry_point,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'input', t.input, 'expected', t.expected) order by t.position, t.id)
        from public.quest_tests t where t.quest_id = p_quest_id), '[]'::jsonb));
end $$;

revoke execute on function public.begin_quest_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_quest_run(uuid, uuid) to service_role;
