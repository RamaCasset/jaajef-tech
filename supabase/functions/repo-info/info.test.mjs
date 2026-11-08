// Test for repo-info. No database and no network: a pretend Supabase and a pretend GitHub answer in memory.
//
//   node --experimental-strip-types supabase/functions/repo-info/info.test.mjs

import assert from 'node:assert/strict'
import { cleanPath, handler } from './index.ts'

const SERVICE_KEY = 'test-service-key-0123456789'
const P_PUBLIC = 'a0000000-0000-0000-0000-000000000001'
const P_HIDDEN = 'a0000000-0000-0000-0000-000000000002'
const P_MISSING = 'a0000000-0000-0000-0000-000000000009'
const PROJECTS = {
  [P_PUBLIC]: { github_owner: 'awa', github_repo: 'appli', is_public: true, staff_hidden: false },
  [P_HIDDEN]: { github_owner: 'bob', github_repo: 'secret', is_public: true, staff_hidden: true },
}
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, GITHUB_TOKEN: 'ghp_test' }
const getEnv = (extra = {}) => (n) => ({ ...env, ...extra })[n]

let graphqlCalls
let githubDown
const fakeFetch = async (url, init = {}) => {
  url = String(url)
  if (url === 'https://db.test/auth/v1/user') {
    return init.headers.authorization === 'Bearer good' ? Response.json({ id: 'u1' }) : new Response('{}', { status: 401 })
  }
  if (url.startsWith('https://db.test/rest/v1/projects?')) {
    const id = new URL(url).searchParams.get('id').replace('eq.', '')
    const row = PROJECTS[id]
    const wanted = new URL(url).searchParams
    const ok = row && row.is_public && (wanted.get('staff_hidden') !== 'eq.false' || !row.staff_hidden)
    return Response.json(ok ? [{ github_owner: row.github_owner, github_repo: row.github_repo }] : [])
  }
  if (url === 'https://api.github.com/graphql') {
    graphqlCalls.push(JSON.parse(init.body))
    if (githubDown) return new Response('{}', { status: 502 })
    const { variables } = JSON.parse(init.body)
    const target = {}
    for (const [k, v] of Object.entries(variables)) {
      if (!k.startsWith('p')) continue
      target[k] = { nodes: v === 'nofile.txt' ? [] : [{ messageHeadline: `Message pour ${v}`, committedDate: '2026-11-03T10:00:00Z' }] }
    }
    return Response.json({ data: { repository: { defaultBranchRef: { target } } } })
  }
  throw new Error('unexpected call ' + url)
}

const call = (body, { token = 'good', method = 'POST', e = getEnv() } = {}) =>
  handler(new Request('https://f.test/', { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }), e, fakeFetch)

let n = 0
const test = async (name, fn) => { graphqlCalls = []; githubDown = false; await fn(); n++; console.log(`OK ${n}: ${name}`) }

await test('answers the browser pre-check', async () => {
  const r = await handler(new Request('https://f.test/', { method: 'OPTIONS' }), getEnv(), fakeFetch)
  assert.equal(r.status, 204)
  assert.match(r.headers.get('access-control-allow-headers'), /x-client-info/)
})
await test('refuses anyone who is not signed in', async () => {
  const r = await call({ project_id: P_PUBLIC, paths: ['main.py'] }, { token: 'bad' })
  assert.equal(r.status, 401)
  assert.equal(graphqlCalls.length, 0)
})
await test('refuses when it is not configured', async () => {
  const r = await call({ project_id: P_PUBLIC, paths: ['main.py'] }, { e: getEnv({ GITHUB_TOKEN: '' }) })
  assert.equal(r.status, 503)
})
await test('returns the last message and date of each path with ONE call to GitHub', async () => {
  const r = await call({ project_id: P_PUBLIC, paths: ['main.py', 'src', 'nofile.txt'] })
  assert.equal(r.status, 200)
  const { commits } = await r.json()
  assert.deepEqual(commits['main.py'], { message: 'Message pour main.py', date: '2026-11-03T10:00:00Z' })
  assert.equal(commits.src.message, 'Message pour src')
  assert.equal(commits['nofile.txt'], undefined)
  assert.equal(graphqlCalls.length, 1)
})
await test('the owner, the repository and the paths go in as variables, never inside the query text', async () => {
  await call({ project_id: P_PUBLIC, paths: ['a"b) { evil }'] })
  const sent = graphqlCalls[0]
  assert.equal(sent.variables.owner, 'awa')
  assert.equal(sent.variables.name, 'appli')
  assert.equal(sent.variables.p0, 'a"b) { evil }')
  assert.ok(!sent.query.includes('evil'))
  assert.ok(!sent.query.includes('awa'))
})
await test('only projects in our own database are looked up', async () => {
  assert.equal((await call({ project_id: P_MISSING, paths: ['main.py'] })).status, 404)
  assert.equal((await call({ project_id: P_HIDDEN, paths: ['main.py'] })).status, 404)
  assert.equal(graphqlCalls.length, 0)
})
await test('refuses bad requests before doing anything', async () => {
  for (const body of [
    { project_id: 'nope', paths: ['a'] },
    { project_id: P_PUBLIC, paths: [] },
    { project_id: P_PUBLIC, paths: ['../x'] },
    { project_id: P_PUBLIC, paths: ['.git/config'] },
    { project_id: P_PUBLIC, paths: Array.from({ length: 41 }, (_, i) => `f${i}`) },
    { project_id: P_PUBLIC },
  ]) assert.equal((await call(body)).status, 400)
  assert.equal(graphqlCalls.length, 0)
})
await test('says so when GitHub is down, without crashing', async () => {
  githubDown = true
  const r = await call({ project_id: P_PUBLIC, paths: ['main.py'] })
  assert.equal(r.status, 502)
})
await test('only POST is accepted', async () => {
  assert.equal((await call(null, { method: 'GET' })).status, 405)
})
await test('path checks', async () => {
  assert.equal(cleanPath('src/a.py'), 'src/a.py')
  for (const bad of ['', '/a', 'a/', 'a//b', 'a/../b', '.git/x', 'a\\b', 5]) assert.equal(cleanPath(bad), null)
})
console.log(`ALL ${n} REPO INFO TESTS PASSED`)
