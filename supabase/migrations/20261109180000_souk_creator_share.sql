-- jaajef.tech  -  Migration: Souk creator share
--
--   * When a member buys an item made by another member, the creator receives a share of the
--     price in Kopeks (default 70 percent, setting souk_creator_share_percent, to confirm with
--     Marie). The buyer pays the full price as before; the rest of the price simply leaves
--     circulation (a Kopek sink), so no Kopeks are created out of nothing.
--   * No share for a creator buying their own item, or for items with no creator.
--   * The share is rounded down and stored with each sale, so changing the setting later never
--     changes past sales.
--   * Creators see their sales (item, price, amount, date) but never who bought.
--   * The shop owner (or admin) sets the share and sees totals per creator.
--   * Payouts go through grant_reward (idempotent, appears in the Kopek history).
--
-- Requires: Souk, Souk submissions, back-office roles, notifications.

begin;

update public.game_config set value = '70'::jsonb, status = 'tbc',
       description = 'Percent of a Souk sale paid to the item creator (default 70, to confirm with Marie)'
 where key = 'souk_creator_share_percent';

create or replace function public.notification_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'project_starred', 'project_comment', 'project_confirmed', 'project_hidden',
    'collab_request', 'collab_accepted', 'collab_declined',
    'join_request', 'join_approved', 'join_declined',
    'badge_unlocked', 'warning', 'suspension',
    'new_application', 'application_seen', 'application_shortlisted', 'application_declined',
    'job_alert',
    'blog_comment', 'blog_like', 'blog_hidden', 'job_offer_hidden',
    'souk_submission_approved', 'souk_submission_rejected',
    'souk_sale'
  ]
$$;

-- One row per sale of a creator's item. Not readable directly (it holds the buyer):
-- creators and the shop owner read it through functions.
create table public.souk_sales (
  id bigint generated always as identity primary key,
  item_id uuid references public.souk_items (id) on delete set null,
  item_name text not null,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  buyer_id uuid references public.profiles (id) on delete set null,
  price bigint not null check (price >= 0),
  share_percent integer not null check (share_percent between 0 and 100),
  creator_amount bigint not null check (creator_amount >= 0 and creator_amount <= price),
  created_at timestamptz not null default now()
);
create index souk_sales_creator on public.souk_sales (creator_id, created_at desc);

-- ---------------------------------------------------------------------
-- Buying: same as before, plus the creator's share
-- ---------------------------------------------------------------------
create or replace function public.buy_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_item public.souk_items;
  v_balance bigint;
  v_percent integer;
  v_amount bigint;
begin
  if v_me is null then raise exception 'Sign in first'; end if;

  select * into v_item from public.souk_items where id = p_item;
  if not found or not v_item.is_active then raise exception 'This item is not for sale'; end if;

  -- Lock the buyer and the creator, always in the same order, so two members buying from each
  -- other at the same moment cannot block each other.
  perform 1 from public.profiles
   where id in (v_me, coalesce(v_item.creator_id, v_me))
   order by id for update;
  if not exists (select 1 from public.profiles where id = v_me) then raise exception 'Profile not found'; end if;

  -- Read the item again now that we hold the locks.
  select * into v_item from public.souk_items where id = p_item;
  if not found or not v_item.is_active then raise exception 'This item is not for sale'; end if;

  if exists (select 1 from public.member_items where user_id = v_me and item_id = p_item) then
    raise exception 'You already own this item';
  end if;

  select kopeks into v_balance from public.wallets where user_id = v_me;
  if coalesce(v_balance, 0) < v_item.price_kopeks then
    raise exception 'Not enough Kopeks';
  end if;

  perform public.grant_reward(
    v_me, 0, -v_item.price_kopeks, 'souk_purchase',
    'souk:' || v_me || ':' || p_item,
    'souk_item', p_item::text
  );

  insert into public.member_items (user_id, item_id, price_paid)
  values (v_me, p_item, v_item.price_kopeks);

  -- The creator's share
  if v_item.creator_id is not null and v_item.creator_id <> v_me and v_item.price_kopeks > 0 then
    v_percent := least(greatest(public.chat_setting('souk_creator_share_percent'), 0), 100);
    v_amount := (v_item.price_kopeks * v_percent) / 100;
    if v_amount > 0 then
      perform public.grant_reward(
        v_item.creator_id, 0, v_amount, 'souk_sale',
        'soukcut:' || v_me || ':' || p_item,
        'souk_item', p_item::text
      );
    end if;
    insert into public.souk_sales (item_id, item_name, creator_id, buyer_id, price, share_percent, creator_amount)
    values (p_item, v_item.name, v_item.creator_id, v_me, v_item.price_kopeks, v_percent, v_amount);
    perform public.notify(v_item.creator_id, 'souk_sale',
      jsonb_build_object('item_id', p_item, 'item_name', v_item.name, 'amount', v_amount),
      'soukcut:' || v_me || ':' || p_item);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------
