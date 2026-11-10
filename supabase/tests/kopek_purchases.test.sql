-- Tests for buying Kopeks. Run AFTER all migrations. Person: kp (1).

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('e7a8b9c0-0000-0000-0000-000000000001', 'kp@exemple.sn', '{"provider":"email"}', '{}');

do $$
declare
  u uuid := 'e7a8b9c0-0000-0000-0000-000000000001';
  p uuid; p1 uuid; amt integer; r text; before bigint; after bigint; n integer;
begin
  select kopeks into before from public.wallets where user_id = u;

  -- 1. a pack from the list, price worked out by the server
  select purchase_id, amount_cfa into p, amt from public.create_kopek_purchase(u, 500, 'wave');
  if amt <> 5000 then raise exception 'FAIL 1: 500 Kopeks should cost 5000, got %', amt; end if;
  raise notice 'OK 1: the price comes from the server';

  -- 2. unknown pack or method refused
  begin perform public.create_kopek_purchase(u, 7, 'wave'); raise exception 'FAIL 2a: odd pack accepted';
  exception when others then if sqlerrm not like 'unknown pack%' then raise; end if; end;
  begin perform public.create_kopek_purchase(u, 100, 'cheque'); raise exception 'FAIL 2b: odd method accepted';
  exception when others then if sqlerrm not like 'unknown method%' then raise; end if; end;
  raise notice 'OK 2: only listed packs and methods';

  p1 := p;
  perform public.set_kopek_purchase_token(p, 'test_tok_1');

  -- 3. pending and unknown change nothing
  if public.complete_kopek_purchase('test_tok_1', 'pending', null) <> 'pending' then raise exception 'FAIL 3a'; end if;
  if public.complete_kopek_purchase('nope', 'completed', 5000) <> 'unknown' then raise exception 'FAIL 3b'; end if;
  select kopeks into after from public.wallets where user_id = u;
  if after <> before then raise exception 'FAIL 3c: balance moved'; end if;
  raise notice 'OK 3: pending and unknown tokens credit nothing';

  -- 4. wrong amount is refused and credits nothing
  select purchase_id into p from public.create_kopek_purchase(u, 100, 'card');
  perform public.set_kopek_purchase_token(p, 'test_tok_2');
  if public.complete_kopek_purchase('test_tok_2', 'completed', 999) <> 'amount_mismatch' then raise exception 'FAIL 4a'; end if;
  select kopeks into after from public.wallets where user_id = u;
  if after <> before then raise exception 'FAIL 4b: balance moved on a wrong amount'; end if;
  raise notice 'OK 4: a wrong amount credits nothing';

  -- 5. a real success credits once, even if reported twice
  if public.complete_kopek_purchase('test_tok_1', 'completed', 5000) <> 'credited' then raise exception 'FAIL 5a'; end if;
  if public.complete_kopek_purchase('test_tok_1', 'completed', 5000) <> 'already' then raise exception 'FAIL 5b'; end if;
  select kopeks into after from public.wallets where user_id = u;
  if after <> before + 500 then raise exception 'FAIL 5c: expected +500, got %', after - before; end if;
  select count(*) into n from public.kopek_transactions where idempotency_key = 'purchase:' || p1::text;
  if n <> 1 then raise exception 'FAIL 5d: expected one ledger line, got %', n; end if;
  raise notice 'OK 5: credited once';

  -- 6. cancelled marks the purchase
  select purchase_id into p from public.create_kopek_purchase(u, 1000, 'orange');
  perform public.set_kopek_purchase_token(p, 'test_tok_3');
  if public.complete_kopek_purchase('test_tok_3', 'cancelled', null) <> 'cancelled' then raise exception 'FAIL 6'; end if;
  raise notice 'OK 6: cancelled';
end $$;

-- 7. members cannot call the server functions or write purchases, and see only their own
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'e7a8b9c0-0000-0000-0000-000000000001', true);
  begin perform public.complete_kopek_purchase('test_tok_3', 'completed', 10000); raise exception 'FAIL 7a: member ran a server function';
  exception when insufficient_privilege then null; end;
  begin insert into public.kopek_purchases (user_id, kopeks, amount_cfa, method) values ('e7a8b9c0-0000-0000-0000-000000000001', 1, 1, 'wave'); raise exception 'FAIL 7b: member wrote a purchase';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.kopek_purchases) < 1 then raise exception 'FAIL 7c: member cannot read own purchases'; end if;
  reset role;
  raise notice 'OK 7: members can only read their own purchases';
end $$;

delete from auth.users where id = 'e7a8b9c0-0000-0000-0000-000000000001';
