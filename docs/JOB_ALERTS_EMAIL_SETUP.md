# Job-alert e-mail: setup guide (plain language)

Members can save a job search and turn on alerts. They already get a notice inside the app.
This function adds one e-mail a day, at 08:07, that gathers their new matching offers. Each
e-mail has an unsubscribe link, and a member can also turn the e-mail off in the app.

You do this once, after the app is online (the e-mail links to it). One step at a time. Never
paste a secret into a chat, an email or the GitHub repository.

## What you need first
- The `job_digest_unsubscribe` SQL file has been run in Supabase.
- The `job-digest` folder under `supabase/functions` in this repository.
- The CRON_SECRET you already made for the GitHub checker.

## Step 1. Make an account on the e-mail service (Resend)
1. Go to resend.com and sign up. The free plan is enough to start.
2. Add your domain (for example `jaajef.tech`) and add the records Resend shows you at the
   place where you bought the domain. Wait until Resend says the domain is verified. Without
   this step e-mails are refused or land in spam.
3. Create an API key (permission: sending). Keep it in your password manager.

## Step 2. Save the secrets in Supabase
Edge Functions, then Secrets. Add:

1. `EMAIL_API_KEY`: the Resend key.
2. `EMAIL_FROM`: the sender, for example `jaajef.tech <alertes@jaajef.tech>`. The address must
   be on the domain you verified.
3. `APP_URL`: the address of the app, for example `https://jaajef.tech`.
4. `UNSUBSCRIBE_SECRET`: invent a long random text of 20 characters or more. It signs the
   unsubscribe links, so nobody can unsubscribe someone else.
5. `DIGEST_URL`: this function's own address. You get it in Step 3, so come back to this one.
6. `CRON_SECRET` already exists (the same one as the other functions).

## Step 3. Create the function
1. Edge Functions, then Deploy a new function, then Via Editor.
2. Replace everything with the contents of `index.ts` from `supabase/functions/job-digest`.
3. Deploy. Switch off JWT verification: the function has its own password check, and the
   unsubscribe link must work for people who are not signed in.
4. Copy the function's address (Supabase chooses its last part). Save it as `DIGEST_URL`.

## Step 4. Try it once by hand
1. Open the function, then Test. Method POST, header `x-cron-secret` with your password.
2. You should get `{"pending":0,"sent":0,"failed":0,"stopped":null}` when nobody has a match.
3. To see a real e-mail: sign in with a test account, save a job search with alerts on, then
   publish an offer that matches it (in the test console, section on jobs). Run the function
   again: it should say `sent: 1`, and the e-mail arrives.
4. Open the unsubscribe link at the bottom of that e-mail. It shows a button; press it. Publish
   another matching offer and run again: nothing is sent to that member.

## Step 5. Run it every day
Use `supabase/functions/job-digest/schedule.sql.example`, the same way as the other two
schedules (replace the placeholders, run it once in the SQL Editor).

## Good to know
- A member whose e-mail failed to send is tried again at the next run, for up to 3 days.
- At most 100 e-mails per run. If you grow past that, tell me and we raise it or run twice a day.
- The e-mail is in French and lists up to 10 offers; the rest is counted.
- The link in the e-mail goes to the Jobs page.
