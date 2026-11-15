# jaajef.tech

**La tech entre nous.** A platform by and for African developers: learn through daily coding quests, build and share projects, trade in a community shop, find jobs, and talk with the community. Everything is tied together by XP and Kopeks (the in-app currency).

*"Jaajëf" means "thank you" in Wolof.*

**Live demo:** https://jaajef.tech
**Built by:** Jarama Tech SAS, Dakar, Senegal. Designs by Marie (Figma).

## What you can do

| Area | What it does |
|---|---|
| **La Cité** | Home base: communities, clans, channels, forum and private messages |
| **Quêtes** | A quest of the day plus a catalogue of coding quests (Python, JavaScript). Code runs in a built-in editor with live tests, then earns XP, Kopeks and streaks |
| **Projets** | Share GitHub repositories, with a built-in code editor, stars, comments and collaboration requests |
| **Le Souk** | A marketplace for themes, avatar frames and status badges, bought with Kopeks, with creator submissions and a creator share |
| **Jobs** | Job offers, applications, saved searches, e-mail alerts and an opt-in talent directory |
| **Back office** | Roles for admins and moderators, reports, warnings and an audit log |

The interface is in French and English.

## Tech stack

- **Frontend:** React 18, TypeScript, Vite, React Router, Monaco editor
- **Backend:** Supabase (PostgreSQL with row-level security, auth with e-mail, Google and GitHub, storage, Edge Functions)
- **Code runner:** sandboxed execution for quests (E2B)
- **E-mail:** Resend (sign-up confirmation and job alerts)
- **Payments:** PayDunya, **in test mode only** for this submission
- **Hosting:** Vercel

## Run the app locally

```bash
cd app
cp .env.example .env.local     # add your Supabase URL and public anon key
npm install
npm run dev                    # http://localhost:5173
```

Other commands:

```bash
npm run typecheck   # TypeScript check
npm test            # unit and component tests
npm run build       # production build
```

## Security approach

- XP and Kopeks only change through server-side functions, never from the browser.
- Row-level security is on for every table.
- Secrets live in the hosting dashboard, never in the code. `.env.example` holds only public values.
- The `.env` files are never committed.

## Notes for reviewers

- **Payments are in test mode.** Buying Kopeks opens a PayDunya sandbox checkout and no real money moves.
- **Some content is sample data.** Demo accounts, sample projects, job offers and Souk items are there to show the product.

## Contact

ramatoulaye@jaramatech.com
