-- jaajef.tech - Full name and username chosen at sign-up
--
-- The sign-up form now asks for a full name and a username. Both travel as plain sign-up data
-- ("full_name" and "username"). They are only text: they never grant a GitHub link, an avatar or a
-- verified badge (those still come only from GitHub or Google). A username that is badly formed
-- falls back to the one built from the e-mail address, and a clash gets a numeric suffix, as before.
--
-- username_available lets the form tell the person before sending that a username is taken.
-- Usernames are already public (profile addresses), so this reveals nothing new.

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lower(btrim(p_username)) ~ '^[a-z0-9_]{3,24}$', false)
     and not exists (select 1 from public.profiles where username = lower(btrim(p_username)))
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := new.raw_app_meta_data ->> 'provider';
  v_trusted boolean := coalesce(v_provider, '') in ('github', 'google');
  v_base text;
  v_candidate text;
  v_name text;
  v_typed_name text;
  v_typed_user text;
  v_avatar text;
  v_github text;
  v_start bigint;
  n integer := 0;
begin
  v_github := case when v_provider = 'github' then new.raw_user_meta_data ->> 'user_name' end;

  -- What the person typed on the sign-up form (e-mail sign-ups only).
  v_typed_user := case when not v_trusted then lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', ''))) end;
  if v_typed_user is not null and v_typed_user !~ '^[a-z0-9_]{3,24}$' then v_typed_user := null; end if;
  v_typed_name := case when not v_trusted
                       then left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[[:cntrl:]]', ' ', 'g')), 60)
                  end;
  if v_typed_name is not null and char_length(v_typed_name) < 2 then v_typed_name := null; end if;

  v_base := lower(coalesce(v_github, v_typed_user, split_part(coalesce(new.email, ''), '@', 1), ''));
  v_base := left(regexp_replace(v_base, '[^a-z0-9_]', '_', 'g'), 24);
  if char_length(v_base) < 3 then
    v_base := left('membre_' || v_base, 24);
  end if;
  v_candidate := v_base;

  v_name := case when v_trusted
                 then coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
                 else v_typed_name
            end;
  v_avatar := case when v_trusted and (new.raw_user_meta_data ->> 'avatar_url') like 'https://%'
                   then new.raw_user_meta_data ->> 'avatar_url'
              end;

  loop
    begin
      insert into public.profiles (id, username, display_name, avatar_url, github_username)
      values (new.id, v_candidate, left(coalesce(nullif(v_name, ''), v_candidate), 60), v_avatar, v_github);
      exit;
    exception when unique_violation then
      n := n + 1;
      if n > 50 then
        raise exception 'could not find a free username for %', v_base;
      end if;
      v_candidate := left(v_base, 24) || '_' || n::text;
    end;
  end loop;

  insert into public.wallets (user_id) values (new.id);

  select (value #>> '{}')::bigint into v_start from public.game_config where key = 'start_kopeks';
  perform public.grant_reward(new.id, 0, coalesce(v_start, 0), 'welcome', 'welcome:' || new.id::text);

  return new;
end;
$$;
