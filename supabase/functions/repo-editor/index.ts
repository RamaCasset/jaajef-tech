// jaajef.tech - Code editor server part (Supabase Edge Function)
//
// What it does, for a signed-in member (POST, JSON, { action, ... }):
//   status   -> is the GitHub app installed on the member's account? (and the address to install it)
//   repos    -> the repositories the member allowed the app to touch
//   tree     -> the files of one allowed repository (default branch)
//   file     -> the text of one file
//   commit   -> save changes to files as ONE commit on a branch
//   adopt    -> list one PRIVATE repository of the member on the platform (stays private)
//
// Safety rules, all enforced here (never in the browser):
//   * Who the member is comes from their sign-in token. Their GitHub name comes from the database
//     (copied from a verified GitHub login), never from the request.
//   * Only repositories owned by that GitHub name can be used (first version: no organisations).
//   * The app's private key never leaves this function. Each GitHub token it makes is limited to the
//     ONE repository asked for, and to read-only unless the action is a commit.
//   * Paths are checked (no "..", no ".git" folder), sizes are capped, and a commit is refused
//     (nothing is overwritten) if the branch moved since the editor loaded it.
//
// Secrets: GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY (see docs/GITHUB_APP_SETUP.md).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS) are provided by Supabase itself.

type Env = { supabaseUrl: string; serviceKey: string; appId: string; appSlug: string; privateKey: string; githubApi: string }
type Fail = { error: string; status: number }

const NAME = /^[A-Za-z0-9._-]{1,100}$/
const MAX_FILES = 20
const MAX_FILE_CHARS = 1_000_000
const MAX_TOTAL_CHARS = 3_000_000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}
const fail = (error: string, status: number): Fail => ({ error, status })
const isFail = (x: unknown): x is Fail => typeof x === 'object' && x !== null && 'error' in x && 'status' in x

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

// ---- The app's identity: a short-lived signed token (JWT, RS256) ---------------------------------------
function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let s = ''
  for (const b of data) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function derLength(n: number): number[] {
  if (n < 128) return [n]
  const bytes: number[] = []
  let v = n
  while (v > 0) { bytes.unshift(v & 255); v >>= 8 }
  return [0x80 | bytes.length, ...bytes]
}
function der(tag: number, content: number[] | Uint8Array): number[] {
  return [tag, ...derLength(content.length), ...content]
}

/** GitHub gives a "BEGIN RSA PRIVATE KEY" (PKCS#1) file; the crypto API wants PKCS#8. This wraps it. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithm = der(0x30, [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
  return new Uint8Array(der(0x30, [...der(0x02, [0]), ...algorithm, ...der(0x04, pkcs1)]))
}

function pemToDer(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const text = pem.replace(/\\n/g, '\n')
  const pkcs1 = text.includes('BEGIN RSA PRIVATE KEY')
  const body = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const raw = atob(body)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { der: bytes, pkcs1 }
}

export async function appJwt(env: Pick<Env, 'appId' | 'privateKey'>, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const { der: keyBytes, pkcs1 } = pemToDer(env.privateKey)
  const key = await crypto.subtle.importKey(
    'pkcs8', pkcs1 ? pkcs1ToPkcs8(keyBytes) : keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: env.appId }))
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`)))
  return `${head}.${claims}.${b64url(signature)}`
}

// ---- Talking to GitHub and to the database -------------------------------------------------------------
type Ctx = { env: Env; fetchFn: typeof fetch }

async function gh(ctx: Ctx, method: string, path: string, token: string, body?: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  let response: Response
  try {
    response = await ctx.fetchFn(`${ctx.env.githubApi}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'jaajef-tech-editor',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 0, body: null }
  }
  let parsed: any = null
  try { parsed = await response.json() } catch { parsed = null }
  return { ok: response.ok, status: response.status, body: parsed }
}

function dbHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { apikey: env.serviceKey }
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
}

async function whoIs(token: string, ctx: Ctx): Promise<string | null> {
  const response = await ctx.fetchFn(`${ctx.env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: ctx.env.serviceKey, authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  const user = await response.json()
  return typeof user?.id === 'string' ? user.id : null
}

async function githubNameOf(userId: string, ctx: Ctx): Promise<string | null> {
  const response = await ctx.fetchFn(
    `${ctx.env.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=github_username`, { headers: dbHeaders(ctx.env) })
  if (!response.ok) return null
  const rows = await response.json()
  const name = Array.isArray(rows) ? rows[0]?.github_username : null
  return typeof name === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(name) ? name : null
}

/** The installation of the app on this member's own GitHub account, or null. */
async function findInstallation(owner: string, ctx: Ctx): Promise<number | null | Fail> {
  const jwt = await appJwt(ctx.env)
  for (let page = 1; page <= 5; page++) {
    const r = await gh(ctx, 'GET', `/app/installations?per_page=100&page=${page}`, jwt)
    if (!r.ok) return fail('github_failed', 502)
    const list = Array.isArray(r.body) ? r.body : []
    const mine = list.find((i: any) => String(i?.account?.login ?? '').toLowerCase() === owner.toLowerCase() && i?.account?.type === 'User')
    if (mine) return Number(mine.id)
    if (list.length < 100) break
  }
  return null
}

