-- Minimal stand-in for what Supabase provides, so the migration can be tested
-- on a plain PostgreSQL. NOT needed (and must not be run) on a real Supabase
-- project, which already has the auth schema and these roles.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth   to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
