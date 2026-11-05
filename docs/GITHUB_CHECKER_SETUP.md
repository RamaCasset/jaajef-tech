# GitHub checker: setup guide (plain language)

The GitHub checker is a small program that confirms imported projects against
GitHub, so they can go public. It lives in Supabase and runs by itself every hour.

You do this once. Take it one step at a time, and never paste a secret into a
chat, an email or the GitHub repository.

## What you need first
- The project database is set up (all the migration files have been run).
- The `github-sync` folder from this repository, under `supabase/functions`.

## Step 1. Make a GitHub access token (recommended)
Without a token GitHub allows about 60 checks an hour. With one it allows 5000.

1. On GitHub, open your profile picture menu, then Settings.
2. At the bottom of the left menu, open Developer settings.
3. Open Personal access tokens, then Fine-grained tokens, then Generate new token.
4. Name it `jaajef-checker`. Pick an expiry date.
5. Under Repository access, choose Public repositories (read-only). Add no
   permissions. The token must not be able to see private repositories.
6. Generate it and copy it. GitHub shows it only once.

## Step 2. Invent the checker's password
Make up a long random text of at least 20 characters (a password manager can
generate one). This is the CRON_SECRET. Only the scheduler and the checker will
know it. Keep it in your password manager.

## Step 3. Save both as secrets in Supabase
1. In the Supabase dashboard, open your project, then Edge Functions, then Secrets.
2. Add a secret named `CRON_SECRET` with your made-up password as the value.
3. Add a secret named `GITHUB_TOKEN` with the GitHub token as the value.
4. Click Save.

## Step 4. Create the function
1. Edge Functions, then Deploy a new function, then Via Editor.
2. Name it exactly `github-sync`.
3. Replace everything in the editor with the contents of `index.ts` from the
   `supabase/functions/github-sync` folder in the repository.
4. Click Deploy function and wait for it to finish.
5. In the function's settings, switch off JWT verification. The checker has its
   own password check, and the scheduler does not send a user login. (If you
   cannot find this switch, stop here: we will find it together on screen.)

## Step 5. Try it once by hand
1. Open the function, then Test.
2. Method POST. Add a header named `x-cron-secret` with your password.
3. Send the request.

You should see an answer like `{"checked":0,"verified":0,"hidden":0,"skipped":0,"stopped":null}`.
Zeros are normal when no project is waiting to be checked.

Also try a wrong password: the answer must be "not allowed".

## Step 6. See it really work (optional, takes two minutes)
This lists a public example repository on your account as a pending project,
runs the checker, and shows the result.

In the SQL Editor, first find your username on the platform with
`select username from public.profiles;`. Then replace YOUR-USERNAME below with it:

```sql
insert into public.projects (owner_id, github_owner, github_repo, title)
select id, 'octocat', 'Hello-World', 'Test project'
from public.profiles where username = 'YOUR-USERNAME';
```

Run the function from the Test tab again. Then:

```sql
select github_repo, verified_at is not null as confirmed, github_stars, language
from public.projects where github_repo = 'Hello-World';
```

It should say `confirmed` true, with GitHub's stars and language. Your account
also gets 50 XP. Clean up afterwards:

```sql
delete from public.projects where github_repo = 'Hello-World';
```

## Step 7. Turn on the hourly schedule
1. Open the file `schedule.sql.example` in the `github-sync` folder.
2. Copy it into the SQL Editor and replace the two placeholders
   (YOUR-PROJECT-REF and YOUR-CRON-SECRET).
3. Run it once. Do not save the filled-in version anywhere in the repository.

To see the latest runs, or to stop the schedule, use the two lines at the bottom
of that file.

## If something goes wrong
- "not allowed": the password in the request does not match CRON_SECRET.
- "the checker is not configured": CRON_SECRET is missing or shorter than 16
  characters.
- "the run failed, see the function logs": open the function's Logs tab. The
  details are there and nowhere else.
- Projects stay pending: check that the schedule exists and that the repository
  really is public and belongs to the GitHub name on the project.
