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
const TOKENS = { 't-awa': U.awa, 't-cara': U.cara, 't-nolink': U.nolink }
const GITHUB_NAMES = { [U.awa]: 'awa', [U.cara]: 'cara', [U.nolink]: null }

const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const pkcs8 = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

const sha = (s) => createHash('sha1').update(s).digest('hex')

// ---- The pretend GitHub ---------------------------------------------------------------------------------------
let gh
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
      'awa/appli': { default_branch: 'main', private: true, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {} },
      'awa/vide': { default_branch: 'main', private: false, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {} },
      'bob/secret': { default_branch: 'main', private: true, head: null, commits: new Map(), trees: new Map(), blobs: new Map(), files: {} },
    },
    moveBeforeRefUpdate: false,
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
  const writing = method !== 'GET'
  if (writing && grant.permissions?.contents !== 'write') return jsonRes(403, { message: 'Resource not accessible by integration' })

  if (rest === '' && method === 'GET') return jsonRes(200, { default_branch: repo.default_branch })
  let r = rest.match(/^\/git\/ref\/heads\/(.+)$/)
  if (r && method === 'GET') {
    if (!repo.head || decodeURIComponent(r[1]) !== repo.default_branch) return jsonRes(repo.head ? 404 : 409, { message: 'Git Repository is empty.' })
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
    const base = repo.trees.get(repo.commits.get(repo.head).tree)
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
    if (url.pathname === '/rest/v1/profiles') {
      if (init.headers?.apikey !== SERVICE_KEY) return jsonRes(401, {})
      const id = url.searchParams.get('id').replace('eq.', '')
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

await test('when GitHub is down the member gets a clear error, not a crash', async () => {
  gh.down = true
  const r = await call('t-awa', { action: 'tree', repo: 'appli' })
  assert.ok([500, 502].includes(r.status))
  assert.ok(r.json.error)
})

console.log(`ALL ${n} REPO EDITOR TESTS PASSED`)