/** A token for ONE repository. Read-only unless `write`. */
async function repoToken(installation: number, repo: string, write: boolean, ctx: Ctx): Promise<string | Fail> {
  const jwt = await appJwt(ctx.env)
  const r = await gh(ctx, 'POST', `/app/installations/${installation}/access_tokens`, jwt, {
    repositories: [repo], permissions: { contents: write ? 'write' : 'read' },
  })
  if (r.status === 404 || r.status === 422) return fail('repo_not_allowed', 403)
  if (!r.ok || typeof r.body?.token !== 'string') return fail('github_failed', 502)
  return r.body.token
}

// ---- Checks on what the member sends --------------------------------------------------------------------
export function cleanPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return null
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0')) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p.toLowerCase() === '.git')) return null
  return path
}

type FileChange = { path: string; content?: string; delete?: boolean }
function cleanChanges(raw: unknown): FileChange[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FILES) return null
  const seen = new Set<string>()
  const out: FileChange[] = []
  let total = 0
  for (const item of raw) {
    const path = cleanPath(item?.path)
    if (!path || seen.has(path)) return null
    seen.add(path)
    if (item.delete === true) { out.push({ path, delete: true }); continue }
    if (typeof item.content !== 'string' || item.content.length > MAX_FILE_CHARS) return null
    total += item.content.length
    if (total > MAX_TOTAL_CHARS) return null
    out.push({ path, content: item.content })
  }
  return out
}

// ---- Actions ----------------------------------------------------------------------------------------------
async function doStatus(owner: string, ctx: Ctx): Promise<unknown | Fail> {
  const found = await findInstallation(owner, ctx)
  if (isFail(found)) return found
  return { installed: found !== null, install_url: `https://github.com/apps/${ctx.env.appSlug}/installations/new`, github_name: owner }
}

async function doRepos(owner: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const jwt = await appJwt(ctx.env)
  const minted = await gh(ctx, 'POST', `/app/installations/${installation}/access_tokens`, jwt, { permissions: { contents: 'read' } })
  if (!minted.ok || typeof minted.body?.token !== 'string') return fail('github_failed', 502)
  const r = await gh(ctx, 'GET', '/installation/repositories?per_page=100', minted.body.token)
  if (!r.ok) return fail('github_failed', 502)
  const repos = (Array.isArray(r.body?.repositories) ? r.body.repositories : [])
    .filter((x: any) => String(x?.owner?.login ?? '').toLowerCase() === owner.toLowerCase())
    .map((x: any) => ({ name: String(x.name), private: Boolean(x.private), default_branch: String(x.default_branch ?? 'main') }))
  return { repos }
}

