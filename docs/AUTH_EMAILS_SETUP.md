# Sign-up confirmation and password reset e-mails: setup guide

The app is ready: the "Mot de passe oublié ?" link opens a page where the member enters their address, receives an
e-mail, clicks the link, and chooses a new password. Sign-up can also ask the member to confirm their address.
What is missing is a way to send those e-mails. Supabase's built-in sender is only meant for testing (a few e-mails
per hour, and only to your own team), so a real sender is needed before going online.

You can reuse the same Resend account as for the job-alert e-mails.

## Steps (in the Supabase dashboard)
1. Resend: create an "SMTP" access if you only have an API key. In Resend, the SMTP details are:
   host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key.
   The sender address must belong to the domain you verified in Resend (for example `no-reply@your-domain`).
2. Supabase, Authentication, Emails (SMTP Settings): turn on "Enable custom SMTP", then fill in the sender address,
   the sender name (jaajef.tech), and the host, port, user and password above. Save.
3. Supabase, Authentication, URL Configuration:
   - Site URL: the address of the live app.
   - Redirect URLs: add `https://YOUR-APP-ADDRESS/nouveau-mot-de-passe` and `https://YOUR-APP-ADDRESS/connexion`.
   Without this, the links in the e-mails are refused. (For testing on your computer, add the local address too.)
4. Supabase, Authentication, Sign In / Providers, Email: decide whether "Confirm email" is on.
   - On (recommended for a real launch): new members must click a link before they can sign in. The app already
     shows "check your mailbox" after sign-up.
   - Off: members enter the Cité straight away, with an address nobody checked.
5. Supabase, Authentication, Emails, Templates: the texts are in English by default. Edit "Confirm signup" and
   "Reset password" and write them in French. Keep the link variable `{{ .ConfirmationURL }}` in each.
   Suggested reset text: "Vous avez demandé un nouveau mot de passe. Cliquez sur le lien pour en choisir un :
   {{ .ConfirmationURL }}. Si ce n'est pas vous, ignorez ce message."
6. Supabase, Authentication, Rate Limits: leave the defaults for now.

## How to test
1. Open the live app, click "Mot de passe oublié ?", enter your own address.
2. The e-mail arrives (check the junk folder the first time). Click the link: you land on "Choisissez un nouveau mot de passe".
3. Choose one, then sign in with it.
4. Click the same link again: the page says the link no longer works.

## Notes
- The page always answers "if an account exists, an e-mail was sent", so nobody can use it to find out who is a member.
- The reset link is valid for one hour (Supabase default) and works once.
