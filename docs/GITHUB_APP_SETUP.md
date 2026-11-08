# GitHub app for the code editor: setup guide (plain language)

This is a SECOND GitHub setup, different from the GitHub sign-in one. Sign-in lets a member
log in with GitHub. This one lets the editor on jaajef.tech save a member's changes into their
own GitHub repository ("commit"). It needs a "GitHub App" (not an "OAuth App").

How it stays safe:
- Each member installs the app on GitHub themselves and picks which repositories it may touch.
- It asks for two permissions: changing the files of those repositories ("Contents") and managing proposals of changes ("Pull requests"), so members can propose and merge changes from the site.
- The app's private key lives only in Supabase, never in the browser and never in the repository.
- Every save goes through a small program on the server (`repo-editor`) which checks that the
  repository belongs to the signed-in member.

You do this once. Menu names on GitHub can change a little. If something does not match,
tell me what you see and we will find it together. Never paste a secret into a chat, an
email or the GitHub repository.

## What you need first
- The `repo-editor` folder under `supabase/functions` in this repository (once its PR is merged).
- A GitHub account that will own the app. For a start it can be yours; it can be moved to a
  company account later.

## Step 1. Create the GitHub App
1. On GitHub: profile picture, Settings, Developer settings, GitHub Apps, New GitHub App.
2. GitHub App name: `jaajef-tech-editor` (the name must be unique on GitHub; add a word if taken).
3. Homepage URL: the address of the app (for now `http://localhost:5173`).
4. Callback URL: leave empty. Under "Expire user authorization tokens" and "Request user
   authorization (OAuth) during installation", leave everything off.
5. Webhook: remove the tick from "Active". We do not use webhooks.
6. Repository permissions: open the list, set **Contents** to **Read and write** and **Pull requests** to **Read and write**.
   Leave every other permission at "No access". (Metadata: Read-only is added by GitHub itself.)
7. "Where can this GitHub App be installed?": choose **Any account**.
8. Click "Create GitHub App".

## Step 2. Keep three things
On the app's page (Developer settings, GitHub Apps, your app):
1. **App ID**: a number near the top. Write it down.
2. **App name in the address** (the "slug"): the public page address looks like
   `https://github.com/apps/jaajef-tech-editor`. The last part is the slug.
3. **Private key**: scroll to "Private keys", click "Generate a private key". A file ending in
   `.pem` downloads. Keep it in your password manager. Do not email it, do not put it in the repository.

## Step 3. Save them in Supabase
Supabase dashboard, Edge Functions, Secrets. Add:
1. `GITHUB_APP_ID`: the App ID number.
2. `GITHUB_APP_SLUG`: the slug.
3. `GITHUB_APP_PRIVATE_KEY`: open the `.pem` file in a text editor and paste everything,
   including the lines starting with `-----BEGIN` and `-----END`.

## Step 4. Create the `repo-editor` function
1. Edge Functions, Deploy a new function, Via Editor.
2. Name it `repo-editor`. Replace everything with the contents of `index.ts` from
   `supabase/functions/repo-editor`.
3. Deploy. Switch off JWT verification (the function checks the member's login itself).

## What members will see
1. On a project of theirs: "Modifier le code".
2. First time: "Installer l'application GitHub". GitHub asks which repositories to allow.
   They should choose "Only select repositories".
3. They edit files in the browser, describe the change, and press "Enregistrer sur GitHub".
   The change appears as a normal commit on their repository.

## Honest limits of the first version
- Only repositories owned by the member's own GitHub account, not organisations.
- Commits show the app as the author (the member's name appears in the message footer).
- A member can remove the app at any time on GitHub (Settings, Applications).
- If the member changed the branch on GitHub meanwhile, the save is refused and they are told
  to reload; nothing is overwritten.


## Adding the "Pull requests" permission to an app that already exists

1. GitHub, Settings, Developer settings, GitHub Apps, your app, Permissions & events:
   set **Pull requests** to **Read and write**, then save.
2. GitHub then asks the account that installed the app to accept the new permission.
   Open Settings, Applications, Installed GitHub Apps, the app, and press **Accept new permissions**.
   Until this is done, the Propositions page says that a permission is missing.
