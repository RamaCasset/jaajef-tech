# File cleanup: setup guide (plain language)

A small program that deletes CV files and Souk images nothing uses any more.
It runs once a day. It reuses the same password (CRON_SECRET) as the GitHub checker,
so do the GitHub checker setup first (`docs/GITHUB_CHECKER_SETUP.md`).

You do this once.

## What you need first
- All the migration files have been run, including the file cleanup one.
- The GitHub checker is already set up (the password exists in Supabase).
- The `file-cleanup` folder from this repository, under `supabase/functions`.

## Step 1. Deploy the program
Deploy the `file-cleanup` function the same way you deployed `github-sync`
(same steps as Step 4 of the GitHub checker guide, with the name `file-cleanup`).
No new secret is needed: it uses the same CRON_SECRET.

## Step 2. Turn on the daily schedule
1. Open the file `schedule.sql.example` in the `file-cleanup` folder.
2. If you already ran the GitHub checker's schedule file, remove the two lines that
   start with `select vault.create_secret` (the secrets already exist).
   Otherwise replace the two placeholders in capital letters.
3. Paste it in the Supabase SQL Editor and run it once. Never save the filled-in
   version in the repository.

## Checking it works
In the SQL Editor, run the two lines at the bottom of the schedule file to see the last runs.
A first manual run: send a POST request to the function with the header `x-cron-secret`.
The answer is a short summary: how many files were found and deleted.

## Good to know
- A file must be older than 24 hours before it can be deleted.
- Private message files are never deleted by this program.
