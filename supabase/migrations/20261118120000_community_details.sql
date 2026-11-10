-- Community details for the discovery page: a topic, a few tags, and a short "right now" line.

alter table public.communities
  add column topic text check (topic in ('web', 'ia_data', 'gaming', 'design', 'mobile', 'open_source')),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 4),
  add column activity text check (char_length(activity) <= 80);

-- The owner or a moderator sets the details. Anything not passed stays as it is; an empty text clears it.
create function public.set_community_details(
  p_community uuid,
  p_topic text default null,
  p_tags text[] default null,
  p_activity text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[];
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if public.member_role(p_community) not in ('owner', 'moderator') then
    raise exception 'Only the owner or a moderator can change this';
  end if;
  if p_topic is not null and p_topic <> '' and p_topic not in ('web', 'ia_data', 'gaming', 'design', 'mobile', 'open_source') then
    raise exception 'Unknown topic';
  end if;
  if p_tags is not null then
    select coalesce(array_agg(t), '{}') into v_tags
      from (select distinct btrim(x) as t from unnest(p_tags) as x where btrim(x) <> '') s;
    if cardinality(v_tags) > 4 then raise exception 'At most 4 tags'; end if;
    if exists (select 1 from unnest(v_tags) t where char_length(t) > 20) then raise exception 'A tag is too long'; end if;
  end if;
  if p_activity is not null and char_length(btrim(p_activity)) > 80 then raise exception 'The line is too long'; end if;

  update public.communities
     set topic = case when p_topic is null then topic when p_topic = '' then null else p_topic end,
         tags = coalesce(v_tags, tags),
         activity = case when p_activity is null then activity when btrim(p_activity) = '' then null else btrim(p_activity) end
   where id = p_community;
end $$;

revoke execute on function public.set_community_details(uuid, text, text[], text) from public, anon;
grant execute on function public.set_community_details(uuid, text, text[], text) to authenticated;
