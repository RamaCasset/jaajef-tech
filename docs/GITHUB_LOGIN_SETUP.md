# GitHub login: setup guide (plain language)

Members connect their GitHub account so they can add their projects. This needs a small
"GitHub app" that you create once on GitHub, and three settings in Supabase. Menu names can
change slightly; if something does not match, tell me what you see and we will find it together.

Never paste a secret into a chat, an email or the GitHub repository.

## What you need first
- The `link_github` SQL file has been run in Supabase.
- The address where the app will live (needed in Step 3; until the app is online it can be
  `http://localhost:5173` for testing on a computer).

## Step 1. Create the GitHub app
1. On GitHub: profile picture, Settings, Developer settings, OAuth Apps, New OAuth App.
2. Application name: `jaajef.tech`.
3. Homepage URL: the address of the app (or `http://localhost:5173` for now).
4. Authorization callback URL: your Supabase project address followed by `/auth/v1/callback`,
   which is `https://oymumsiexpjxhpguifel.supabase.co/auth/v1/callback`.
5. Register the application. Then click "Generate a new client secret".
6. Keep two things in your password manager: the Client ID and the Client secret. GitHub shows
   the secret only once.

## Step 2. Turn GitHub on in Supabase
1. Supabase dashboard, Authentication, Sign In / Providers.
2. Open GitHub, switch it on, paste the Client ID and the Client secret, and save.

## Step 3. Allow connecting GitHub to an existing account
1. Still in Authentication, Sign In / Providers, find the switch named "Allow manual linking"
   (it can also sit under Authentication settings). Switch it on. Without it, a member who
   signed up with an e-mail address cannot add GitHub afterwards.
2. Authentication, URL Configuration: add the app address to the list of allowed redirect
   addresses, with `/projets/ajouter` at the end (for example
   `http://localhost:5173/projets/ajouter`). Add the final address later, when the app is online.

## What members see
1. Projets, then "Ajouter un projet".
2. First time only: "Connecter GitHub" sends them to GitHub, then back.
3. They see their PUBLIC repositories and press "Ajouter" next to the ones they want.
4. The project waits for the GitHub checker, then becomes visible to everyone.

## What we can and cannot see
- We read the member's GitHub name and their public repositories. Never private ones.
- A member can only add repositories under their own GitHub name. The database checks this
  against the verified GitHub login, not against anything typed.
- GitHub allows about 60 repository lists per hour per internet address for visitors without
  a login. If many members share one address (a school, a cyber cafe), some may be asked to
  try again later. If this becomes a problem we move the list to the server.
