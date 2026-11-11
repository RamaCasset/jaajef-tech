// Test for kopeks-payment, against a REAL PostgreSQL database and a pretend PayDunya.
// Run AFTER the migrations: node --experimental-strip-types supabase/functions/kopeks-payment/payment.test.mjs

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { handler } from './index.ts'

function psql(sql, vars = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  args.push('-f', '-')
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

const SERVICE_KEY = 'test-service-key-0123456789'
const U1 = 'ee000000-0000-0000-0000-000000000001'
const U2 = 'ee000000-0000-0000-0000-000000000002'
const TOKENS = { 'token-one': U1, 'token-two': U2 }

// The pretend PayDunya: remembers invoices, and answers "confirm" with the status the test sets.
const invoices = new Map()
let nextStatus = 'completed'
let amountOverride = null
let paydunyaDown = false
let n = 0
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const answer = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    try {
      const payload = Buffer.concat(chunks).toString() || '{}'
      if (req.url === '/auth/v1/user') {
        const id = TOKENS[(req.headers.authorization ?? '').replace('Bearer ', '')]
        return id ? answer(200, { id }) : answer(401, { message: 'bad token' })
      }
      if (req.url.startsWith('/pd/')) {
        if (paydunyaDown) return answer(500, { message: 'down' })
        if (req.headers['paydunya-master-key'] !== 'MASTER' || req.headers['paydunya-private-key'] !== 'PRIVATE' || req.headers['paydunya-token'] !== 'PDTOKEN') return answer(401, { response_code: '01' })
        if (req.url === '/pd/checkout-invoice/create') {
          const body = JSON.parse(payload)
          const token = `test_tok${++n}`
          invoices.set(token, body)
          return answer(200, { response_code: '00', response_text: `https://pay.example/${token}`, token })
        }
        const m = req.url.match(/^\/pd\/checkout-invoice\/confirm\/(.+)$/)
        if (m) {
          const inv = invoices.get(decodeURIComponent(m[1]))
          if (!inv) return answer(200, { response_code: '1002', response_text: 'not found' })
          return answer(200, { response_code: '00', status: nextStatus, invoice: { total_amount: amountOverride ?? inv.invoice.total_amount } })
        }
      }
      if (req.url.startsWith('/rest/v1/kopek_purchases?') && req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams
        const tok = (q.get('provider_token') ?? '').replace('eq.', '')
        const usr = (q.get('user_id') ?? '').replace('eq.', '')
        const out = psql(`select coalesce(json_agg(t), '[]') from (select kopeks, status from public.kopek_purchases where provider_token = :'tok' and user_id = :'usr') t;`, { tok, usr })
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(out)
      }
      const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)
      if (m && req.method === 'POST') {
        if (req.headers.apikey !== SERVICE_KEY || req.headers.authorization !== `Bearer ${SERVICE_KEY}`) return answer(401, { message: 'bad key' })
        const sql = {
          create_kopek_purchase: `set role service_role; select row_to_json(t) from public.create_kopek_purchase((:'p'::jsonb ->> 'p_user')::uuid, (:'p'::jsonb ->> 'p_kopeks')::bigint, :'p'::jsonb ->> 'p_method') t;`,
          set_kopek_purchase_token: `set role service_role; select public.set_kopek_purchase_token((:'p'::jsonb ->> 'p_purchase')::uuid, :'p'::jsonb ->> 'p_token');`,
          complete_kopek_purchase: `set role service_role; select to_json(public.complete_kopek_purchase(:'p'::jsonb ->> 'p_token', :'p'::jsonb ->> 'p_status', (:'p'::jsonb ->> 'p_paid_cfa')::int));`,
        }[m[1]]
        if (!sql) return answer(404, { message: 'unknown' })
        try {
          const out = psql(sql, { p: payload }).split('\n').filter((l) => l !== 'SET').pop() || 'null'
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(out)
        } catch (e) {
          const msg = (String(e.stderr ?? e.message).match(/ERROR:\s+(.*)/) ?? [])[1] ?? 'error'
          return answer(400, { message: msg })
        }
      }
      answer(404, { message: 'unknown' })
    } catch (e) { answer(400, { message: String(e.message).slice(0, 300) }) }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const BASE = `http://127.0.0.1:${server.address().port}`
const settings = { SUPABASE_URL: BASE, SUPABASE_SECRET_KEYS: JSON.stringify([SERVICE_KEY]), PAYDUNYA_MASTER_KEY: 'MASTER', PAYDUNYA_PRIVATE_KEY: 'PRIVATE', PAYDUNYA_TOKEN: 'PDTOKEN', SITE_URL: 'https://jaajef.example/', PAYDUNYA_BASE_URL: `${BASE}/pd` }
const getEnv = (name) => settings[name]

const post = async (token, body, headers = {}) => {
  const h = { 'content-type': 'application/json', ...headers }
  if (token) h.authorization = `Bearer ${token}`
  const response = await handler(new Request('http://x/kopeks-payment', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }), getEnv, fetch)
  return { status: response.status, body: await response.json() }
}
const ipn = async (token) => {
  const response = await handler(new Request('http://x/kopeks-payment', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'data[invoice][token]': token, 'data[status]': 'completed' }).toString() }), getEnv, fetch)
  return response.status
}
const balance = (u) => Number(psql(`select kopeks from public.wallets where user_id = '${u}';`))

let passed = 0
const ok = (m) => { passed++; console.log(`OK ${passed}: ${m}`) }

