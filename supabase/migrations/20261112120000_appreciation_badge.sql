-- "Teranga légendaire" now unlocks by itself: 100 stars and likes received (see received_appreciation).
-- The goal is a setting in badge_rules (TO BE CONFIRMED with Marie). The word "karma" is no longer used.

begin;

alter table public.badge_rules drop constraint badge_rules_metric_check;
alter table public.badge_rules add constraint badge_rules_metric_check
  check (metric in ('contributions', 'quests_solved', 'projects_published', 'appreciation', 'manual'));

update public.badges set description = '100 étoiles et j''aimes reçus' where slug = 'teranga_legendaire';
update public.badge_rules set metric = 'appreciation', threshold = 100 where badge_slug = 'teranga_legendaire';

create or replace function public.badge_metric(p_user uuid, p_metric text)
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
    when 'appreciation' then
      public.received_appreciation(p_user)
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

create function public.badges_after_star()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.projects where id = new.project_id;
  if v_owner is not null then perform public.refresh_badges(v_owner, 'appreciation'); end if;
  return null;
end $$;

create trigger project_stars_badges
  after insert on public.project_stars
  for each row execute function public.badges_after_star();

create function public.badges_after_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.blog_posts where id = new.post_id;
  if v_author is not null then perform public.refresh_badges(v_author, 'appreciation'); end if;
  return null;
end $$;

create trigger blog_likes_badges
  after insert on public.blog_likes
  for each row execute function public.badges_after_like();

revoke execute on function public.badges_after_star() from public, anon, authenticated;
revoke execute on function public.badges_after_like() from public, anon, authenticated;

-- Catch up: count what members have already received
do $$
declare
  v_member uuid;
begin
  for v_member in select id from public.profiles loop
    perform public.refresh_badges(v_member, 'appreciation');
  end loop;
end $$;

commit;
