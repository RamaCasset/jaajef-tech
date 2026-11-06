// Test for the job-alert e-mail. The database and the e-mail service are both pretend: this checks what the
// function decides (who gets an e-mail, what it says, what is marked as sent, how unsubscribing works).
//
//   node --experimental-strip-types supabase/functions/job-digest/digest.test.mjs

import assert from 'node:assert/strict'
import { handler, runDigest, buildEmail, escapeHtml } from './index.ts'

const VALUES = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789',
  CRON_SECRET: 'cron-secret-0123456789',
  EMAIL_API_KEY: 're_test_key',
  EMAIL_FROM: 'jaajef.tech <alertes@jaajef.tech>',
  APP_URL: 'https://app.jaajef.test/',
  UNSUBSCRIBE_SECRET: 'unsubscribe-secret-0123456789',
  DIGEST_URL: 'https://db.test/functions/v1/digest-abc',
}
const getEnv = (overrides = {}) => (name) => ({ ...VALUES, ...overrides })[name]
const ENV = {
  supabaseUrl: VALUES.SUPABASE_URL, serviceKey: VALUES.SUPABASE_SERVICE_ROLE_KEY, cronSecret: VALUES.CRON_SECRET,
  emailKey: VALUES.EMAIL_API_KEY, emailFrom: VALUES.EMAIL_FROM, appUrl: 'https://app.jaajef.test',
  unsubscribeSecret: VALUES.UNSUBSCRIBE_SECRET, digestUrl: VALUES.DIGEST_URL,
}

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const offer = (n, extra = {}) => ({ offer_id: `o${n}`, title: `Poste ${n}`, employer_name: `Entreprise ${n}`, search_name: null, ...extra })
const row = (n, offers = [offer(1)]) => ({ user_id: U(n), email: `membre${n}@exemple.sn`, offers })

// A pretend database and a pretend e-mail service.
let pending, marks, unsubscribes, sent, failEmailFor, failPending, failMark, failUnsub
function reset() {
  pending = []; marks = []; unsubscribes = []; sent = []
  failEmailFor = new Set(); failPending = false; failMark = false; failUnsub = false
}
const fetchFn = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {}
  const ok = (data) => new Response(JSON.stringify(data), { status: 200 })
  if (url === 'https://api.resend.com/emails') {
    assert.equal(init.headers.authorization, 'Bearer re_test_key')
    const to = body.to[0]
    if (failEmailFor.has(to)) return new Response('{}', { status: 429 })
    sent.push(body)
    return ok({ id: 'e1' })
  }
  assert.equal(init.headers.apikey, VALUES.SUPABASE_SERVICE_ROLE_KEY)
  if (url.endsWith('/rpc/job_digest_pending')) return failPending ? new Response('{}', { status: 500 }) : ok(pending)
  if (url.endsWith('/rpc/mark_job_digest_sent')) { if (failMark) throw new Error('network'); marks.push(...body.p_users); return ok(1) }
  if (url.endsWith('/rpc/set_job_alert_email_for')) { if (failUnsub) return new Response('{}', { status: 500 }); unsubscribes.push(body); return ok(null) }
  throw new Error(`unexpected call ${url}`)
}
const run = (overrides) => runDigest({ ...ENV, ...overrides }, fetchFn)
const post = (secret = VALUES.CRON_SECRET, env = getEnv()) =>
  handler(new Request('https://db.test/fn', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} }), env, fetchFn)

let count = 0
const ok = (what) => { count += 1; console.log(`OK ${count}: ${what}`) }

// ---- 1. Setup and who may start a run ---------------------------------------------------------------------------------
reset()
for (const missing of Object.keys(VALUES)) {
  const res = await post(VALUES.CRON_SECRET, getEnv({ [missing]: '' }))
  assert.equal(res.status, 503, `${missing} missing`)
}
assert.equal((await post(VALUES.CRON_SECRET, getEnv({ UNSUBSCRIBE_SECRET: 'short' }))).status, 503)
assert.equal((await post(null)).status, 401)
assert.equal((await post('wrong')).status, 401)
assert.equal((await handler(new Request('https://db.test/fn', { method: 'GET' }), getEnv(), fetchFn)).status, 405)
assert.equal((await handler(new Request('https://db.test/fn', { method: 'OPTIONS' }), getEnv(), fetchFn)).status, 204)
assert.equal(sent.length, 0)
ok('every secret is required; a wrong or missing password and a plain GET are refused; nothing is sent')

