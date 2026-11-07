# Account deletion: setup guide

## How it works for a member
1. The member asks to delete their account. Nothing is deleted yet.
2. They have 14 days to change their mind (they can cancel at any time).
3. After 14 days, a daily job deletes their login, profile, messages, projects, files and everything linked to them.
   Only an anonymous line stays in a log (a scrambled fingerprint and the date), to prove the deletion happened.
4. A member can also download a copy of their own data at any time.

A member cannot ask for deletion while one of these is true: they are staff, they are suspended, they own a community
that still has other members, or they have published job offers or open applications to handle. The app tells them which.

## What you do (once, when going online)
1. In the Supabase SQL Editor, run the file for this feature (the "account deletion export" migration).
2. Create an Edge Function and paste the contents of `supabase/functions/account-purge/index.ts`.
   Turn "Verify JWT" OFF (the function checks its own password).
3. The secret `CRON_SECRET` is the same one as for the other functions. Nothing else to add.
4. Test it by hand: call the function with the header `x-cron-secret`. With nobody due, it answers
   `{"due":0,"deleted":0,"kept":0,"failed":0,"stopped":null}`.
5. Turn on the daily schedule with `supabase/functions/account-purge/schedule.sql.example`.

## Assumptions to confirm with Marie
- The waiting time is 14 days (setting `account_deletion_days`).
- Messages a member sent and projects they published are deleted with the account (not kept anonymously).
- A community owner with other members must hand over or close the community first. There is no transfer feature yet.
