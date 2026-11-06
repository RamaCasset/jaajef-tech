-- jaajef.tech - Connect a GitHub account to an existing member
--
-- A member who signed up with an e-mail address has no GitHub name, so cannot list a project.
-- In the app they press "Connect GitHub"; Supabase then attaches a verified GitHub identity to their login.
-- This function copies the GitHub name from that verified identity onto the profile.
-- The name is never taken from anything the member types.

create function public.link_github_account()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
begin
  if v_me is null then raise exception 'You must be signed in'; end if;

  select coalesce(identity_data ->> 'user_name', identity_data ->> 'preferred_username')
    into v_name
    from auth.identities
   where user_id = v_me and provider = 'github'
   limit 1;

  if v_name is null then
    raise exception 'No GitHub account is connected to your login';
  end if;
  if v_name !~ '^[A-Za-z0-9-]{1,39}$' then
    raise exception 'This GitHub name cannot be used';
  end if;
  if exists (select 1 from public.profiles where lower(github_username) = lower(v_name) and id <> v_me) then
    raise exception 'This GitHub account is already linked to another member';
  end if;

  update public.profiles set github_username = v_name where id = v_me;
  return v_name;
end $$;

revoke execute on function public.link_github_account() from public, anon;
grant execute on function public.link_github_account() to authenticated;
