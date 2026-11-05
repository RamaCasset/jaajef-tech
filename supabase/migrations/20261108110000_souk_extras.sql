-- jaajef.tech  -  Migration: Souk ratings and the theme of the week
--
--   * A member who owns an item can rate it from 1 to 5 stars, change the
--     rating later, or take it back. Only owners can rate. Each item shows
--     its average and the number of ratings; who rated what stays private.
--   * An admin can pick one item to feature for a week (weeks start on Monday,
--     UTC). If nothing is picked, the shop features the most recently added
--     item on sale. Picking and clearing are logged.
--   * souk_shop() lists the shop with ratings, ownership and sorting.
--
-- No Kopeks move in this piece and no prices change.
--
-- Requires: the Souk migration, staff roles.

begin;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.souk_ratings (
  item_id uuid not null,
  user_id uuid not null,
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id),
  -- Only an owner can rate; losing ownership (account deleted) removes the rating.
  foreign key (user_id, item_id) references public.member_items (user_id, item_id) on delete cascade
);
create index souk_ratings_user on public.souk_ratings (user_id);

-- Counts for the shop cards. An item with no row here has no ratings.
create table public.souk_item_stats (
  item_id uuid primary key references public.souk_items (id) on delete cascade,
  rating_count integer not null default 0 check (rating_count >= 0),
  rating_sum integer not null default 0 check (rating_sum >= 0)
);

