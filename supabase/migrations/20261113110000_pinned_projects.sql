-- Pinned projects: a member can pin a few of their own projects to the top of their repositories page and profile.
-- The limit is a setting (TO BE CONFIRMED with Marie, 3 in the design).

begin;

insert into public.game_config (key, value, status, description) values
  ('projects_max_pinned', '3', 'tbc', 'Most projects one member can pin');

alter table public.projects add column pinned_at timestamptz;

create function public.set_project_pinned(p_project uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_already timestamptz;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_pinned is null then raise exception 'Choose pin or unpin'; end if;
  select pinned_at into v_already from public.projects where id = p_project and owner_id = v_me for update;
  if not found then raise exception 'Project not found'; end if;
  if p_pinned and v_already is null
     and (select count(*) from public.projects where owner_id = v_me and pinned_at is not null) >= public.chat_setting('projects_max_pinned') then
    raise exception 'You can pin % projects at most', public.chat_setting('projects_max_pinned');
  end if;
  update public.projects set pinned_at = case when p_pinned then coalesce(v_already, now()) end where id = p_project;
end $$;

revoke execute on function public.set_project_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_project_pinned(uuid, boolean) to authenticated;

commit;
