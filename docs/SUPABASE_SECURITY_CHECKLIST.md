# Supabase security checklist

Things to check in the Supabase dashboard before real people use the site. The code cannot do these for you: they are settings on your project. Tick each one and note the date.

Nothing here needs code. Never paste a secret key into chat, e-mail or the repository.

## Keys

- [ ] The site (Vercel) uses only the project URL and the anon key. The service-role key is not in Vercel, in the repository, or in any file of the app.
      Where: Settings, API.
- [ ] The service-role key is used only inside Edge Functions, as a secret.
      Where: Edge Functions, Secrets.
- [ ] If a secret was ever pasted somewhere public, rotate it now (Settings, API, then regenerate) and update the functions.

## Sign-in (Authentication)

- [ ] Site URL is the real address of the site (the Vercel address for now, the domain later).
      Where: Authentication, URL Configuration.
- [ ] Redirect URLs list only addresses you own (Vercel address, local address for testing). No wildcard for the whole internet.
- [ ] Confirm e-mail is on, so nobody signs up with an address that is not theirs.
      Where: Authentication, Providers, Email.
- [ ] Minimum password length is 8 or more.
      Where: Authentication, Policies (or Providers, Email).
- [ ] Leaked password protection is on, if your plan has it.
- [ ] Sign-in rate limits are left on their defaults or stricter.
      Where: Authentication, Rate Limits.
- [ ] Only the sign-in methods you use are on (turn off the others).
- [ ] A captcha is on for sign-up, once you are public (Authentication, Bot and Abuse Protection).

## Database

- [ ] Row Level Security is on for every table in the public schema. The Security Advisor shows no table without it.
      Where: Advisors, Security Advisor. Fix every red item.
- [ ] The Security Advisor shows nothing about "function search path mutable" or "security definer view". If it does, tell Claude: those are quick fixes.
- [ ] Nobody uses the database password outside the dashboard. Reset it if it was ever shared.
      Where: Settings, Database.
- [ ] Network restrictions: direct database access is limited to the addresses that need it, or off.
      Where: Settings, Database, Network Restrictions.
- [ ] Backups: daily backups are on (paid plans) and you know how to restore one.
      Where: Database, Backups.

## Storage

- [ ] Each bucket is public only on purpose (profile pictures, Souk previews). Buckets with private files (CV, application files) are private.
      Where: Storage.
- [ ] File size limits and allowed file types are set on each bucket.

## Edge Functions

- [ ] Every function is deployed from the repository (so what runs is what was reviewed).
- [ ] Functions that only the system should call (clean-up, purge, digests) are not callable by members. They check the secret `CRON_SECRET` before running. Set it before any schedule is created.
- [ ] The GitHub App private key and webhook secret are stored only as function secrets.

## Accounts and access

- [ ] Your Supabase account and GitHub account use two-step sign-in.
- [ ] Only people who need it are members of the Supabase organization, with the lowest role that works.
- [ ] Nobody else knows the owner login.

## Watching

- [ ] Logs are checked after launch: Logs, Auth and Edge Functions. Look for a burst of failed sign-ins or many requests from one place.
- [ ] A spending limit or usage alert is set, so a flood of requests cannot run up a bill.
      Where: Settings, Billing.

## Already done in the code

- Every table has Row Level Security and a test that fails if a table is added without it.
- Sensitive actions go through checked database functions, not direct writes.
- The code editor function limits requests per minute and per action, restricts what collaborators can write, and pins merges to the reviewed version.
- The code editor now comes from the site itself, not an outside server.
