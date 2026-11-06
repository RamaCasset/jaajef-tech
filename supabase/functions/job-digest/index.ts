// jaajef.tech - Daily job-alert e-mail (Supabase Edge Function)
//
// What it does
//   1. Asks the database which members have new job offers matching their alerts (job_digest_pending).
//      The database already leaves out members who turned the e-mail off, offers that are closed,
//      and matches older than 3 days.
//   2. Sends each of them ONE e-mail with their new offers (through Resend).
//   3. After each successful send, tells the database so those matches are never e-mailed twice.
//
// Unsubscribing
//   Every e-mail has a signed link. Opening it shows a confirmation page (so mail scanners that open
//   links do not unsubscribe anyone); pressing the button, or the mail app's one-click unsubscribe,
//   switches the e-mail off.
//
// Safety rules
//   * Only a caller that knows CRON_SECRET can start a run.
//   * A failed send leaves the matches unsent, so the next run tries again (within the 3 days).
//   * Three failed sends in a row stop the run. At most 100 e-mails and about 100 seconds per run.
//   * Titles and names written by members are escaped before they enter the e-mail.
//
// Secrets: CRON_SECRET (same as the other functions), EMAIL_API_KEY (Resend), EMAIL_FROM (for example
// "jaajef.tech <alertes@jaajef.tech>", an address on a domain verified in Resend), APP_URL (for example
// https://jaajef.tech), UNSUBSCRIBE_SECRET (a long random text), DIGEST_URL (this function's own address,
// used in the unsubscribe links). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS)
// are provided by Supabase itself.

export type Env = {
  supabaseUrl: string
  serviceKey: string
  cronSecret: string
  emailKey: string
  emailFrom: string
  appUrl: string
  unsubscribeSecret: string
  digestUrl: string
}

export type Offer = { offer_id: string; title: string; employer_name: string; search_name: string | null }
export type Pending = { user_id: string; email: string; offers: Offer[] }
export type Email = { to: string; subject: string; html: string; text: string; headers: Record<string, string> }

const MAX_EMAILS_PER_RUN = 100
const MAX_OFFERS_SHOWN = 10
const MAX_CONSECUTIVE_FAILURES = 3
const TIME_BUDGET_MS = 100_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'x-cron-secret, content-type, authorization, apikey',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(page(body), { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function page(body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>jaajef.tech</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;line-height:1.5">${body}</body></html>`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function authHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: env.serviceKey }
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
}

function firstSecretKey(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return String(parsed[0] ?? '')
    return String(Object.values(parsed)[0] ?? '')
  } catch {
    return ''
  }
}

// ---- Signed unsubscribe links -------------------------------------------------------------------------------------

async function sign(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`job-digest-unsubscribe:${userId}`))
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function unsubscribeLink(env: Env, userId: string): Promise<string> {
  return `${env.digestUrl}?u=${encodeURIComponent(userId)}&t=${await sign(userId, env.unsubscribeSecret)}`
}

async function validLink(env: Env, userId: string | null, token: string | null): Promise<boolean> {
  if (!userId || !token || !UUID.test(userId)) return false
  return sameSecret(token, await sign(userId, env.unsubscribeSecret))
}

// ---- The e-mail ----------------------------------------------------------------------------------------------------------

export async function buildEmail(env: Env, row: Pending): Promise<Email> {
  const offers = row.offers
  const n = offers.length
  const shown = offers.slice(0, MAX_OFFERS_SHOWN)
  const more = n - shown.length
  const link = await unsubscribeLink(env, row.user_id)
  const jobsUrl = `${env.appUrl}/jobs`
  const subject = n === 1 ? '1 nouvelle offre pour vous sur jaajef.tech' : `${n} nouvelles offres pour vous sur jaajef.tech`

  const textLines = [
    n === 1 ? 'Une nouvelle offre correspond à vos alertes :' : `${n} nouvelles offres correspondent à vos alertes :`,
    '',
    ...shown.map((o) => `- ${o.title} (${o.employer_name})${o.search_name ? ` - alerte : ${o.search_name}` : ''}`),
    ...(more > 0 ? [`... et ${more} autre${more > 1 ? 's' : ''}.`] : []),
    '',
    `Voir les offres : ${jobsUrl}`,
    '',
    `Se désabonner de ces e-mails : ${link}`,
  ]
  const items = shown.map((o) =>
    `<li><strong>${escapeHtml(o.title)}</strong> <span style="color:#555">(${escapeHtml(o.employer_name)})</span>` +
    `${o.search_name ? `<br><small style="color:#777">Alerte : ${escapeHtml(o.search_name)}</small>` : ''}</li>`).join('')
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5">` +
    `<p>${n === 1 ? 'Une nouvelle offre correspond à vos alertes :' : `${n} nouvelles offres correspondent à vos alertes :`}</p>` +
    `<ul>${items}</ul>${more > 0 ? `<p>... et ${more} autre${more > 1 ? 's' : ''}.</p>` : ''}` +
    `<p><a href="${escapeHtml(jobsUrl)}">Voir les offres</a></p>` +
    `<hr><p style="font-size:12px;color:#777">Vous recevez cet e-mail parce que vous avez des alertes emploi sur jaajef.tech. ` +
    `<a href="${escapeHtml(link)}">Se désabonner</a></p></div>`
  return {
    to: row.email, subject, html, text: textLines.join('\n'),
    headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

async function sendEmail(env: Env, email: Email, fetchFn: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.emailKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.emailFrom, to: [email.to], subject: email.subject, html: email.html, text: email.text, headers: email.headers }),
    })
    return response.ok
  } catch {
    return false
  }
}