/** List a private repository on the platform. The proof of ownership is that the member installed the app on it. */
async function doAdopt(userId: string, owner: string, repo: string, title: string | null, summary: string | null, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (info.status === 404) return fail('repo_not_found', 404)
  if (!info.ok) return fail('github_failed', 502)
  if (String(info.body?.owner?.login ?? '').toLowerCase() !== owner.toLowerCase()) return fail('repo_not_found', 404)
  // A public repository goes through the normal list (it is confirmed by the public checker).
  if (info.body?.private !== true) return fail('repo_is_public', 409)
  const description = typeof info.body?.description === 'string' ? info.body.description : null
  const response = await ctx.fetchFn(`${ctx.env.supabaseUrl}/rest/v1/rpc/adopt_private_project`, {
    method: 'POST',
    headers: { ...dbHeaders(ctx.env), 'content-type': 'application/json' },
    body: JSON.stringify({
      p_owner: userId,
      p_repo: String(info.body?.name ?? repo),
      p_title: title ?? repo,
      p_summary: summary ?? description,
      p_language: typeof info.body?.language === 'string' ? info.body.language : null,
    }),
  })
  if (!response.ok) {
    let message = ''
    try { message = String((await response.json())?.message ?? '') } catch { message = '' }
    if (message.includes('already listed')) return fail('already_listed', 409)
    if (message.includes('limit')) return fail('limit_reached', 409)
    return fail('failed', 502)
  }
  return { project_id: await response.json() }
}

async function doTree(owner: string, repo: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (info.status === 404) return fail('repo_not_found', 404)
  if (!info.ok) return fail('github_failed', 502)
  const branch = String(info.body?.default_branch ?? 'main')
  const ref = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token)
  if (ref.status === 404 || ref.status === 409) return { branch, head: null, entries: [], truncated: false }
  if (!ref.ok) return fail('github_failed', 502)
  const head = String(ref.body?.object?.sha ?? '')
  const tree = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/trees/${head}?recursive=1`, token)
  if (!tree.ok) return fail('github_failed', 502)
  const entries = (Array.isArray(tree.body?.tree) ? tree.body.tree : [])
    .filter((e: any) => e.type === 'blob' || e.type === 'tree')
    .map((e: any) => ({ path: String(e.path), type: e.type, size: Number(e.size ?? 0) }))
  return { branch, head, entries, truncated: Boolean(tree.body?.truncated) }
}

async function doFile(owner: string, repo: string, path: string, ref: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const r = await gh(ctx, 'GET', `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, token)
  if (r.status === 404) return fail('file_not_found', 404)
  if (!r.ok || r.body?.type !== 'file' || r.body?.encoding !== 'base64') return fail('github_failed', 502)
  if (Number(r.body.size) > MAX_FILE_CHARS) return fail('file_too_big', 413)
  const raw = atob(String(r.body.content).replace(/\s+/g, ''))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { path, content: new TextDecoder().decode(bytes) }
}

async function doCommit(
  owner: string, repo: string, branch: string, baseSha: string, message: string, changes: FileChange[], ctx: Ctx,
): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, true, ctx)
  if (isFail(token)) return token
  const base = `/repos/${owner}/${repo}`

  const ref = await gh(ctx, 'GET', `${base}/git/ref/heads/${encodeURIComponent(branch)}`, token)
  if (ref.status === 404) return fail('branch_not_found', 404)
  if (!ref.ok) return fail('github_failed', 502)
  const head = String(ref.body?.object?.sha ?? '')
  if (head !== baseSha) return fail('branch_moved', 409)

  const commit = await gh(ctx, 'GET', `${base}/git/commits/${head}`, token)
  if (!commit.ok) return fail('github_failed', 502)

  const tree: unknown[] = []
  for (const change of changes) {
    if (change.delete) { tree.push({ path: change.path, mode: '100644', type: 'blob', sha: null }); continue }
    const blob = await gh(ctx, 'POST', `${base}/git/blobs`, token, { content: change.content, encoding: 'utf-8' })
    if (!blob.ok) return fail('github_failed', 502)
    tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.body.sha })
  }
  const newTree = await gh(ctx, 'POST', `${base}/git/trees`, token, { base_tree: commit.body?.tree?.sha, tree })
  if (!newTree.ok) return fail('github_failed', 502)
  const created = await gh(ctx, 'POST', `${base}/git/commits`, token, {
    message: `${message}\n\nSaved from jaajef.tech by @${owner}`, tree: newTree.body.sha, parents: [head],
  })
  if (!created.ok) return fail('github_failed', 502)
  const moved = await gh(ctx, 'PATCH', `${base}/git/refs/heads/${encodeURIComponent(branch)}`, token, { sha: created.body.sha, force: false })
  if (moved.status === 422 || moved.status === 409) return fail('branch_moved', 409)
  if (!moved.ok) return fail('github_failed', 502)
  return { commit_sha: String(created.body.sha), html_url: `https://github.com/${owner}/${repo}/commit/${created.body.sha}` }
}

