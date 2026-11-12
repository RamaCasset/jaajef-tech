# Google login: setup guide (plain language)

Members can sign in or sign up with their Google (Gmail) account. The buttons are already in the
app; they work once you do the steps below. About 30 minutes. Menu names at Google change often:
if something does not match, tell me what you see and we will find it together.

Never paste a secret (the Client secret) into a chat, an e-mail or the GitHub repository.
The Client ID is public; the Client secret is not.

## What you need first
- A Google account (any Gmail).
- The address of the live site (for now the Vercel address, for example `https://jaajef-tech.vercel.app`).
- The privacy and terms pages are online: `/confidentialite` and `/conditions` on the live site.

## Step 1. Create the project at Google
1. Go to https://console.cloud.google.com and sign in.
2. Top bar, project list, "New project". Name: `jaajef-tech`. Create it and make sure it is selected.

## Step 2. Fill in the consent screen
1. Menu, "APIs & Services", then "OAuth consent screen" (it can be called "Google Auth Platform", then "Branding").
2. User type: **External**. Create.
3. App name: `jaajef.tech`. Support e-mail: yours.
4. App logo: optional.
5. App home page: the live site address.
6. Privacy policy link: `<live site>/confidentialite`. Terms of service link: `<live site>/conditions`.
7. Authorized domain: the domain of the live site. If Google refuses `vercel.app` (it belongs to Vercel),
   leave it empty for now and add your own domain once you have it.
8. Developer contact e-mail: yours. Save.
9. Scopes ("Data access"): keep only the three basic ones: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`. Do not add any other scope.
10. Publishing status: click "Publish app" so it is **In production**. While it says "Testing", only
    the test users you list can sign in. Basic scopes do not need Google's review.

## Step 3. Create the sign-in credential
1. "Credentials" (or "Clients"), "Create credentials", "OAuth client ID".
2. Application type: **Web application**. Name: `jaajef.tech web`.
3. Authorized JavaScript origins: the live site address (no slash at the end). Add `http://localhost:5173` for testing on a computer.
4. Authorized redirect URIs: your Supabase project address followed by `/auth/v1/callback`:
   `https://oymumsiexpjxhpguifel.supabase.co/auth/v1/callback`
5. Create. Keep two things in your password manager: the **Client ID** and the **Client secret**.

## Step 4. Turn Google on in Supabase
1. Supabase dashboard, Authentication, Sign In / Providers.
2. Open Google, switch it on, paste the Client ID and the Client secret, and save.
3. Authentication, URL Configuration: the live site address and `<live site>/**` must already be in
   the Site URL and the redirect list (done for GitHub). When the real domain exists, add it here too.

## Check it works
1. Open the live site in a private window. "Se connecter avec Google" on the sign-in page.
2. Choose a Google account. You land on La Cité (a new account first chooses a clan).
3. In Supabase, Authentication, Users: the new member appears with provider Google.

## Good to know
- A Google sign-up creates the profile automatically: name and picture come from Google, the username
  comes from the part of the e-mail before the `@` (made unique if taken).
- If someone already signed up with the same e-mail and a password, Google sign-in on that e-mail
  connects to the same account.
- When the real domain is ready: add it in Google (JavaScript origins and authorized domain) and in Supabase.
