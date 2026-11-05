-- jaajef.tech  -  Migration: the Souk (shop)
--
--   * Items of three kinds: theme, avatar frame, status badge.
--   * A member buys an item with Kopeks and owns it for good.
--   * A member wears one item per kind. What they wear is public;
--     what they own is private.
--   * Only the server adds or changes items (creator submissions and the
--     creator share come in a later piece).
--   * Buying goes through grant_reward, so it is safe against double clicks,
--     can never overspend, and appears in the Kopek history.

create type public.souk_item_kind as enum ('theme', 'avatar_frame', 'status_badge');

create table public.souk_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  kind public.souk_item_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 300),
  price_kopeks bigint not null check (price_kopeks between 0 and 1000000),
  -- The look of the item (colours, image address...). The app decides what it contains.
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  -- Listed in the shop. An item taken off sale stays with the people who own it.
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index souk_items_shop_idx on public.souk_items (kind, price_kopeks) where is_active;

create table public.member_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.souk_items (id) on delete restrict,
  price_paid bigint not null check (price_paid >= 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- One row per member and kind = one worn item per kind.
create table public.equipped_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.souk_item_kind not null,
  item_id uuid not null,
  equipped_at timestamptz not null default now(),
  primary key (user_id, kind),
  -- Only an item the member owns can be worn.
  foreign key (user_id, item_id) references public.member_items (user_id, item_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Buy an item
-- ---------------------------------------------------------------------
create function public.buy_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_item public.souk_items;
  v_balance bigint;
begin
  if v_me is null then raise exception 'Sign in first'; end if;

  -- Lock the member so two purchases cannot run at the same time.
  perform 1 from public.profiles where id = v_me for update;
  if not found then raise exception 'Profile not found'; end if;

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
end;
$$;

-- ---------------------------------------------------------------------
-- Wear / stop wearing an item
-- ---------------------------------------------------------------------
create function public.equip_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_kind public.souk_item_kind;
begin
  if v_me is null then raise exception 'Sign in first'; end if;

  select i.kind into v_kind
    from public.member_items m
    join public.souk_items i on i.id = m.item_id
   where m.user_id = v_me and m.item_id = p_item;
  if not found then raise exception 'You do not own this item'; end if;

  insert into public.equipped_items (user_id, kind, item_id)
  values (v_me, v_kind, p_item)
  on conflict (user_id, kind)
  do update set item_id = excluded.item_id, equipped_at = now();
end;
$$;

create function public.unequip_item(p_kind public.souk_item_kind)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.equipped_items where user_id = auth.uid() and kind = p_kind;
end;
$$;

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
alter table public.souk_items enable row level security;
alter table public.member_items enable row level security;
alter table public.equipped_items enable row level security;

revoke all on public.souk_items, public.member_items, public.equipped_items from anon, authenticated;

-- The shop and what people wear are visible to everyone, even visitors.
grant select on public.souk_items, public.equipped_items to anon, authenticated;
create policy "the shop is public" on public.souk_items for select to anon, authenticated using (true);
create policy "worn items are public" on public.equipped_items for select to anon, authenticated using (true);

-- What you own is private.
grant select on public.member_items to authenticated;
create policy "own items" on public.member_items for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function public.buy_item(uuid) from public, anon;
revoke execute on function public.equip_item(uuid) from public, anon;
revoke execute on function public.unequip_item(public.souk_item_kind) from public, anon;
grant execute on function public.buy_item(uuid) to authenticated;
grant execute on function public.equip_item(uuid) to authenticated;
grant execute on function public.unequip_item(public.souk_item_kind) to authenticated;

grant all on public.souk_items, public.member_items, public.equipped_items to service_role;

-- ---------------------------------------------------------------------
-- Placeholder items so the screens have something to show.
-- Names, prices and looks are to be replaced with Marie's designs.
-- ---------------------------------------------------------------------
insert into public.souk_items (slug, kind, name, description, price_kopeks, data) values
  ('exemple-theme-sable', 'theme', 'Sable (exemple)', 'Placeholder theme', 150, '{"accent":"#C9A227"}'),
  ('exemple-theme-baobab', 'theme', 'Baobab (exemple)', 'Placeholder theme', 300, '{"accent":"#2E7D32"}'),
  ('exemple-cadre-or', 'avatar_frame', 'Cadre or (exemple)', 'Placeholder frame', 200, '{"color":"#FFD700"}'),
  ('exemple-cadre-feu', 'avatar_frame', 'Cadre feu (exemple)', 'Placeholder frame', 400, '{"color":"#E64A19"}'),
  ('exemple-statut-nouveau', 'status_badge', 'Nouveau talent (exemple)', 'Placeholder status', 0, '{"label":"Nouveau talent"}'),
  ('exemple-statut-mentor', 'status_badge', 'Mentor (exemple)', 'Placeholder status', 250, '{"label":"Mentor"}');
