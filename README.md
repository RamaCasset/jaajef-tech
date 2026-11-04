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
| Projects from GitHub (database side: listing, ownership check, pending until verified) | Done and tested; not yet merged. The GitHub checker program is the next piece |
| Staff roles (admin, moderator, audit log) | Done and tested; not yet merged |
| Reports and moderation (reports, warnings, suspensions, hiding content) | Done and tested; not yet merged |
| Souk, jobs, back-office screens | Not started |
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
psql -v ON_ERROR_STOP=1 -f supabase/tests/chat.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/dm.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/foundation.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/moderation.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/projects.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/quests.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/staff.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/teaching.test.sql
```

Never run `_stub_supabase.sql` on a real Supabase project.

## Rules of the house

- XP and Kopeks change **only** through `grant_reward()` on the server.
- Secrets live in `.env` (or the hosting dashboard), never in the code.
- Values still to be decided are marked `tbc` in the `game_config` table.
