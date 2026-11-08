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
import { handler, runExtras, runPrivateCheck, runSync } from './index.ts'

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
      } else if (name === 'private_projects_to_check') {
        sql = `set role service_role;
          select coalesce(jsonb_agg(t), '[]'::jsonb)
            from public.private_projects_to_check(p_limit := (:'payload'::jsonb ->> 'p_limit')::int) t;`
      } else if (name === 'record_private_check') {
        sql = `set role service_role;
          select to_jsonb(public.record_private_check(
            p_project := (j ->> 'p_project')::uuid,
            p_now_public := (j ->> 'p_now_public')::boolean,
            p_owner_login := j ->> 'p_owner_login'))
          from (select :'payload'::jsonb as j) x;`
      } else if (name === 'projects_for_extras') {
        sql = `set role service_role;
          select coalesce(jsonb_agg(t), '[]'::jsonb)
            from public.projects_for_extras(p_limit := (:'payload'::jsonb ->> 'p_limit')::int) t;`
      } else if (name === 'record_github_extras') {
        sql = `set role service_role;
          select public.record_github_extras(
            p_project := (j ->> 'p_project')::uuid,
            p_build_status := j ->> 'p_build_status',
            p_issues := j -> 'p_issues',
            p_forks := (j ->> 'p_forks')::int,
            p_pushed_at := (j ->> 'p_pushed_at')::timestamptz)
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
let extrasScript = {}
function fakeFetch(url, init = {}) {
  const u = String(url)
  if (!u.startsWith('https://api.github.com/')) return fetch(url, init) // the stand-in for Supabase
  githubCalls.push({ url: u, headers: init.headers ?? {} })
  const sub = u.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(issues|actions\/runs)\?/)
  if (sub) {
    const extra = extrasScript[decodeURIComponent(sub[1]).toLowerCase()]?.[sub[2] === 'issues' ? 'issues' : 'runs']
    if (!extra) return Promise.resolve(new Response('{}', { status: 404 }))
    if (extra === 'network_error') return Promise.reject(new Error('network down'))
    return Promise.resolve(new Response(JSON.stringify(extra.body ?? {}), { status: extra.status, headers: extra.headers ?? {} }))
  }
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

  // ---- 10a. A private project that becomes public on GitHub joins the community list and is rewarded -------------
  psql(`update public.projects set github_synced_at = now();
        select public.adopt_private_project('a9a9a9a9-0000-0000-0000-000000000001', 'secret-app', 'Secret', null, null);
        update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'secret-app';`)
  const state = () => psql(`select repo_private, is_public, verified_at is not null from public.projects where github_repo = 'secret-app';`)
  const xpNow = () => Number(psql(`select xp from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000001';`))
  const xpBefore = xpNow()
  githubScript['sync-ama/secret-app'] = { status: 404 } // still private: GitHub hides it from us
  githubCalls.length = 0
  const still = await runPrivateCheck(env(), fakeFetch)
  assert.deepEqual([still.checked, still.now_public], [1, 0])
  assert.equal(state(), 't|f|t', 'a repository that is still private stays private and untouched')
  assert.equal((await runPrivateCheck(env(), fakeFetch)).checked, 0, 'a private project is looked at once a day')
  ok('a private project that is still private is left alone, and looked at only once a day')

  psql(`update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'secret-app';`)
  githubScript['sync-ama/secret-app'] = found('Sync-Ama', { private: true }) // visible to a token but marked private
  assert.equal((await runPrivateCheck(env(), fakeFetch)).now_public, 0)
  assert.equal(state(), 't|f|t', 'a private repository is never turned public')
  psql(`update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'secret-app';`)
  githubScript['sync-ama/secret-app'] = found('someone-else')
  assert.equal((await runPrivateCheck(env(), fakeFetch)).now_public, 0)
  assert.equal(state(), 't|f|t', 'a repository of another owner changes nothing')
  psql(`update public.projects set github_synced_at = now() - interval '2 days' where github_repo = 'secret-app';`)
  githubScript['sync-ama/secret-app'] = found('sync-ama')
  const turned = await runPrivateCheck(env(), fakeFetch)
  assert.equal(turned.now_public, 1)
  assert.equal(state(), 'f|t|f', 'now a public project waiting for the usual check')
  const confirmed = await runSync(env(), fakeFetch)
  assert.ok(confirmed.verified >= 1)
  assert.equal(state(), 'f|t|t', 'confirmed by the usual check')
  assert.equal(xpNow() - xpBefore, 50, 'the one-time reward is paid')
  ok('a private repository that becomes public on GitHub is listed publicly, confirmed and rewarded once')

  // ---- 10b. Build status and good first issues --------------------------------------------------------------
  const due = (...repos) =>
    psql(`update public.projects set extras_synced_at = now(); update public.projects set extras_synced_at = null where github_repo in (${repos.map((r) => `'${r}'`).join(',')});`)
  const build = (repo) => psql(`select coalesce(build_status, 'unknown') from public.projects where github_repo = '${repo}';`)
  const issueNumbers = (repo) => psql(`select coalesce(string_agg(issue_number::text, ',' order by issue_number), '') from public.project_issues i join public.projects p on p.id = i.project_id where p.github_repo = '${repo}';`)
  const synced = (repo) => psql(`select extras_synced_at is not null from public.projects where github_repo = '${repo}';`)
  const issue = (n, extra = {}) => ({ number: n, title: `Issue ${n}`, comments: 1, html_url: `https://github.com/sync-ama/found-repo/issues/${n}`, created_at: '2026-01-01T00:00:00Z', ...extra })
  const runs = (status, conclusion) => ({ status: 200, body: { workflow_runs: status === null ? [] : [{ status, conclusion }] } })

  githubScript['sync-ama/found-repo'] = found('sync-ama', { default_branch: 'main', forks_count: 18, pushed_at: '2026-11-02T08:30:00Z' })
  githubScript['sync-ama/weird.name_v2'] = found('sync-ama', { default_branch: 'trunk', forks_count: -3, pushed_at: 'not a date' })
  extrasScript = {
    'sync-ama/found-repo': {
      issues: { status: 200, body: [issue(5), issue(6, { pull_request: {} }), issue(7)] },
      runs: runs('completed', 'success'),
    },
    'sync-ama/weird.name_v2': { issues: { status: 200, body: [] }, runs: runs(null) },
  }
  due('found-repo', 'weird.name_v2')
  githubCalls.length = 0
  const x1 = await runExtras(env({ githubToken: 'tok-9' }), fakeFetch)
  assert.equal(x1.checked, 2)
  assert.equal(x1.stopped, null)
  assert.equal(build('found-repo'), 'passing')
  assert.equal(build('weird.name_v2'), 'none', 'a project with no runs is "none"')
  assert.equal(issueNumbers('found-repo'), '5,7', 'pull requests are not issues')
  assert.equal(issueNumbers('weird.name_v2'), '')
  assert.equal(psql(`select github_forks || '|' || to_char(github_pushed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') from public.projects where github_repo = 'found-repo';`), '18|2026-11-02 08:30', 'forks and last push are saved')
  assert.equal(psql(`select github_forks || '|' || coalesce(github_pushed_at::text, 'none') from public.projects where github_repo = 'weird.name_v2';`), '0|none', 'nonsense values are ignored')
  assert.ok(githubCalls.some((c) => c.url.includes('/actions/runs?branch=main&per_page=1&exclude_pull_requests=true')), 'the main branch is asked about')
  assert.ok(githubCalls.some((c) => c.url.includes('/actions/runs?branch=trunk')), 'each project uses its own main branch')
  assert.ok(githubCalls.some((c) => c.url.includes('labels=good%20first%20issue') && c.url.includes('state=open')), 'only open issues with the standard label')
  assert.equal(githubCalls.filter((c) => c.url.includes('/issues?')).length, 2)
  ok('the second pass reads the build status and the open good first issues, without pull requests')

  // Other build results
  for (const [status, conclusion, expected] of [
    ['completed', 'failure', 'failing'], ['completed', 'success', 'passing'], ['completed', 'timed_out', 'failing'],
    ['completed', 'success', 'passing'], ['completed', 'startup_failure', 'failing'],
    ['in_progress', null, 'running'], ['completed', 'success', 'passing'], ['queued', null, 'running'], ['completed', 'success', 'passing'],
  ]) {
    extrasScript['sync-ama/found-repo'].runs = runs(status, conclusion)
    due('found-repo')
    await runExtras(env(), fakeFetch)
    assert.equal(build('found-repo'), expected, `${status}/${conclusion}`)
  }
  extrasScript['sync-ama/found-repo'].runs = runs('completed', 'failure')
  due('found-repo')
  await runExtras(env(), fakeFetch)
  extrasScript['sync-ama/found-repo'].runs = runs('completed', 'cancelled')
  due('found-repo')
  await runExtras(env(), fakeFetch)
  assert.equal(build('found-repo'), 'failing', 'a cancelled run says nothing, so the last value stays')
  ok('success is passing, failure is failing, a run in progress is running, and a cancelled run changes nothing')

  // GitHub trouble leaves what is there, but the project is still marked as looked at
  extrasScript['sync-ama/found-repo'] = { issues: { status: 500 }, runs: { status: 502 } }
  due('found-repo')
  const x2 = await runExtras(env(), fakeFetch)
  assert.equal(x2.skipped, 1)
  assert.equal(build('found-repo'), 'failing', 'the build status stays on an error')
  assert.equal(issueNumbers('found-repo'), '5,7', 'the issues stay on an error')
  assert.equal(synced('found-repo'), 't', 'the project is marked as looked at, so it does not block the others')
  extrasScript['sync-ama/found-repo'] = { issues: 'network_error', runs: 'network_error' }
  due('found-repo')
  await runExtras(env(), fakeFetch)
  assert.equal(issueNumbers('found-repo'), '5,7', 'a network failure keeps the issues too')
  ok('on a GitHub error nothing is erased, and the project still moves to the back of the line')

  // The repository itself is gone or private: nothing is stored from it
  extrasScript['sync-ama/found-repo'] = { issues: { status: 200, body: [issue(9)] }, runs: runs('completed', 'success') }
  githubScript['sync-ama/found-repo'] = found('sync-ama', { default_branch: 'main', private: true })
  due('found-repo')
  githubCalls.length = 0
  await runExtras(env(), fakeFetch)
  assert.equal(githubCalls.length, 1, 'a private repository is not asked any further question')
  assert.equal(issueNumbers('found-repo'), '5,7', 'nothing is taken from a private repository')
  githubScript['sync-ama/found-repo'] = found('sync-ama', { default_branch: 'main' })

  // A link pointing elsewhere is dropped by the database
  extrasScript['sync-ama/found-repo'] = {
    issues: { status: 200, body: [issue(12), issue(13, { html_url: 'https://evil.example/x' })] },
    runs: runs('completed', 'success'),
  }
  due('found-repo')
  await runExtras(env(), fakeFetch)
  assert.equal(issueNumbers('found-repo'), '12', 'a link to another site is dropped')
  ok('a private repository gives nothing, and a link that does not point to the project is dropped')

  // Rate limit: stop, write nothing, the rest waits
  githubScript['sync-ama/weird.name_v2'] = { status: 403, headers: { 'x-ratelimit-remaining': '0' } }
  due('found-repo', 'weird.name_v2')
  psql(`update public.projects set extras_synced_at = now() - interval '9 hours' where github_repo = 'found-repo'; update public.projects set extras_synced_at = null where github_repo = 'weird.name_v2';`)
  githubCalls.length = 0
  const x3 = await runExtras(env(), fakeFetch)
  assert.equal(x3.stopped, 'github_rate_limit')
  assert.equal(synced('weird.name_v2'), 'f', 'the rate-limited project stays on the list')
  ok('on a rate limit the second pass stops and writes nothing for that project')
  githubScript['sync-ama/weird.name_v2'] = found('sync-ama', { default_branch: 'trunk' })

  // Three problems in a row stop the pass
  extrasScript['sync-ama/found-repo'] = { issues: { status: 500 }, runs: { status: 500 } }
  extrasScript['sync-ama/weird.name_v2'] = { issues: { status: 500 }, runs: { status: 500 } }
  psql(`update public.projects set extras_synced_at = now(); update public.projects set extras_synced_at = null where github_repo in ('found-repo','weird.name_v2','flaky-repo','limit-1','limit-2');`)
  githubScript['sync-ama/flaky-repo'] = found('sync-ama', { default_branch: 'main' })
  githubScript['sync-ama/limit-1'] = found('sync-ama', { default_branch: 'main' })
  githubScript['sync-ama/limit-2'] = found('sync-ama', { default_branch: 'main' })
  extrasScript['sync-ama/flaky-repo'] = { issues: { status: 500 }, runs: { status: 500 } }
  extrasScript['sync-ama/limit-1'] = { issues: { status: 500 }, runs: { status: 500 } }
  extrasScript['sync-ama/limit-2'] = { issues: { status: 500 }, runs: { status: 500 } }
  const x4 = await runExtras(env(), fakeFetch)
  assert.equal(x4.stopped, 'github_errors')
  assert.equal(x4.skipped, 3)
  ok('three problems in a row stop the second pass')

  // Time budget
  psql(`update public.projects set extras_synced_at = null where github_repo in ('found-repo','weird.name_v2','flaky-repo');`)
  let clock2 = 0
  const x5 = await runExtras(env(), fakeFetch, () => (clock2 += 30_000))
  assert.equal(x5.stopped, 'time_budget')
  ok('a second pass that takes too long stops cleanly')

  // The main handler runs both passes, and a broken second pass never breaks the first
  psql(`update public.projects set extras_synced_at = null where github_repo = 'weird.name_v2';`)
  extrasScript['sync-ama/weird.name_v2'] = { issues: { status: 200, body: [] }, runs: runs('completed', 'success') }
  const both = await handler(
    new Request('http://localhost/', { method: 'POST', headers: { 'x-cron-secret': CRON_SECRET } }),
    (name) => ({ CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[name],
    fakeFetch,
  )
  assert.equal(both.status, 200)
  assert.ok('extras' in (await both.json()))
  psql(`update public.projects set github_synced_at = now(); update public.projects set extras_synced_at = null where github_repo = 'weird.name_v2';`)
  const thrower = (url, init) => (String(url).includes('projects_for_extras') ? Promise.resolve(new Response('{}', { status: 500 })) : fakeFetch(url, init))
  const partial = await handler(
    new Request('http://localhost/', { method: 'POST', headers: { 'x-cron-secret': CRON_SECRET } }),
    (name) => ({ CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[name],
    thrower,
  )
  assert.equal(partial.status, 200, 'a broken second pass does not fail the run')
  const partialBody = await partial.json()
  assert.ok(partialBody.extras.error, 'but it is reported')
  assert.ok(!JSON.stringify(partialBody).includes(SERVICE_KEY))
  ok('the run does both passes; a failing second pass is reported but never fails the first')

  // ---- 11. Who may start a run --------------------------------------------------------------------------------------------------
  psql(`update public.projects set github_synced_at = now();`)
  const getEnv = (extra = {}) => (name) =>
    ({ CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...extra })[name]
  const post = (headers = {}, method = 'POST') => new Request('http://localhost/', { method, headers })

  const preflight = await handler(post({}, 'OPTIONS'), getEnv(), fakeFetch)
  assert.equal(preflight.status, 204, 'a browser check before the call is answered')
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-cron-secret/)
  assert.equal((await handler(post(), getEnv(), fakeFetch)).status, 401, 'no secret')
  assert.equal((await handler(post({ 'x-cron-secret': 'wrong-secret-0123456789' }), getEnv(), fakeFetch)).status, 401, 'wrong secret')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }, 'GET'), getEnv(), fakeFetch)).status, 405, 'GET is refused')
  assert.equal((await handler(post({ 'x-cron-secret': 'short' }), getEnv({ CRON_SECRET: 'short' }), fakeFetch)).status, 500, 'a weak secret is refused')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_URL: '' }), fakeFetch)).status, 500, 'missing configuration')
  const good = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv(), fakeFetch)
  assert.equal(good.status, 200)
  const goodBody = await good.json()
  assert.deepEqual(Object.keys(goodBody).sort(), ['checked', 'extras', 'hidden', 'private_check', 'skipped', 'stopped', 'verified'])
  assert.deepEqual(Object.keys(goodBody.extras).sort(), ['checked', 'skipped', 'stopped'], 'the second pass reports a short summary too')
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
