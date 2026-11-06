# jaajef.tech

A platform by developers, for developers: chat, projects, quests, a shop and jobs,
tied together by XP and Kopeks. Designs by Marie (Figma).

## Status

| Part | State |
|---|---|
| Database foundation (accounts, profiles, XP, Kopeks, badges) | Done and tested (`supabase/migrations`) |
| Quests (attempts, rewards, streaks, leaderboards) | Done and tested (`supabase/migrations`) |
| Quest teaching (hints, explanations, order, languages) | Done and tested; sample lesson only |
| Chat (communities, channels, forum, messages, invites, spam limit) | Done and tested |
| Private messages and files (inbox, unread, blocking, file attachments) | Done and tested |
| Projects from GitHub (database side: listing, ownership check, pending until verified) | Done and tested |
| Badges that unlock by themselves (3 automatic, 4 manual for now) | Done and tested |
| Ask to join private communities (listed or hidden, requests, approval) | Done and tested |
| Staff roles (admin, moderator, audit log) | Done and tested |
| Reports and moderation (reports, warnings, suspensions, hiding content) | Done and tested |
| Character locked after first choice; quests capped at 10 minutes | Done and tested |
| Souk (buy, own and wear themes, avatar frames and status badges with Kopeks) | Done and tested. Creator submissions and the creator share come later |
| Notifications (in-app inbox: stars, comments, requests, badges, warnings; mute and read state) | Done and tested; not yet merged |
| Project discovery (search, filters, sorting, featured projects, trending creators) | Done and tested; not yet merged |
| Global search (projects, members, communities, quests) | Done and tested; not yet merged |
| Quest of the day (one quest for everyone, scheduled by admins or picked automatically) | Done and tested |
| Blog (posts and drafts, likes, comments, staff hiding, daily limit) | Done and tested |
| Souk extras (ratings by owners, theme of the week) | Done and tested |
| Streak extras (real streak today, longest streak, activity calendar, top streaks) | Done and tested |
| Safety audit (checks the whole database for common security mistakes, on every push) | Done |
| Blog hooks (notices for comments, likes and hiding; posts in search; reports on posts, comments and job offers) | Done and tested |
| Quest writer, shop manager and shop owner roles | Done and tested |
| Souk creator submissions (submit, review, approve into the shop) | Done and tested |
| Souk creator share (Kopek payout on sales, sales list, owner overview) | Done and tested |
| Souk submission images (private upload, review, shown with the item) | Done and tested |
| Souk reports and taking items off sale | Done and tested |
| Quest-of-the-day bonus (placeholder amounts) and streak freezes | Done and tested |
| Cleanup of unused CV files and Souk images (daily job; needs deploying) | Done and tested |
| "Build passing" badge and "Good first issues" (database and checker; shows data once the checker is running) | Done and tested |
| Jobs, part 1 (employers, job offers, staff review, search) | Done and tested |
| Jobs, part 2 (private application file: skills, portfolio, CV upload, completion percentage) | Done and tested |
| Jobs, part 3 (applying, statuses, 90-day CV access for the company) | Done and tested |
| Jobs, part 4 (saved offers, saved searches, in-app job alerts, data for the daily email) | Done and tested |
| Jobs, part 5 (opt-in talent directory for approved companies) | Done and tested |
| Jobs, next parts (sending the daily email) | Not started |
| Project stars, comments and ask to collaborate | Done and tested |
| GitHub checker (confirms projects against GitHub, hourly) | Built and tested; not yet merged. Setup guide: `docs/GITHUB_CHECKER_SETUP.md` |
| Frontend | Waiting for Marie's confirmed screens |

## Stack (first version)

- **Backend:** Supabase (PostgreSQL, login, live updates, file storage)
- **Frontend:** to be confirmed with the designs
- Everything marked "V2" in the stack spreadsheet (voice and live, Telegram,
  hosted repos, real-money payments) is out of the first version.

## Where things live

```
supabase/
  migrations/   database changes, applied in order (one file per change)
  tests/        security and behaviour tests for the database
docs/
  ARCHITECTURE.md   how the pieces fit, in plain language
```

## Setting up the database

1. Create a project at supabase.com and note its URL and keys.
2. Install the Supabase CLI, then in this folder run:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. In the Supabase dashboard, turn on the GitHub and Google sign-in providers.

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

## Running the database tests

The tests prove the security rules hold (for example, that a member cannot give
themselves XP). They run on a plain PostgreSQL:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/_stub_supabase.sql   # test database only
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -v ON_ERROR_STOP=1 -f supabase/tests/ask_to_join.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/badges.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/blog.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/blog_hooks.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/chat.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/daily_bonus_streak_freeze.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/dm.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/file_cleanup.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/fixes.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/foundation.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/github_badges.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/jobs_application_file.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/jobs_applying.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/jobs_employers.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/jobs_saved_alerts.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/jobs_talent_directory.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/global_search.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/moderation.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/moderation_followup.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/project_discovery.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/project_social.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/notifications.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/projects.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/quest_of_the_day.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/quests.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/schema_audit.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/shop_quest_roles.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk_creator_share.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk_extras.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk_images.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk_reports.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/souk_submissions.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/staff.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/streaks.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/teaching.test.sql
node --experimental-strip-types supabase/functions/github-sync/sync.test.mjs   # the GitHub checker, needs Node 22
node --experimental-strip-types supabase/functions/file-cleanup/cleanup.test.mjs   # the file cleanup, needs Node 22
```

Never run `_stub_supabase.sql` on a real Supabase project.

## Rules of the house

- XP and Kopeks change **only** through `grant_reward()` on the server.
- Secrets live in `.env` (or the hosting dashboard), never in the code.
- Values still to be decided are marked `tbc` in the `game_config` table.
