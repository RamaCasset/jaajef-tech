# Before going online

A checklist. Nothing here is done yet unless it says so. No platform can be promised unhackable: this list lowers the risk and limits the damage.

## What is already in place

- Database rules: every table is locked, and writes go through checked functions.
- Database tests that try to cheat on purpose, and checks that break each rule to prove the test catches it.
- No keys or passwords in the code or in chat.
- Text written by members is shown as plain text or safely formatted (dangerous links and images are dropped).

## What is not done

- No independent security review. All testing so far is ours.
- E2B, e-mail sending and GitHub sign-in are only tested with pretend versions.
- Nothing has been exposed to real traffic.

## Checklist

1. Two-step sign-in for every staff and admin account, and strong passwords.
2. Server limits against password guessing and sign-up spam.
3. Spending alerts and hard limits on the E2B, e-mail and hosting accounts.
4. Daily database backups, and a test that a backup can be restored.
5. Run every setup guide, then run the real-service tests (E2B, GitHub sign-in, e-mail).
6. A professional security review of the platform. Do it before the Run button and GitHub editing go live.
7. Start with a small group of members, then widen.
8. A way to switch off risky features quickly: the Run button, uploads, sign-ups.
9. A named person who reads the security alerts and the staff action log.

## Sample (demo) data

- The sample projects (`supabase/demo/demo_data.sql`) currently link to real open-source repositories owned by other people (for example `jakesgordon/javascript-racer`, `radix-ui/primitives`, `gitleaks/gitleaks`), shown under our own titles and texts and under a sample member as owner. That can look like misattribution.
- Before the demo is shown to the jury or the public: either point the sample projects at small public repositories created on our own GitHub account, or clearly label them as examples with the real repository name and author. If any third-party repository stays, check its license.
- Remove all sample data (`demo_data_remove.sql`) before real members arrive, unless it is clearly marked as sample.

## Run button safety plan (proposed, to confirm)

- Each run happens in a sealed E2B machine with none of our keys inside it.
- No internet access at first. Later, internet only to package download sites.
- Short time limit per run, limits on memory and output size.
- A daily cap per member, and a monthly budget for the whole platform that switches Run off when reached.
- Signed-in members only. Suspended members cannot run code.
- Every run is logged (who, when, how long). Staff can switch Run off for one member.
- Web previews: front-end projects in a locked frame in the visitor's browser, served from a separate address. Previews that need a server come later, shown only to the team and judges, and expire after a short time.

## GitHub editing safety plan (proposed, to confirm)

- Use a GitHub app where each member picks which repositories to allow, with permission limited to file changes.
- Keep each member's GitHub access on the server only, never in the browser.
- Do not store members' code on the platform.
- The code editor (Monaco) loads its files from a public CDN (jsDelivr) when the editor page opens. Before launch, host these files ourselves, or allow that address in the site's content security rules, so the editor does not depend on a third party.
- The editor saves commits under the app's name (the member's name appears in the message footer). Decide if that is acceptable, or if commits should carry the member's own name.

## Job offer reminders

- Set up the daily reminder for offers left open too long: see `JOB_REMINDERS_SETUP.md`. Decide the time of day, and whether 90 days is the right limit (`job_offer_stale_days`).
