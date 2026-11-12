// Test for run-quest, against a REAL PostgreSQL database.
//
// Run it AFTER the migrations are applied and the PG* variables point to the test database:
//   node --experimental-strip-types supabase/functions/run-quest/run.test.mjs
//
// A small stand-in for Supabase runs the real database functions as "service_role" and knows two
// signed-in players. A second stand-in plays the code runner: it passes or fails by what the "code" says.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { handler, runQuest } from './index.ts'

function psql(sql, vars = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  args.push('-f', '-')
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

const SERVICE_KEY = 'test-service-key-0123456789'
const RUNNER_KEY = 'test-runner-key-0123456789'
const U1 = 'ff000000-0000-0000-0000-000000000001'
const U2 = 'ff000000-0000-0000-0000-000000000002'
const TOKENS = { 'token-one': U1, 'token-two': U2 }

const runnerCalls = []
let runnerMode = 'ok' // ok | down | hang | garbage
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
      if (req.url === '/runner') {
        if (req.headers.authorization !== `Bearer ${RUNNER_KEY}`) return answer(401, { message: 'bad runner key' })
        const body = JSON.parse(payload)
        runnerCalls.push(body)
        if (runnerMode === 'down') return answer(500, { message: 'runner down' })
        if (runnerMode === 'hang') return // never answers
        if (runnerMode === 'garbage') return answer(200, { nope: true })
        const tests = body.tests
        const code = body.code
        const results = tests.map((t, i) => {
          if (code.startsWith('BOOM')) return { name: t.name, passed: false, error: 'ZeroDivisionError: division by zero' }
          if (code.startsWith('HALF')) return { name: t.name, passed: i === 0 }
          if (code.startsWith('LIAR')) return { name: 'not-a-real-test', passed: true }
          return { name: t.name, passed: true }
        })
        return answer(200, { results })
      }
      const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)
      if (m && req.method === 'POST') {
        if (req.headers.apikey !== SERVICE_KEY || req.headers.authorization !== `Bearer ${SERVICE_KEY}`) return answer(401, { message: 'bad key' })
        if (!['begin_quest_run', 'record_graded_attempt'].includes(m[1])) return answer(404, { message: 'unknown' })
        const sql = m[1] === 'begin_quest_run'
          ? `set role service_role; select public.begin_quest_run((:'p'::jsonb ->> 'p_user')::uuid, (:'p'::jsonb ->> 'p_quest_id')::uuid);`
          : `set role service_role; select public.record_graded_attempt((:'p'::jsonb ->> 'p_user')::uuid, (:'p'::jsonb ->> 'p_quest_id')::uuid,
               :'p'::jsonb ->> 'p_code', (:'p'::jsonb ->> 'p_tests_passed')::int, (:'p'::jsonb ->> 'p_tests_total')::int);`
        try {
          const out = psql(sql, { p: payload })
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(out.split('\n').filter((l) => l !== 'SET').pop())
        } catch (e) {
          const text = String(e.stderr ?? e.message)
          const msg = (text.match(/ERROR:\s+(.*)/) ?? [])[1] ?? 'error'
          return answer(400, { message: msg })
        }
      }
      answer(404, { message: 'unknown' })
    } catch (e) {
      answer(400, { message: String(e.message).slice(0, 300) })
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const BASE = `http://127.0.0.1:${server.address().port}`
const env = (extra = {}) => ({ supabaseUrl: BASE, serviceKey: SERVICE_KEY, runnerUrl: `${BASE}/runner`, runnerKey: RUNNER_KEY, runnerTimeoutMs: 1500, ...extra })

const call = async (token, body, e = env()) => {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await runQuest(new Request('http://x/run-quest', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), e, fetch)
  return { status: response.status, body: await response.json() }
}

let passed = 0
const ok = (message) => { passed++; console.log(`OK ${passed}: ${message}`) }

let Q
try {
  psql(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
      ('${U1}', 'rq1@exemple.sn', '{"provider":"email"}', '{}'),
      ('${U2}', 'rq2@exemple.sn', '{"provider":"email"}', '{}');
    insert into public.quests (slug, title, clan, mastery, language, entry_point, est_minutes, xp_reward, kopek_reward, min_seconds, published)
      values ('rq-quest', 'RQ', 'griot_du_code', 'ndongo', 'python', 'solve', 5, 100, 10, 0, true);
    insert into public.quest_tests (quest_id, position, name, input, expected)
      select id, g, 't' || g, to_jsonb(g), to_jsonb(g * 7) from public.quests, generate_series(1, 3) g where slug = 'rq-quest';
  `)
  Q = psql(`select id from public.quests where slug = 'rq-quest';`)
  const start = (u) => psql(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false); select public.start_quest('${Q}');`)
  const xp = (u) => Number(psql(`select xp from public.profiles where id = '${u}';`))

  // ---- 1. Who is calling ---------------------------------------------------------------------------------
  assert.equal((await call(null, { quest_id: Q, code: 'GOOD' })).status, 401)
  assert.equal((await call('wrong-token', { quest_id: Q, code: 'GOOD' })).status, 401)
  assert.equal(runnerCalls.length, 0, 'nothing runs for an unknown caller')
  ok('callers must be signed in; the runner is not touched otherwise')

  // ---- 2. Bad requests -----------------------------------------------------------------------------------
  assert.equal((await call('token-one', 'not json')).status, 400)
  assert.equal((await call('token-one', { quest_id: Q })).status, 400)
  assert.equal((await call('token-one', { quest_id: Q, code: 'x'.repeat(50001) })).status, 413)
  assert.equal(runnerCalls.length, 0)
  ok('bad bodies and oversized code are refused before anything runs')

  // ---- 3. Not started -------------------------------------------------------------------------------------
  const early = await call('token-one', { quest_id: Q, code: 'GOOD' })
  assert.equal(early.status, 409)
  assert.equal(early.body.error, 'not_started')
  assert.equal(runnerCalls.length, 0)
  ok('a quest that was not started is not run');

  // ---- 4. A failing run pays nothing and never leaks the expected values ------------------------------------------
  start(U1)
  const xp0 = xp(U1)
  const half = await call('token-one', { quest_id: Q, code: 'HALF attempt' })
  assert.equal(half.status, 200)
  assert.equal(half.body.solved, false)
  assert.equal(half.body.tests_passed, 1)
  assert.equal(half.body.tests_total, 3)
  assert.deepEqual(half.body.tests.map((t) => t.passed), [true, false, false])
  assert.equal(JSON.stringify(half.body).includes('expected'), false, 'expected values are never sent back')
  assert.equal(xp(U1), xp0)
  assert.equal(runnerCalls[0].tests[0].expected, 7, 'the runner does get the hidden tests')
  assert.equal(runnerCalls[0].language, 'python')
  assert.equal(runnerCalls[0].entry_point, 'solve', 'the runner is told which function to call')
  ok('a partial run pays nothing, shows pass/fail per test and hides expected values')

  // ---- 5. A crash is reported briefly ----------------------------------------------------------------------
  const boom = await call('token-one', { quest_id: Q, code: 'BOOM' })
  assert.equal(boom.body.solved, false)
  assert.equal(boom.body.tests[0].message, 'ZeroDivisionError: division by zero')
  ok('a crash shows its short message and counts as failed')

  // ---- 6. A runner that lies about names cannot mark tests as passed -------------------------------------------
  const liar = await call('token-one', { quest_id: Q, code: 'LIAR' })
  assert.equal(liar.body.solved, false)
  assert.equal(liar.body.tests_passed, 0)
  ok('results for unknown test names count for nothing')

  // ---- 7. Runner trouble: no result recorded, clear error ---------------------------------------------------------
  const before = psql(`select tests_passed from public.quest_attempts where user_id = '${U1}' and quest_id = '${Q}';`)
  for (const mode of ['down', 'garbage', 'hang']) {
    runnerMode = mode
    const r = await call('token-one', { quest_id: Q, code: 'GOOD' })
    assert.equal(r.status, 502, mode)
    assert.equal(r.body.error, 'runner_unavailable', mode)
  }
  runnerMode = 'ok'
  assert.equal(psql(`select tests_passed from public.quest_attempts where user_id = '${U1}' and quest_id = '${Q}';`), before, 'nothing recorded')
  assert.equal(xp(U1), xp0)
  ok('a down, confused or silent runner gives a clear error and records nothing')

  // ---- 8. The run limit ------------------------------------------------------------------------------------------
  psql(`delete from public.quest_runs where user_id = '${U1}';`)
  let last
  for (let i = 0; i < 7; i++) last = await call('token-one', { quest_id: Q, code: 'HALF' })
  assert.equal(last.status, 429)
  assert.equal(last.body.error, 'too_many_runs')
  ok('the seventh run within a minute is refused')

  // ---- 9. A full pass pays once; the next run is refused ---------------------------------------------------------------
  psql(`delete from public.quest_runs where user_id = '${U1}';`)
  const good = await call('token-one', { quest_id: Q, code: 'GOOD' })
  assert.equal(good.status, 200)
  assert.equal(good.body.solved, true)
  assert.equal(good.body.xp, 100)
  assert.equal(xp(U1), xp0 + 100)
  const again = await call('token-one', { quest_id: Q, code: 'GOOD' })
  assert.equal(again.status, 200)
  assert.equal(again.body.practice, true)
  assert.equal(again.body.already_solved, true)
  assert.equal(again.body.solved, true)
  const worse = await call('token-one', { quest_id: Q, code: 'HALF' })
  assert.equal(worse.status, 200)
  assert.equal(worse.body.practice, true)
  assert.equal(worse.body.solved, false)
  assert.equal(worse.body.tests_passed, 1)
  assert.equal(xp(U1), xp0 + 100, 'no second payment')
  ok('all tests pass: paid once; running again is practice, graded but paid and recorded nowhere')

  // ---- 10. Another player is independent ---------------------------------------------------------------------------------
  start(U2)
  const other = await call('token-two', { quest_id: Q, code: 'HALF' })
  assert.equal(other.body.tests_passed, 1)
  ok('players are independent')

  // ---- 10b. A quest without an entry point is not ready: refused, nothing sent to the runner -------------------------------
  psql(`update public.quests set entry_point = null where id = '${Q}';`)
  const callsBefore = runnerCalls.length
  const notReady = await call('token-two', { quest_id: Q, code: 'GOOD' })
  assert.equal(notReady.status, 409)
  assert.equal(notReady.body.error, 'quest_not_ready')
  assert.equal(runnerCalls.length, callsBefore)
  psql(`update public.quests set entry_point = 'solve' where id = '${Q}';`)
  ok('a quest with no entry point is refused before the runner is called')

  // ---- 11. Setup and CORS ------------------------------------------------------------------------------------------------------
  const unconfigured = await handler(new Request('http://x', { method: 'POST' }), () => undefined, fetch)
  assert.equal(unconfigured.status, 503)
  const preflight = await handler(new Request('http://x', { method: 'OPTIONS' }), () => undefined, fetch)
  assert.equal(preflight.status, 204)
  const getEnv = (n) => ({ SUPABASE_URL: BASE, SUPABASE_SECRET_KEYS: JSON.stringify([SERVICE_KEY]), RUNNER_URL: `${BASE}/runner`, RUNNER_KEY: RUNNER_KEY })[n]
  const viaHandler = await handler(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer token-two' }, body: JSON.stringify({ quest_id: Q, code: 'HALF' }) }), getEnv, fetch)
  assert.equal(viaHandler.status, 200)
  ok('missing settings give a clear error; the browser preflight works; settings are read from the environment')

  console.log(`ALL RUN-QUEST TESTS PASSED (${passed})`)
} finally {
  try {
    psql(`
      delete from public.quest_runs where user_id in ('${U1}', '${U2}');
      delete from public.quests where slug = 'rq-quest';
      delete from auth.users where id in ('${U1}', '${U2}');
    `)
  } catch (e) { console.error('cleanup failed', e.message) }
  server.closeAllConnections?.()
  server.close()
}