create function public.my_creator_summary()
returns table (items_on_sale bigint, sales_count bigint, kopeks_earned bigint, share_percent integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query
  select (select count(*) from public.souk_items i where i.creator_id = v_me and i.is_active),
         (select count(*) from public.souk_sales s where s.creator_id = v_me),
         coalesce((select sum(s.creator_amount) from public.souk_sales s where s.creator_id = v_me), 0)::bigint,
         least(greatest(public.chat_setting('souk_creator_share_percent'), 0), 100);
end $$;

create function public.list_my_sales(p_limit integer default 50, p_offset integer default 0)
returns table (id bigint, item_id uuid, item_name text, price bigint, share_percent integer, amount bigint, sold_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return query
  select s.id, s.item_id, s.item_name, s.price, s.share_percent, s.creator_amount, s.created_at
    from public.souk_sales s
   where s.creator_id = v_me
   order by s.created_at desc, s.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------
-- Shop owner
-- ---------------------------------------------------------------------
create function public.set_creator_share(p_percent integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_old integer;
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception 'Only the shop owner can change the creator share'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'The share is a percentage from 0 to 100'; end if;
  v_old := public.chat_setting('souk_creator_share_percent');
  update public.game_config set value = to_jsonb(p_percent), status = 'defined'
   where key = 'souk_creator_share_percent';
  if v_old is distinct from p_percent then
    perform public.log_admin_action(auth.uid(), 'souk_creator_share_set', 'game_config', 'souk_creator_share_percent',
                                    jsonb_build_object('old', v_old, 'new', p_percent));
  end if;
end $$;

create function public.creator_earnings_overview(p_days integer default 30, p_limit integer default 50)
returns table (creator_id uuid, username text, sales_count bigint, gross_kopeks bigint, paid_kopeks bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception 'Only the shop owner can see the earnings'; end if;
  return query
  select s.creator_id, p.username, count(*), sum(s.price)::bigint, sum(s.creator_amount)::bigint
    from public.souk_sales s
    join public.profiles p on p.id = s.creator_id
   where s.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 3650))
   group by s.creator_id, p.username
   order by sum(s.creator_amount) desc, p.username
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.souk_sales enable row level security;
revoke all on public.souk_sales from public, anon, authenticated;

revoke execute on function public.my_creator_summary() from public, anon;
revoke execute on function public.list_my_sales(integer, integer) from public, anon;
revoke execute on function public.set_creator_share(integer) from public, anon;
revoke execute on function public.creator_earnings_overview(integer, integer) from public, anon;
grant execute on function public.my_creator_summary() to authenticated;
grant execute on function public.list_my_sales(integer, integer) to authenticated;
grant execute on function public.set_creator_share(integer) to authenticated;
grant execute on function public.creator_earnings_overview(integer, integer) to authenticated;

grant all on public.souk_sales to service_role;

commit;