// ---- 2. One e-mail per member, with the right content --------------------------------------------------------------
reset()
pending = [row(1, [offer(1, { search_name: 'React à Dakar' })]), row(2, [offer(2), offer(3, { title: '<script>alert(1)</script> & "Dev"', employer_name: "L'Atelier <b>" })])]
let res = await post()
assert.equal(res.status, 200)
assert.deepEqual(await res.json(), { pending: 2, sent: 2, failed: 0, stopped: null })
assert.equal(sent.length, 2)
assert.equal(sent[0].from, VALUES.EMAIL_FROM)
assert.deepEqual(sent[0].to, ['membre1@exemple.sn'])
assert.equal(sent[0].subject, '1 nouvelle offre pour vous sur jaajef.tech')
assert.equal(sent[1].subject, '2 nouvelles offres pour vous sur jaajef.tech')
assert.match(sent[0].text, /Poste 1 \(Entreprise 1\) - alerte : React à Dakar/)
assert.match(sent[0].text, /https:\/\/app\.jaajef\.test\/jobs/)
assert.equal(sent[1].html.includes('<script>'), false, 'member-written text is escaped')
assert.match(sent[1].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Dev&quot;/)
assert.match(sent[1].html, /L&#39;Atelier &lt;b&gt;/)
ok('one e-mail per member, singular and plural subjects, offers and alert names shown, member-written text escaped')

// ---- 3. Marked as sent only after a successful send ---------------------------------------------------------------------
reset()
pending = [row(1), row(2), row(3)]
failEmailFor = new Set(['membre2@exemple.sn'])
res = await post()
assert.deepEqual(await res.json(), { pending: 3, sent: 2, failed: 1, stopped: null })
assert.deepEqual(marks, [U(1), U(3)])
ok('a member whose e-mail failed is not marked as sent (tried again next run); the others are not affected')

// ---- 4. Failures in a row stop the run; a success resets the count ----------------------------------------------
reset()
pending = [row(1), row(2), row(3), row(4), row(5)]
failEmailFor = new Set(['membre1@exemple.sn', 'membre2@exemple.sn', 'membre3@exemple.sn'])
res = await post()
assert.deepEqual(await res.json(), { pending: 5, sent: 0, failed: 3, stopped: 'three sends failed in a row' })
reset()
pending = [row(1), row(2), row(3), row(4), row(5)]
failEmailFor = new Set(['membre1@exemple.sn', 'membre2@exemple.sn', 'membre4@exemple.sn', 'membre5@exemple.sn'])
res = await post()
assert.deepEqual(await res.json(), { pending: 5, sent: 1, failed: 4, stopped: null })
ok('three failures in a row stop the run; two failures, a success, then two failures do not')

// ---- 5. Limits: 100 e-mails, the time budget, 10 offers shown ---------------------------------------------------------
reset()
pending = Array.from({ length: 120 }, (_, i) => ({ user_id: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, email: `m${i}@exemple.sn`, offers: [offer(1)] }))
let summary = await run()
assert.equal(summary.sent, 100)
assert.equal(summary.stopped, 'run limit reached')
reset()
pending = [row(1), row(2), row(3)]
let clock = 0
summary = await runDigest(ENV, fetchFn, () => (clock += 60_000))
assert.equal(summary.stopped, 'time budget used')
assert.ok(summary.sent < 3)
reset()
pending = [row(1, Array.from({ length: 13 }, (_, i) => offer(i + 1)))]
await run()
assert.equal(sent[0].subject, '13 nouvelles offres pour vous sur jaajef.tech')
assert.match(sent[0].text, /Poste 10 /)
assert.equal(sent[0].text.includes('Poste 11 '), false)
assert.match(sent[0].text, /\.\.\. et 3 autres\./)
ok('at most 100 e-mails and about 100 seconds per run; 10 offers listed, the rest counted')

// ---- 6. Nothing to send, bad rows, database trouble ---------------------------------------------------------------------
reset()
assert.deepEqual(await run(), { pending: 0, sent: 0, failed: 0, stopped: null })
pending = [{ user_id: U(1), email: '', offers: [offer(1)] }, { user_id: U(2), email: 'a@b.sn', offers: [] }, { user_id: U(3), email: 'c@d.sn' }]
assert.deepEqual(await run(), { pending: 0, sent: 0, failed: 0, stopped: null })
assert.equal(sent.length, 0)
reset()
failPending = true
res = await post()
assert.equal(res.status, 502)
assert.equal(sent.length, 0)
reset()
pending = [row(1), row(2)]
failMark = true
summary = await run()
assert.equal(summary.sent, 2, 'a failed "mark as sent" call does not stop the run')
ok('nothing pending sends nothing; rows without an address or offers are skipped; a database failure sends nothing')

// ---- 7. The e-mail carries a working, signed unsubscribe link -----------------------------------------------------------
reset()
const email = await buildEmail(ENV, row(1))
const link = email.headers['List-Unsubscribe'].slice(1, -1)
assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
assert.ok(link.startsWith(`${VALUES.DIGEST_URL}?u=${U(1)}&t=`))
assert.ok(email.text.includes(link))
assert.ok(email.html.includes(link.replace(/&/g, '&amp;')))
const get = (u) => handler(new Request(u, { method: 'GET' }), getEnv(), fetchFn)
const postTo = (u, body) => handler(new Request(u, { method: 'POST', body, headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {} }), getEnv(), fetchFn)

// opening the link only asks for confirmation (mail scanners open links)
let page = await get(link)
assert.equal(page.status, 200)
assert.match(await page.text(), /Me désabonner/)
assert.equal(unsubscribes.length, 0, 'opening the link does not unsubscribe anyone')
// pressing the button
page = await postTo(link)
assert.equal(page.status, 200)
assert.deepEqual(unsubscribes, [{ p_user: U(1), p_on: false }])
// the mail app's one-click button
page = await postTo(link, 'List-Unsubscribe=One-Click')
assert.equal(page.status, 200)
assert.equal(unsubscribes.length, 2)
ok('the unsubscribe link only confirms on opening, switches the e-mail off on the button or one click')

// ---- 8. Forged or damaged links do nothing --------------------------------------------------------------------------------
reset()
const token = link.split('&t=')[1]
const other = `${VALUES.DIGEST_URL}?u=${U(2)}&t=${token}` // someone else's id with my token
for (const bad of [
  other,
  `${VALUES.DIGEST_URL}?u=${U(1)}&t=${token.slice(0, -1)}0`,
  `${VALUES.DIGEST_URL}?u=${U(1)}&t=`,
  `${VALUES.DIGEST_URL}?u=${U(1)}`,
  `${VALUES.DIGEST_URL}?t=${token}`,
  `${VALUES.DIGEST_URL}?u=not-a-uuid&t=${token}`,
]) {
  assert.equal((await get(bad)).status, 400, bad)
  assert.equal((await postTo(bad)).status, 400, bad)
}
const wrongSecret = await handler(new Request(link, { method: 'POST' }), getEnv({ UNSUBSCRIBE_SECRET: 'another-secret-0123456789' }), fetchFn)
assert.equal(wrongSecret.status, 400)
assert.equal(unsubscribes.length, 0)
failUnsub = true
assert.equal((await postTo(link)).status, 502)
assert.equal((await handler(new Request(link, { method: 'DELETE' }), getEnv(), fetchFn)).status, 405)
ok('a link for another member, a changed token, missing parts, a non-id or another secret does nothing; a database failure is reported')

// ---- 9. Escaping helper -------------------------------------------------------------------------------------------------------
assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
ok('escaping covers < > & and both kinds of quote')

console.log(`ALL JOB DIGEST TESTS PASSED (${count})`)