// ---- Entry point -----------------------------------------------------------------------------------------------
export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    appId: getEnv('GITHUB_APP_ID') ?? '',
    appSlug: getEnv('GITHUB_APP_SLUG') ?? '',
    privateKey: getEnv('GITHUB_APP_PRIVATE_KEY') ?? '',
    githubApi: getEnv('GITHUB_API_URL') || 'https://api.github.com',
  }
  const ctx: Ctx = { env, fetchFn }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!env.appId || !env.appSlug || !env.privateKey || !env.serviceKey || !env.supabaseUrl) return jsonResponse({ error: 'not_configured' }, 503)

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse({ error: 'not_signed_in' }, 401)
  const userId = await whoIs(token, ctx)
  if (!userId) return jsonResponse({ error: 'not_signed_in' }, 401)

  let body: any
  try { body = await request.json() } catch { return jsonResponse({ error: 'bad_request' }, 400) }
  if (typeof body !== 'object' || body === null) return jsonResponse({ error: 'bad_request' }, 400)

  const owner = await githubNameOf(userId, ctx)
  if (!owner) return jsonResponse({ error: 'github_not_linked' }, 409)

  const needRepo = (): string | null => (typeof body.repo === 'string' && NAME.test(body.repo) ? body.repo : null)
  let result: unknown | Fail
  try {
    switch (body.action) {
      case 'status': result = await doStatus(owner, ctx); break
      case 'repos': result = await doRepos(owner, ctx); break
      case 'tree': {
        const repo = needRepo()
        result = repo ? await doTree(owner, repo, ctx) : fail('bad_request', 400)
        break
      }
      case 'file': {
        const repo = needRepo()
        const path = cleanPath(body.path)
        const ref = typeof body.ref === 'string' && body.ref.length > 0 && body.ref.length <= 200 ? body.ref : null
        result = repo && path && ref ? await doFile(owner, repo, path, ref, ctx) : fail('bad_request', 400)
        break
      }
      case 'adopt': {
        const repo = needRepo()
        const title = typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 100 ? body.title.trim() : null
        const summary = typeof body.summary === 'string' && body.summary.length <= 300 ? body.summary : null
        result = repo ? await doAdopt(userId, owner, repo, title, summary, ctx) : fail('bad_request', 400)
        break
      }
      case 'commit': {
        const repo = needRepo()
        const changes = cleanChanges(body.files)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        const branch = typeof body.branch === 'string' && /^[A-Za-z0-9._\/-]{1,100}$/.test(body.branch) ? body.branch : null
        const baseSha = typeof body.base_sha === 'string' && /^[0-9a-f]{40}$/.test(body.base_sha) ? body.base_sha : null
        result = repo && changes && branch && baseSha && message.length > 0 && message.length <= 500
          ? await doCommit(owner, repo, branch, baseSha, message, changes, ctx)
          : fail('bad_request', 400)
        break
      }
      default: result = fail('bad_request', 400)
    }
  } catch {
    return jsonResponse({ error: 'failed' }, 500)
  }
  if (isFail(result)) return jsonResponse({ error: result.error }, result.status)
  return jsonResponse(result)
}

// Supabase starts the function here. Tests import `handler` instead.
declare const Deno: { serve: (fn: (r: Request) => Promise<Response>) => void; env: { get: (n: string) => string | undefined } } | undefined
if (typeof Deno !== 'undefined' && Deno && typeof Deno.serve === 'function') {
  Deno.serve((request) => handler(request, (name) => Deno.env.get(name)))
}
