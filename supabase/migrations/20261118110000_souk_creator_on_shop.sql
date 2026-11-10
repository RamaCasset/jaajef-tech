-- The Souk shop list also tells who made each item (name and clan), so the cards can show the creator.

drop function public.souk_shop(public.souk_item_kind, text, integer, integer);

create function public.souk_shop(
  p_kind public.souk_item_kind default null, p_sort text default 'new',
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, slug text, kind public.souk_item_kind, name text, description text,
  price_kopeks bigint, data jsonb, avg_rating numeric, rating_count integer,
  owned boolean, my_rating integer, created_at timestamptz,
  creator_name text, creator_clan public.clan_type
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
         i.created_at,
         cp.display_name, cp.clan
    from public.souk_items i
    left join public.profiles cp on cp.id = i.creator_id
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

revoke execute on function public.souk_shop(public.souk_item_kind, text, integer, integer) from public;
grant execute on function public.souk_shop(public.souk_item_kind, text, integer, integer) to anon, authenticated;
