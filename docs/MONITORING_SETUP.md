# Monitoring setup (plain language)

Three optional tools. The site works without them. Never paste a key into a chat or the repository: put it in Vercel (Project, Settings, Environment Variables), then redeploy.

## 1. Error reports (Sentry, free plan)
1. Create an account on sentry.io and a project of type "Browser JavaScript".
2. Copy the DSN (a link starting with https://).
3. In Vercel add `VITE_SENTRY_DSN` with that value. Redeploy.
4. Check: open the site (a refused or blocked report is also written to the browser console, starting with [monitoring]), then in the browser console type `setTimeout(() => { throw new Error('test') })`. The error should appear in Sentry within a minute.

## 2. Visit counts (Plausible, no cookies)
1. Create an account on plausible.io and add the site `jaajef.tech`.
2. In Vercel add `VITE_PLAUSIBLE_DOMAIN` = `jaajef.tech`. Redeploy.

## 3. Uptime check (no code)
1. Create a free account on uptimerobot.com.
2. Add a monitor: type HTTP(s), URL `https://jaajef.tech`, every 5 minutes.
3. Add your e-mail as the alert contact.

## Sample projects
Run `supabase/demo/demo_label_projects.sql` so each sample project says it is an example and credits the real repository.
