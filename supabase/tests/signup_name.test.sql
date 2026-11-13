-- Tests for the full name and username typed at sign-up. Run AFTER all migrations.
-- Everything created here is deleted at the end.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('5e5e5e5e-0000-0000-0000-000000000001', 'sn1@exemple.sn', '{"provider":"email"}', '{"full_name":"Awa Diallo","username":"awa_dev"}'),
  ('5e5e5e5e-0000-0000-0000-000000000002', 'sn2@exemple.sn', '{"provider":"email"}', '{"full_name":"Autre Awa","username":"AWA_DEV"}'),
  ('5e5e5e5e-0000-0000-0000-000000000003', 'sn3@exemple.sn', '{"provider":"email"}', '{"full_name":"x","username":"a b!"}'),
  ('5e5e5e5e-0000-0000-0000-000000000004', 'sn4@exemple.sn', '{"provider":"email"}', '{"user_name":"fake-gh","username":"vrai_nom","avatar_url":"https://evil.example/x.png"}');

do $$
declare p record; ok boolean;
begin
  select * into p from public.profiles where id = '5e5e5e5e-0000-0000-0000-000000000001';
  if p.username <> 'awa_dev' then raise exception 'FAIL chosen username: %', p.username; end if;
  if p.display_name <> 'Awa Diallo' then raise exception 'FAIL chosen name: %', p.display_name; end if;

  select * into p from public.profiles where id = '5e5e5e5e-0000-0000-0000-000000000002';
  if p.username <> 'awa_dev_1' then raise exception 'FAIL clash suffix: %', p.username; end if;

  select * into p from public.profiles where id = '5e5e5e5e-0000-0000-0000-000000000003';
  if p.username <> 'sn3' then raise exception 'FAIL bad username falls back: %', p.username; end if;
  if p.display_name <> 'sn3' then raise exception 'FAIL too-short name falls back: %', p.display_name; end if;

  select * into p from public.profiles where id = '5e5e5e5e-0000-0000-0000-000000000004';
  if p.github_username is not null or p.avatar_url is not null then raise exception 'FAIL sign-up data granted a GitHub link or avatar'; end if;
  if p.username <> 'vrai_nom' then raise exception 'FAIL username with spoof data: %', p.username; end if;

  if public.username_available('awa_dev') then raise exception 'FAIL taken username shown as free'; end if;
  if public.username_available('Awa_Dev ') then raise exception 'FAIL taken username (case, space) shown as free'; end if;
  if public.username_available('ab') then raise exception 'FAIL too-short username shown as free'; end if;
  if public.username_available('a b c') then raise exception 'FAIL badly formed username shown as free'; end if;
  if not public.username_available('libre_et_valide') then raise exception 'FAIL free username shown as taken'; end if;
  raise notice 'OK: sign-up name and username';
end $$;

delete from auth.users where id::text like '5e5e5e5e-0000-0000-0000-%';
