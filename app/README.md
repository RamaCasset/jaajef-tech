# jaajef.tech app

The web app members use. React, Vite and TypeScript, talking to Supabase.

## Run it
1. `cd app`
2. `cp .env.example .env.local` and fill in the project address and the public key.
3. `npm install`, then `npm run dev`.

## Checks
`npm run typecheck`, `npm test`, `npm run build` (all three run on every push).

## Where things are
- `src/i18n/fr.ts`: all visible text (French).
- `src/styles/tokens.css`: colours and fonts. Taken from the screens shared on 1 November; replace with Marie's final values.
- `src/lib/api.ts`: every call to the database goes through here.
- `src/pages`: one file per screen. Built so far: sign-in, sign-up, character creation, and a placeholder home.
- Not built: step 3 of sign-up ("Votre guide"), because it is not clear what it does.
