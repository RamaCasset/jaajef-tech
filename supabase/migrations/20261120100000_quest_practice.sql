-- A member can run a solved quest again to practise.
-- The run is graded but nothing is recorded and nothing is paid: the first solve keeps its reward and its saved code.

begin;

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
    'practice', v_status = 'solved',
    'language', v_quest.language,
    'entry_point', v_quest.entry_point,
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'input', t.input, 'expected', t.expected) order by t.position, t.id)
        from public.quest_tests t where t.quest_id = p_quest_id), '[]'::jsonb));
end $$;

revoke execute on function public.begin_quest_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_quest_run(uuid, uuid) to service_role;

commit;