try {
  psql(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
      ('${U1}', 'kpay1@exemple.sn', '{"provider":"email"}', '{}'),
      ('${U2}', 'kpay2@exemple.sn', '{"provider":"email"}', '{}');
  `)
  const start1 = balance(U1)

  // 1. sign-in and settings
  assert.equal((await post(null, { action: 'create', kopeks: 500, method: 'wave' })).status, 401)
  assert.equal((await post('wrong', { action: 'create', kopeks: 500, method: 'wave' })).status, 401)
  const unset = await handler(new Request('http://x', { method: 'POST', body: '{}' }), () => undefined, fetch)
  assert.equal(unset.status, 503)
  const partial = await handler(new Request('http://x', { method: 'POST', body: '{}' }), (n) => (n === 'SITE_URL' ? undefined : settings[n]), fetch)
  assert.deepEqual((await partial.json()).missing, ['SITE_URL'])
  assert.equal((await handler(new Request('http://x', { method: 'OPTIONS' }), () => undefined, fetch)).status, 204)
  assert.equal(invoices.size, 0)
  ok('sign-in is required; missing settings give a clear error; nothing reaches PayDunya')

  // 2. bad requests
  assert.equal((await post('token-one', 'not json')).status, 400)
  assert.equal((await post('token-one', { action: 'create', kopeks: 7, method: 'wave' })).status, 400)
  assert.equal((await post('token-one', { action: 'create', kopeks: 500, method: 'cheque' })).status, 400)
  assert.equal((await post('token-one', { action: 'nope' })).status, 400)
  assert.equal(invoices.size, 0)
  ok('odd packs, methods and actions are refused before PayDunya is called')

  // 3. create: price from the database, right channel, right return address
  const made = await post('token-one', { action: 'create', kopeks: 500, method: 'wave', phone: '+221 77 123 45 67' })
  assert.equal(made.status, 200)
  assert.match(made.body.url, /^https:\/\/pay\.example\/test_tok1$/)
  const sent = invoices.get('test_tok1')
  assert.equal(sent.invoice.total_amount, 5000)
  assert.deepEqual(sent.invoice.channels, ['wave-senegal'])
  assert.equal(sent.invoice.customer.phone, '771234567')
  assert.equal(sent.actions.return_url, 'https://jaajef.example/kopeks/retour')
  assert.equal(sent.actions.callback_url, `${BASE}/functions/v1/kopeks-payment`)
  assert.equal(balance(U1), start1)
  ok('the price and channel are set by the server; nothing is credited yet')

  // 4. someone else cannot confirm my payment
  assert.equal((await post('token-two', { action: 'confirm', token: 'test_tok1' })).status, 404)
  assert.equal(balance(U1), start1)
  ok('only the buyer can ask about a payment')

  // 5. pending, then paid: credited once, even with the browser and PayDunya both reporting
  nextStatus = 'pending'
  assert.equal((await post('token-one', { action: 'confirm', token: 'test_tok1' })).body.outcome, 'pending')
  assert.equal(balance(U1), start1)
  nextStatus = 'completed'
  const paid = await post('token-one', { action: 'confirm', token: 'test_tok1' })
  assert.equal(paid.body.outcome, 'credited')
  assert.equal(paid.body.kopeks, 500)
  assert.equal(await ipn('test_tok1'), 200)
  assert.equal((await post('token-one', { action: 'confirm', token: 'test_tok1' })).body.outcome, 'already')
  assert.equal(balance(U1), start1 + 500)
  ok('Kopeks are credited exactly once, however many times the news arrives')

  // 6. the payment page call alone (IPN) credits too
  const second = await post('token-one', { action: 'create', kopeks: 100, method: 'card' })
  assert.equal(second.status, 200)
  assert.deepEqual(invoices.get('test_tok2').invoice.channels, ['card'])
  assert.equal(await ipn('test_tok2'), 200)
  assert.equal(balance(U1), start1 + 600)
  ok('PayDunya calling by itself credits the buyer')

  // 7. a lie is not believed: wrong amount, unknown token, cancelled
  const third = await post('token-one', { action: 'create', kopeks: 1000, method: 'orange' })
  assert.equal(third.status, 200)
  amountOverride = 1
  assert.equal((await post('token-one', { action: 'confirm', token: 'test_tok3' })).body.outcome, 'amount_mismatch')
  amountOverride = null
  assert.equal(await ipn('test_tok-unknown'), 200)
  assert.equal(balance(U1), start1 + 600)
  const fourth = await post('token-one', { action: 'create', kopeks: 100, method: 'wave' })
  nextStatus = 'cancelled'
  assert.equal((await post('token-one', { action: 'confirm', token: 'test_tok4' })).body.outcome, 'cancelled')
  nextStatus = 'completed'
  assert.equal(balance(U1), start1 + 600)
  assert.equal(fourth.status, 200)
  ok('a wrong amount, an unknown payment and a cancelled one credit nothing')

  // 8. PayDunya down
  paydunyaDown = true
  const down = await post('token-one', { action: 'create', kopeks: 100, method: 'wave' })
  assert.equal(down.status, 502)
  assert.equal(down.body.error, 'payment_unavailable')
  assert.equal(balance(U1), start1 + 600)
  paydunyaDown = false
  ok('if PayDunya is down, the member gets a clear error and nothing changes')

  console.log(`ALL KOPEKS-PAYMENT TESTS PASSED (${passed})`)
} finally {
  try {
    psql(`delete from public.kopek_purchases where user_id in ('${U1}', '${U2}'); delete from auth.users where id in ('${U1}', '${U2}');`)
  } catch (e) { console.error('cleanup failed', e.message) }
  server.closeAllConnections?.()
  server.close()
}