create table public.souk_featured (
  week_start date primary key check (week_start = date_trunc('week', week_start)::date),
  item_id uuid not null references public.souk_items (id) on delete cascade,
  set_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Keep the counts in step with the ratings
-- ---------------------------------------------------------------------
create function public.count_souk_ratings() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.souk_item_stats (item_id, rating_count, rating_sum) values (new.item_id, 1, new.stars)
    on conflict (item_id) do update
      set rating_count = public.souk_item_stats.rating_count + 1,
          rating_sum = public.souk_item_stats.rating_sum + new.stars;
  elsif tg_op = 'UPDATE' then
    update public.souk_item_stats set rating_sum = rating_sum + new.stars - old.stars where item_id = new.item_id;
  else
    update public.souk_item_stats
       set rating_count = greatest(rating_count - 1, 0), rating_sum = greatest(rating_sum - old.stars, 0)
     where item_id = old.item_id;
  end if;
  return null;
end $$;

create trigger souk_ratings_count after insert or update of stars or delete on public.souk_ratings
  for each row execute function public.count_souk_ratings();

-- ---------------------------------------------------------------------
-- Members: rate an item
-- ---------------------------------------------------------------------
create function public.rate_item(p_item uuid, p_stars integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Choose 1 to 5 stars'; end if;
  if not exists (select 1 from public.member_items where user_id = v_me and item_id = p_item) then
    raise exception 'You can only rate items you own';
  end if;

  insert into public.souk_ratings (item_id, user_id, stars) values (p_item, v_me, p_stars)
  on conflict (item_id, user_id) do update set stars = excluded.stars, updated_at = now();
end $$;

create function public.remove_rating(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.souk_ratings where item_id = p_item and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Admins: theme of the week
-- ---------------------------------------------------------------------
create function public.set_featured_item(p_item uuid, p_day date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
  v_previous uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can choose the featured item'; end if;
  if p_day is null then p_day := current_date; end if;
  v_week := date_trunc('week', p_day)::date;
  if v_week < date_trunc('week', current_date)::date then raise exception 'Choose this week or a later one'; end if;
  if p_day > current_date + 365 then raise exception 'Choose a day within the next year'; end if;
  if not exists (select 1 from public.souk_items where id = p_item and is_active) then
    raise exception 'Item not found or not for sale';
  end if;

  select item_id into v_previous from public.souk_featured where week_start = v_week;
  if v_previous is not distinct from p_item then return; end if;

  insert into public.souk_featured (week_start, item_id, set_by) values (v_week, p_item, auth.uid())
  on conflict (week_start) do update set item_id = excluded.item_id, set_by = excluded.set_by, created_at = now();

  perform public.log_admin_action(auth.uid(), 'souk_featured_set', 'souk_item', p_item::text,
                                  jsonb_build_object('week', v_week, 'previous', v_previous));
end $$;

create function public.clear_featured_item(p_day date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
  v_item uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can change the featured item'; end if;
  if p_day is null then p_day := current_date; end if;
  v_week := date_trunc('week', p_day)::date;
  if v_week < date_trunc('week', current_date)::date then raise exception 'Choose this week or a later one'; end if;

  delete from public.souk_featured where week_start = v_week returning item_id into v_item;
  if found then
    perform public.log_admin_action(auth.uid(), 'souk_featured_cleared', 'souk_item', v_item::text,
                                    jsonb_build_object('week', v_week));
  end if;
end $$;

-- Staff: the coming weeks. Weeks with nothing chosen show the automatic pick.
create function public.list_featured_schedule(p_weeks integer default 8)
returns table (week_start date, item_id uuid, slug text, name text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.staff_role() is null then raise exception 'Only staff can see the schedule'; end if;
  return query
  select w::date, i.id, i.slug, i.name,
         case when f.item_id is not null then 'chosen' else 'automatic' end
    from generate_series(date_trunc('week', current_date)::date,
                         date_trunc('week', current_date)::date + (least(greatest(coalesce(p_weeks, 8), 1), 52) - 1) * 7,
                         interval '7 days') w
    left join public.souk_featured f on f.week_start = w::date
    left join public.souk_items i on i.id = coalesce(
           (select f2.item_id from public.souk_featured f2
              join public.souk_items a on a.id = f2.item_id and a.is_active
             where f2.week_start = w::date),
           (select a.id from public.souk_items a where a.is_active order by a.created_at desc, a.id limit 1))
   order by w;
end $$;

-- ---------------------------------------------------------------------
-- Everyone: the featured item and the shop
-- ---------------------------------------------------------------------
create function public.featured_item()
returns table (
  item_id uuid, slug text, kind public.souk_item_kind, name text, description text,
  price_kopeks bigint, data jsonb, source text, week_start date,
  avg_rating numeric, rating_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_week date := date_trunc('week', current_date)::date;
  v_id uuid;
  v_source text := 'chosen';
begin
  select f.item_id into v_id
    from public.souk_featured f
    join public.souk_items i on i.id = f.item_id and i.is_active
   where f.week_start = v_week;
  if v_id is null then
    v_source := 'automatic';
    select i.id into v_id from public.souk_items i where i.is_active order by i.created_at desc, i.id limit 1;
  end if;
  if v_id is null then return; end if;

  return query
  select i.id, i.slug, i.kind, i.name, i.description, i.price_kopeks, i.data, v_source, v_week,
         case when coalesce(s.rating_count, 0) = 0 then null else round(s.rating_sum::numeric / s.rating_count, 2) end,
         coalesce(s.rating_count, 0)
    from public.souk_items i
    left join public.souk_item_stats s on s.item_id = i.id
   where i.id = v_id;
end $$;

create function public.souk_shop(
  p_kind public.souk_item_kind default null, p_sort text default 'new',
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, slug text, kind public.souk_item_kind, name text, description text,
  price_kopeks bigint, data jsonb, avg_rating numeric, rating_count integer,
  owned boolean, my_rating integer, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_sort text := coalesce(p_sort, 'new');
begin
  if v_sort not in ('new', 'price_asc', 'price_desc', 'rating') then raise exception 'Unknown sort'; end if;
  return query
  select i.id, i.slug, i.kind, i.name, i.description, i.price_kopeks, i.data,
         case when coalesce(s.rating_count, 0) = 0 then null else round(s.rating_sum::numeric / s.rating_count, 2) end,
         coalesce(s.rating_count, 0),
         exists (select 1 from public.member_items m where m.item_id = i.id and m.user_id = auth.uid()),
         (select r.stars from public.souk_ratings r where r.item_id = i.id and r.user_id = auth.uid()),
         i.created_at
    from public.souk_items i
    left join public.souk_item_stats s on s.item_id = i.id
   where i.is_active and (p_kind is null or i.kind = p_kind)
   order by
     case when v_sort = 'price_asc' then i.price_kopeks end asc,
     case when v_sort = 'price_desc' then i.price_kopeks end desc,
     case when v_sort = 'rating' then case when coalesce(s.rating_count, 0) = 0 then null else s.rating_sum::numeric / s.rating_count end end desc nulls last,
     case when v_sort = 'rating' then coalesce(s.rating_count, 0) end desc,
     case when v_sort = 'new' then i.created_at end desc,
     i.name, i.id
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.souk_ratings enable row level security;
alter table public.souk_item_stats enable row level security;
alter table public.souk_featured enable row level security;

revoke all on public.souk_ratings, public.souk_item_stats, public.souk_featured from public, anon, authenticated;

-- Public: the counts and the featured choices. Private: who rated what.
grant select on public.souk_item_stats, public.souk_featured to anon, authenticated;
create policy "ratings counts are public" on public.souk_item_stats for select to anon, authenticated using (true);
create policy "featured items are public" on public.souk_featured for select to anon, authenticated using (true);
grant select on public.souk_ratings to authenticated;
create policy "own ratings" on public.souk_ratings for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function public.count_souk_ratings() from public, anon, authenticated;
revoke execute on function public.rate_item(uuid, integer) from public, anon;
revoke execute on function public.remove_rating(uuid) from public, anon;
revoke execute on function public.set_featured_item(uuid, date) from public, anon;
revoke execute on function public.clear_featured_item(date) from public, anon;
revoke execute on function public.list_featured_schedule(integer) from public, anon;
revoke execute on function public.featured_item() from public;
revoke execute on function public.souk_shop(public.souk_item_kind, text, integer, integer) from public;

grant execute on function public.rate_item(uuid, integer) to authenticated;
grant execute on function public.remove_rating(uuid) to authenticated;
grant execute on function public.set_featured_item(uuid, date) to authenticated;
grant execute on function public.clear_featured_item(date) to authenticated;
grant execute on function public.list_featured_schedule(integer) to authenticated;
grant execute on function public.featured_item() to anon, authenticated;
grant execute on function public.souk_shop(public.souk_item_kind, text, integer, integer) to anon, authenticated;

grant all on public.souk_ratings, public.souk_item_stats, public.souk_featured to service_role;

commit;
