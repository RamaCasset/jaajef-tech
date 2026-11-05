// Test for the GitHub checker, against a REAL PostgreSQL database.
//
// Run it AFTER the migrations are applied and the PG* variables point to the
// test database:   node --experimental-strip-types supabase/functions/github-sync/sync.test.mjs
//
// How it works
//   * A pretend GitHub answers for each repository (found, missing, moved,
//     private, blocked, flaky, rate limited...). No real GitHub call is made.
//   * A small stand-in for Supabase's web interface runs the real database
//     functions as the "service_role" user, exactly like the checker would.
//   * Then the database is inspected to see what really happened.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { handler, runSync } from './index.ts'

// ---- helpers -------------------------------------------------------------------

function psql(sql, vars = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  args.push('-f', '-')
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

const SERVICE_KEY = 'test-service-key-0123456789'
const NEW_KEY = 'sb_secret_test0123456789'
const CRON_SECRET = 'test-cron-secret-0123456789'

// Stand-in for the REST interface: POST /rest/v1/rpc/<function>, run as service_role.
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const legacyOk = req.headers.apikey === SERVICE_KEY && req.headers.authorization === `Bearer ${SERVICE_KEY}`
      // Newer secret keys are accepted in the apikey header only (no Authorization header).
      const newOk = req.headers.apikey === NEW_KEY && req.headers.authorization === undefined
      if (!legacyOk && !newOk) return answer(401, { message: 'bad key' })
      const name = req.url.replace('/rest/v1/rpc/', '')
      const payload = Buffer.concat(chunks).toString() || '{}'
      let sql
      if (name === 'projects_to_sync') {
        sql = `set role service_role;
          select coalesce(jsonb_agg(t), '[]'::jsonb)
            from public.projects_to_sync(p_limit := (:'payload'::jsonb ->> 'p_limit')::int) t;`
      } else if (name === 'record_github_sync') {
        sql = `set role service_role;
          select public.record_github_sync(
            p_project := (j ->> 'p_project')::uuid,
            p_exists := (j ->> 'p_exists')::boolean,
            p_owner_login := j ->> 'p_owner_login',
            p_description := j ->> 'p_description',
            p_language := j ->> 'p_language',
            p_stars := (j ->> 'p_stars')::int)
          from (select :'payload'::jsonb as j) x;`
      } else {
        return answer(404, { message: 'unknown function' })
      }
      const out = psql(sql, { payload })
      // psql prints "SET" first for the role change; the answer is the last line.
      const last = out.split('\n').filter((l) => l !== 'SET').pop()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(last)
    } catch (e) {
      answer(400, { message: String(e.message).slice(0, 300) })
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const SUPABASE_URL = `http://127.0.0.1:${server.address().port}`

// Pretend GitHub. Each repo has a scripted answer. Every request is recorded.
const githubCalls = []
let githubScript = {}
let githubSequence = null
function fakeFetch(url, init = {}) {
  const u = String(url)
  if (!u.startsWith('https://api.github.com/')) return fetch(url, init) // the stand-in for Supabase
  githubCalls.push({ url: u, headers: init.headers ?? {} })
  const key = decodeURIComponent(u.replace('https://api.github.com/repos/', '')).toLowerCase()
  // A sequence answers call by call, whatever the repository (the order of unchecked projects is not guaranteed).
  const script = githubSequence ? githubSequence[githubCalls.length - 1] : githubScript[key]
  if (!script) return Promise.resolve(new Response('{}', { status: 404 }))
  if (script === 'network_error') return Promise.reject(new Error('network down'))
  return Promise.resolve(new Response(JSON.stringify(script.body ?? {}), { status: script.status, headers: script.headers ?? {} }))
}
const found = (owner, extra = {}) => ({
  status: 200,
  body: { owner: { login: owner }, description: 'Un super projet', language: 'Python', stargazers_count: 7, private: false, ...extra },
})

const env = (extra = {}) => ({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, cronSecret: CRON_SECRET, ...extra })
const project = (repo) => psql(`select verified_at is not null, github_synced_at is not null, coalesce(github_stars::text, ''), coalesce(language, ''), coalesce(github_description, '') from public.projects where github_repo = '${repo}';`)

let passed = 0
const ok = (message) => { passed++; console.log(`OK ${passed}: ${message}`) }

try {
  // ---- setup: one member signed in with GitHub, and her projects ---------------------
  psql(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama@exemple.sn', '{"provider":"github"}', '{"user_name":"sync-ama"}');
    -- a clean slate: projects left by other tests are marked as checked
    update public.projects set github_synced_at = now();
    insert into public.projects (owner_id, github_owner, github_repo, title) values
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'found-repo', 'Trouve'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'gone-repo', 'Disparu'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'moved-repo', 'Deplace'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'private-repo', 'Prive'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'blocked-repo', 'Bloque'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'flaky-repo', 'Instable'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'weird.name_v2', 'Nom special');
  `)

  githubScript = {
    'sync-ama/found-repo': found('Sync-Ama'),
    'sync-ama/gone-repo': { status: 404 },
    'sync-ama/moved-repo': found('someone-else'),
    'sync-ama/private-repo': found('sync-ama', { private: true }),
    'sync-ama/blocked-repo': { status: 403, headers: { 'x-ratelimit-remaining': '4000' } },
    'sync-ama/flaky-repo': 'network_error',
    'sync-ama/weird.name_v2': found('sync-ama', { stargazers_count: 3 }),
  }

  // ---- 1. A full run ---------------------------------------------------------------------
  const first = await runSync(env({ githubToken: 'tok-123' }), fakeFetch)
  assert.equal(first.stopped, null)
  assert.equal(first.verified, 2, 'two projects should be confirmed')
  assert.equal(first.hidden, 4, 'gone, moved, private and blocked should be hidden')
  assert.equal(first.skipped, 1, 'the flaky one is skipped')
  assert.equal(first.checked, 6)
  ok('a run confirms real repositories, hides the rest and skips the flaky one')

  // ---- 2. What the database did ---------------------------------------------------------------
  assert.equal(project('found-repo'), 't|t|7|Python|Un super projet', 'confirmed project with GitHub details')
  assert.equal(project('weird.name_v2'), 't|t|3|Python|Un super projet', 'unusual repository names work')
  for (const repo of ['gone-repo', 'moved-repo', 'private-repo', 'blocked-repo']) {
    assert.equal(project(repo).slice(0, 3), 'f|t', `${repo} must stay hidden but be marked as checked`)
  }
  assert.equal(project('private-repo'), 'f|t|0||', 'nothing from a private repository is stored')
  ok('the database confirmed two projects, with GitHub details, and stored nothing from a private repository')

  // ---- 3. A network failure never hides or confirms anything ------------------------------------
  assert.equal(project('flaky-repo'), 'f|f|0||', 'the flaky project must be left for the next run')
  ok('a network failure leaves the project untouched for the next run')

  // ---- 4. The reward was paid once per confirmed repository ---------------------------------------
  assert.equal(psql(`select xp from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000001';`), '100', '2 confirmed repositories at 50 XP')
  ok('XP was paid once for each confirmed repository')

  // ---- 5. How GitHub was asked ----------------------------------------------------------------------------
  const call = githubCalls[0]
  assert.match(call.headers['user-agent'], /jaajef/, 'GitHub requires a user agent')
  assert.equal(call.headers.authorization, 'Bearer tok-123', 'the token is sent when there is one')
  assert.ok(githubCalls.some((c) => c.url.endsWith('/repos/sync-ama/weird.name_v2')), 'names are sent unchanged')
  ok('GitHub is asked with a user agent, and the access token when there is one')

  // ---- 6. Only unchecked projects are asked about again -----------------------------------------------------
  githubCalls.length = 0
  githubScript['sync-ama/flaky-repo'] = found('sync-ama', { stargazers_count: 1 })
  const second = await runSync(env(), fakeFetch)
  assert.equal(githubCalls.length, 1, 'only the flaky project was asked about again')
  assert.ok(githubCalls[0].url.endsWith('/flaky-repo'))
  assert.equal(githubCalls[0].headers.authorization, undefined, 'no token header when there is no token')
  assert.equal(second.verified, 1)
  assert.equal(project('flaky-repo'), 't|t|1|Python|Un super projet')
  assert.equal(psql(`select xp from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000001';`), '150')
  ok('the next run only asks about what was left, and a recovered project is confirmed and rewarded')

  // ---- 7. A confirmed project that later disappears is hidden again --------------------------------------------
  psql(`update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'found-repo';`)
  githubScript['sync-ama/found-repo'] = { status: 404 }
  await runSync(env(), fakeFetch)
  assert.equal(project('found-repo').slice(0, 3), 'f|t', 'a deleted repository must be hidden again')
  psql(`update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'found-repo';`)
  githubScript['sync-ama/found-repo'] = found('sync-ama')
  const back = await runSync(env(), fakeFetch)
  assert.equal(back.verified, 1)
  assert.equal(psql(`select xp from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000001';`), '150', 'coming back pays nothing more')
  ok('a deleted repository is hidden again; if it comes back it is shown again with no new reward')

  // ---- 8. Rate limit: stop, do not hide, resume later --------------------------------------------------------------
  psql(`
    update public.projects set github_synced_at = now();
    insert into public.projects (owner_id, github_owner, github_repo, title) values
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'limit-1', 'Limite 1'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'limit-2', 'Limite 2'),
      ('a9a9a9a9-0000-0000-0000-000000000001', 'sync-ama', 'limit-3', 'Limite 3');
    update public.projects set github_synced_at = null where github_repo = 'limit-1';
    update public.projects set github_synced_at = null where github_repo = 'limit-2';
    update public.projects set github_synced_at = null where github_repo = 'limit-3';
  `)
  githubSequence = [found('sync-ama'), { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, found('sync-ama')]
  githubCalls.length = 0
  const limited = await runSync(env(), fakeFetch)
  githubSequence = null
  assert.equal(limited.stopped, 'github_rate_limit')
  assert.equal(limited.verified, 1)
  assert.equal(githubCalls.length, 2, 'after the rate limit nothing else is asked')
  assert.equal(psql(`select count(*) from public.projects where github_repo like 'limit-%' and github_synced_at is null;`), '2', 'the rate-limited project and the one never asked stay unchecked')
  assert.equal(psql(`select count(*) from public.projects where github_repo like 'limit-%' and verified_at is null and github_synced_at is not null;`), '0', 'nothing was wrongly hidden')
  ok('on a rate limit the run stops, nothing is wrongly hidden, and the rest waits for the next run')

  // ---- 9. Repeated GitHub errors stop the run ---------------------------------------------------------------------------
  psql(`update public.projects set github_synced_at = now(); update public.projects set github_synced_at = null where github_repo in ('limit-1','limit-2','limit-3');`)
  githubScript['sync-ama/limit-1'] = 'network_error'
  githubScript['sync-ama/limit-2'] = { status: 502 }
  githubScript['sync-ama/limit-3'] = { status: 500 }
  const errors = await runSync(env(), fakeFetch)
  assert.equal(errors.stopped, 'github_errors')
  assert.equal(errors.checked, 0)
  assert.equal(errors.skipped, 3)
  ok('three errors in a row stop the run without changing anything')

  // ---- 10. Time budget ------------------------------------------------------------------------------------------------------
  psql(`update public.projects set github_synced_at = now(); update public.projects set github_synced_at = null where github_repo in ('limit-1','limit-2','limit-3');`)
  githubScript['sync-ama/limit-1'] = found('sync-ama')
  githubScript['sync-ama/limit-2'] = found('sync-ama')
  githubScript['sync-ama/limit-3'] = found('sync-ama')
  let clock = 0
  const slow = await runSync(env(), fakeFetch, () => (clock += 60_000))
  assert.equal(slow.stopped, 'time_budget')
  assert.ok(slow.checked < 3, 'the run must stop before doing everything')
  ok('a run that takes too long stops cleanly')

  // ---- 11. Who may start a run --------------------------------------------------------------------------------------------------
  psql(`update public.projects set github_synced_at = now();`)
  const getEnv = (extra = {}) => (name) =>
    ({ CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...extra })[name]
  const post = (headers = {}, method = 'POST') => new Request('http://localhost/', { method, headers })

  assert.equal((await handler(post(), getEnv(), fakeFetch)).status, 401, 'no secret')
  assert.equal((await handler(post({ 'x-cron-secret': 'wrong-secret-0123456789' }), getEnv(), fakeFetch)).status, 401, 'wrong secret')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }, 'GET'), getEnv(), fakeFetch)).status, 405, 'GET is refused')
  assert.equal((await handler(post({ 'x-cron-secret': 'short' }), getEnv({ CRON_SECRET: 'short' }), fakeFetch)).status, 500, 'a weak secret is refused')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_URL: '' }), fakeFetch)).status, 500, 'missing configuration')
  const good = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv(), fakeFetch)
  assert.equal(good.status, 200)
  assert.deepEqual(Object.keys(await good.json()).sort(), ['checked', 'hidden', 'skipped', 'stopped', 'verified'])
  ok('only a caller with the secret can start a run; the answer is a short summary')

  // ---- 11b. Projects on newer Supabase versions provide the key as a list ----------------------------------------------------------
  psql(`update public.projects set github_synced_at = null where github_repo = 'limit-1';`)
  githubScript['sync-ama/limit-1'] = found('sync-ama')
  const newStyle = await handler(
    post({ 'x-cron-secret': CRON_SECRET }),
    getEnv({ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW_KEY }) }),
    fakeFetch,
  )
  assert.equal(newStyle.status, 200, 'the newer key format must work')
  assert.equal((await newStyle.json()).checked, 1)
  ok('the checker works with the newer secret key format too')

  // ---- 12. A broken database key fails loudly, without leaking details ---------------------------------------------------------------
  psql(`update public.projects set github_synced_at = null where github_repo = 'limit-1';`)
  const broken = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_SERVICE_ROLE_KEY: 'wrong-key-0123456789' }), fakeFetch)
  assert.equal(broken.status, 500)
  const brokenText = await broken.text()
  assert.ok(!brokenText.includes('wrong-key'), 'the key must never appear in an answer')
  ok('a wrong database key gives a plain error that never shows the key')

  console.log(`ALL GITHUB CHECKER TESTS PASSED (${passed})`)
} catch (error) {
  console.error('FAIL:', error.message)
  process.exitCode = 1
} finally {
  server.close()
}
