-- The chat inbox: one list of every community and project room I am in,
-- with the last message and how many messages I have not read yet.

create table public.channel_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_reads enable row level security;
create policy channel_reads_own on public.channel_reads
  for select to authenticated using (user_id = auth.uid());
-- Writing goes only through mark_channel_read below.
grant select on public.channel_reads to authenticated;
grant all on public.channel_reads to service_role;

-- "I have read this channel up to now." Only members can do it.
create function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select community_id into v_community from public.channels where id = p_channel;
  if v_community is null or not public.is_member(v_community) then
    raise exception 'not_a_member';
  end if;
  insert into public.channel_reads (user_id, channel_id, read_at)
  values (auth.uid(), p_channel, now())
  on conflict (user_id, channel_id) do update set read_at = excluded.read_at;
end
$$;

-- One row per community or project room I belong to.
-- A message counts as unread when someone else wrote it after I last read its channel
-- (or, if I never opened the channel, after the day I joined).
create function public.list_my_chat_inbox()
returns table (
  community_id uuid,
  slug text,
  name text,
  avatar_url text,
  project_id uuid,
  last_message_preview text,
  last_author_name text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.slug,
    c.name,
    c.avatar_url,
    c.project_id,
    left(l.body, 80),
    coalesce(nullif(btrim(p.display_name), ''), p.username),
    l.created_at,
    coalesce((
      select count(*)
        from public.messages m
        join public.channels ch on ch.id = m.channel_id and ch.kind <> 'forum'
        left join public.channel_reads r on r.channel_id = ch.id and r.user_id = auth.uid()
       where m.community_id = c.id
         and m.deleted_at is null
         and m.parent_id is null
         and m.author_id <> auth.uid()
         and m.created_at > coalesce(r.read_at, cm.joined_at)
    ), 0)
  from public.community_members cm
  join public.communities c on c.id = cm.community_id
  left join lateral (
    select m.body, m.created_at, m.author_id
      from public.messages m
      join public.channels ch on ch.id = m.channel_id and ch.kind <> 'forum'
     where m.community_id = c.id and m.deleted_at is null and m.parent_id is null
     order by m.id desc limit 1
  ) l on true
  left join public.profiles p on p.id = l.author_id
  where cm.user_id = auth.uid()
  order by l.created_at desc nulls last, c.name
$$;

revoke execute on function public.mark_channel_read(uuid) from public, anon;
revoke execute on function public.list_my_chat_inbox() from public, anon;
grant execute on function public.mark_channel_read(uuid) to authenticated;
grant execute on function public.list_my_chat_inbox() to authenticated;
