-- Buying Kopeks with real money (PayDunya).
-- One row per purchase attempt. A purchase is created before the member is sent to the payment page,
-- and Kopeks are credited only when the payment is confirmed by PayDunya, once, whatever happens.
-- Everything below the table is for the server (the kopeks-payment Edge Function), never for members.

create table public.kopek_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kopeks bigint not null check (kopeks > 0),
  amount_cfa integer not null check (amount_cfa > 0),
  method text not null check (method in ('wave', 'orange', 'card')),
  provider_token text unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index kopek_purchases_user_idx on public.kopek_purchases (user_id, created_at desc);

alter table public.kopek_purchases enable row level security;
create policy kopek_purchases_own on public.kopek_purchases
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.kopek_purchases to authenticated;
grant all on public.kopek_purchases to service_role;

insert into public.game_config (key, value, status, description) values
  ('kopek_packs', '[100, 500, 1000]', 'defined', 'Kopek packs that can be bought (from the Buy Kopeks screen)'),
  ('kopek_cfa_per_kopek', '10', 'defined', 'Price of one Kopek in CFA francs (from the Buy Kopeks screen)')
on conflict (key) do nothing;

-- Start a purchase. Only the packs in game_config are allowed; the price is worked out here, never taken from the browser.
create function public.create_kopek_purchase(p_user uuid, p_kopeks bigint, p_method text)
returns table (purchase_id uuid, amount_cfa integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packs jsonb;
  v_rate integer;
  v_id uuid;
  v_amount integer;
begin
  select value into v_packs from public.game_config where key = 'kopek_packs';
  select (value #>> '{}')::integer into v_rate from public.game_config where key = 'kopek_cfa_per_kopek';
  if v_packs is null or v_rate is null or not (v_packs @> to_jsonb(p_kopeks)) then
    raise exception 'unknown pack';
  end if;
  if p_method not in ('wave', 'orange', 'card') then
    raise exception 'unknown method';
  end if;
  perform 1 from public.profiles where id = p_user;
  if not found then raise exception 'unknown user'; end if;
  v_amount := (p_kopeks * v_rate)::integer;
  insert into public.kopek_purchases (user_id, kopeks, amount_cfa, method)
  values (p_user, p_kopeks, v_amount, p_method)
  returning id into v_id;
  return query select v_id, v_amount;
end;
$$;

create function public.set_kopek_purchase_token(p_purchase uuid, p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.kopek_purchases set provider_token = p_token where id = p_purchase and status = 'pending'
$$;

-- Record the outcome PayDunya reported. Credits the Kopeks once, and only if the amount paid is the amount asked.
-- Returns: credited, already, pending, failed, cancelled, amount_mismatch, unknown.
create function public.complete_kopek_purchase(p_token text, p_status text, p_paid_cfa integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.kopek_purchases;
begin
  select * into v from public.kopek_purchases where provider_token = p_token for update;
  if not found then return 'unknown'; end if;
  if v.status = 'completed' then return 'already'; end if;

  if p_status = 'completed' then
    if p_paid_cfa is distinct from v.amount_cfa then
      update public.kopek_purchases set status = 'failed' where id = v.id;
      return 'amount_mismatch';
    end if;
    perform public.grant_reward(v.user_id, 0, v.kopeks, 'purchase', 'purchase:' || v.id::text, 'kopek_purchase', v.id::text);
    update public.kopek_purchases set status = 'completed', completed_at = now() where id = v.id;
    return 'credited';
  elsif p_status in ('failed', 'cancelled') then
    update public.kopek_purchases set status = p_status where id = v.id and status = 'pending';
    return p_status;
  end if;
  return 'pending';
end;
$$;

revoke execute on function public.create_kopek_purchase(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public.set_kopek_purchase_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.complete_kopek_purchase(text, text, integer) from public, anon, authenticated;
grant execute on function public.create_kopek_purchase(uuid, bigint, text) to service_role;
grant execute on function public.set_kopek_purchase_token(uuid, text) to service_role;
grant execute on function public.complete_kopek_purchase(text, text, integer) to service_role;