// ---- Database calls ---------------------------------------------------------------------------------------------------

async function rpc(name: string, args: unknown, env: Env, fetchFn: typeof fetch): Promise<{ ok: boolean; body: any }> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify(args) })
  let body: any = null
  try { body = await response.json() } catch { body = null }
  return { ok: response.ok, body }
}

// ---- The run ---------------------------------------------------------------------------------------------------------------

export type Summary = { pending: number; sent: number; failed: number; stopped: string | null }

export async function runDigest(env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Summary> {
  const started = now()
  const list = await rpc('job_digest_pending', {}, env, fetchFn)
  if (!list.ok || !Array.isArray(list.body)) throw new Error('database call job_digest_pending failed')
  const rows = (list.body as Pending[]).filter((r) => r && typeof r.email === 'string' && r.email && Array.isArray(r.offers) && r.offers.length > 0)

  const summary: Summary = { pending: rows.length, sent: 0, failed: 0, stopped: null }
  let streak = 0
  for (const row of rows) {
    if (summary.sent + summary.failed >= MAX_EMAILS_PER_RUN) { summary.stopped = 'run limit reached'; break }
    if (now() - started > TIME_BUDGET_MS) { summary.stopped = 'time budget used'; break }
    const email = await buildEmail(env, row)
    const delivered = await sendEmail(env, email, fetchFn)
    if (!delivered) {
      summary.failed += 1
      streak += 1
      if (streak >= MAX_CONSECUTIVE_FAILURES) { summary.stopped = 'three sends failed in a row'; break }
      continue
    }
    streak = 0
    summary.sent += 1
    // Marked right away, member by member: if the next send crashes, nobody gets this one twice.
    await rpc('mark_job_digest_sent', { p_users: [row.user_id] }, env, fetchFn).catch(() => undefined)
  }
  return summary
}

// ---- Unsubscribe pages ------------------------------------------------------------------------------------------------

async function unsubscribePage(request: Request, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const url = new URL(request.url)
  const userId = url.searchParams.get('u')
  const token = url.searchParams.get('t')
  if (!(await validLink(env, userId, token))) {
    return htmlResponse('<h1>Lien invalide</h1><p>Ce lien de désabonnement n\'est pas valide. Vous pouvez aussi couper ces e-mails depuis les réglages de vos alertes sur jaajef.tech.</p>', 400)
  }
  if (request.method === 'GET') {
    return htmlResponse(
      '<h1>Se désabonner ?</h1><p>Vous ne recevrez plus le résumé quotidien des offres. Vos alertes dans l\'application restent actives.</p>' +
      `<form method="post" action="${escapeHtml(url.pathname + url.search)}"><button type="submit" style="padding:10px 16px;font-size:16px">Me désabonner</button></form>`)
  }
  const done = await rpc('set_job_alert_email_for', { p_user: userId, p_on: false }, env, fetchFn)
  if (!done.ok) return htmlResponse('<h1>Une erreur est survenue</h1><p>Réessayez dans un instant.</p>', 502)
  return htmlResponse('<h1>C\'est fait</h1><p>Vous ne recevrez plus le résumé quotidien des offres. Vous pouvez le réactiver à tout moment dans les réglages de vos alertes.</p>')
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    cronSecret: getEnv('CRON_SECRET') ?? '',
    emailKey: getEnv('EMAIL_API_KEY') ?? '',
    emailFrom: getEnv('EMAIL_FROM') ?? '',
    appUrl: (getEnv('APP_URL') ?? '').replace(/\/+$/, ''),
    unsubscribeSecret: getEnv('UNSUBSCRIBE_SECRET') ?? '',
    digestUrl: getEnv('DIGEST_URL') ?? '',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (Object.values(env).some((v) => !v) || env.unsubscribeSecret.length < 16 || env.cronSecret.length < 16) {
    return jsonResponse({ error: 'not_configured' }, 503)
  }

  const params = new URL(request.url).searchParams
  if (params.has('u') || params.has('t')) {
    if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    return unsubscribePage(request, env, fetchFn)
  }

  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!sameSecret(request.headers.get('x-cron-secret') ?? '', env.cronSecret)) return jsonResponse({ error: 'not_allowed' }, 401)
  try {
    return jsonResponse(await runDigest(env, fetchFn))
  } catch {
    return jsonResponse({ error: 'run_failed' }, 502)
  }
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
