// jaajef.tech - Code editor server part (Supabase Edge Function)
//
// What it does, for a signed-in member (POST, JSON, { action, ... }):
//   status   -> is the GitHub app installed on the member's account? (and the address to install it)
//   repos    -> the repositories the member allowed the app to touch
//   tree     -> the files of one allowed repository (default branch)
//   file     -> the text of one file
//   commit   -> save changes to files as ONE commit on a branch
//   presence -> flag the member's private projects whose repository the app can no longer see
//   history  -> the commits of a repository (optionally of one file)
//   tree / file / history also accept { project }: the owner AND the collaborators of that project
//             can read its code through the owner's installation (read-only)
//   adopt    -> list one PRIVATE repository of the member on the platform (stays private)
//   branches -> the branches of a project's repository (owner and collaborators)
//   tree also accepts { branch } to read another branch than the default one
//   blob     -> one file as base64 (for image previews), up to 1 MB
//   search   -> text search across the files of a branch (owner and collaborators), plain text, capped
//   commit files may also be { path, content_base64 } (an uploaded file, up to 1 MB) or
//             { path, move_from } (rename or move a file, whatever its kind) next to the usual { path, content } / { path, delete }
//   Every member is limited to EDITOR_RATE_PER_MINUTE calls per minute (default 120; a search counts 10).
//   prs      -> the open proposals (pull requests) of a project, from branches of the same repository
//   pr_open  -> propose a branch to the main code (owner: any branch; collaborator: only their own)
//   pr_merge -> merge a proposal into the main code (owner only)
//   pr_close -> close a proposal (owner, or the member who made it)
//   After a proposal is opened, merged or declined, the owner or the author is told (notify_proposal, best effort).
//   commit also accepts { project }: the owner may save to any branch; a collaborator only to a branch
//             that starts with their own username and a slash (never the main code). { create_from }
//             makes the branch first, from that branch, in the same call.
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF = /^[A-Za-z0-9._\/-]{1,100}$/
const MAX_FILES = 20
const MAX_FILE_CHARS = 1_000_000
const MAX_TOTAL_CHARS = 3_000_000
const MAX_BINARY_B64 = 1_400_000 // about 1 MB once decoded
const B64 = /^[A-Za-z0-9+/]*={0,2}$/
const SEARCH_MAX_FILES = 150
const SEARCH_MAX_FILE_BYTES = 100_000
const SEARCH_MAX_TOTAL_BYTES = 4_000_000
const SEARCH_MAX_MATCHES = 100
const SEARCH_SKIP = /(^|\/)(node_modules|\.git|dist|build|\.next|venv|__pycache__|vendor)\//
const BINARY_FILE = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|woff2?|ttf|otf|mp[34]|mov|wasm|exe|bin|so|dll|class|jar|lock)$/i

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
async function repoToken(installation: number, repo: string, write: boolean, ctx: Ctx, pulls: 'read' | 'write' | null = null): Promise<string | Fail> {
  const jwt = await appJwt(ctx.env)
  const r = await gh(ctx, 'POST', `/app/installations/${installation}/access_tokens`, jwt, {
    repositories: [repo], permissions: { contents: write ? 'write' : 'read', ...(pulls ? { pull_requests: pulls } : {}) },
  })
  // The owner accepted the app before it could handle proposals: GitHub says the permission is not granted yet.
  if (r.status === 422 && pulls && /permission/i.test(String(r.body?.message ?? ''))) return fail('pulls_permission_missing', 409)
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

type FileChange = { path: string; content?: string; content_base64?: string; delete?: boolean; move_from?: string }
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
    if (typeof item.move_from === 'string') {
      // A rename or move: the file keeps its content (any kind of file), only its path changes.
      const from = cleanPath(item.move_from)
      if (!from || from === path || seen.has(from) || item.content !== undefined || item.content_base64 !== undefined) return null
      seen.add(from)
      out.push({ path, move_from: from })
      continue
    }
    if (typeof item.content_base64 === 'string') {
      if (item.content !== undefined || item.content_base64.length > MAX_BINARY_B64 || !B64.test(item.content_base64) || item.content_base64.length % 4 !== 0) return null
      total += item.content_base64.length
      if (total > MAX_TOTAL_CHARS) return null
      out.push({ path, content_base64: item.content_base64 })
      continue
    }
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

/** Who the project belongs to and which repository it is, but only if the caller is the owner or a collaborator. */
async function memberProject(userId: string, projectId: string, ctx: Ctx): Promise<{ owner: string; repo: string; isOwner: boolean } | null> {
  const response = await ctx.fetchFn(`${ctx.env.supabaseUrl}/rest/v1/rpc/project_for_member`, {
    method: 'POST',
    headers: { ...dbHeaders(ctx.env), 'content-type': 'application/json' },
    body: JSON.stringify({ p_user: userId, p_project: projectId }),
  })
  if (!response.ok) return null
  const rows = await response.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row || !NAME.test(String(row.github_owner)) || !NAME.test(String(row.github_repo))) return null
  return { owner: String(row.github_owner), repo: String(row.github_repo), isOwner: row.is_owner === true }
}

/** The platform username of a member (letters, digits and underscores only, so it is safe inside a branch name). */
async function usernameOf(userId: string, ctx: Ctx): Promise<string | null> {
  const response = await ctx.fetchFn(
    `${ctx.env.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=username`, { headers: dbHeaders(ctx.env) })
  if (!response.ok) return null
  const rows = await response.json()
  const name = Array.isArray(rows) ? rows[0]?.username : null
  return typeof name === 'string' && /^[a-z0-9_]{3,30}$/.test(name) ? name : null
}

/** The latest commits of a branch, or only the ones that changed one file. */
async function doHistory(owner: string, repo: string, ref: string | null, path: string | null, page: number, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const query = new URLSearchParams({ per_page: '30', page: String(page) })
  if (ref) query.set('sha', ref)
  if (path) query.set('path', path)
  const r = await gh(ctx, 'GET', `/repos/${owner}/${repo}/commits?${query.toString()}`, token)
  if (r.status === 404 || r.status === 409) return { commits: [], more: false }
  if (!r.ok || !Array.isArray(r.body)) return fail('github_failed', 502)
  const commits = r.body.map((c: any) => ({
    sha: String(c?.sha ?? ''),
    message: String(c?.commit?.message ?? '').split('\n')[0].slice(0, 300),
    author: String(c?.commit?.author?.name ?? c?.author?.login ?? ''),
    date: String(c?.commit?.author?.date ?? ''),
    html_url: String(c?.html_url ?? ''),
  }))
  return { commits, more: commits.length === 30 }
}

/** Flags the member's private projects whose repository the app can no longer see (deleted, or no longer allowed). */
async function doPresence(userId: string, owner: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  // No app, no answer: never flag anything just because the app was uninstalled.
  if (installation === null) return { checked: false }
  const jwt = await appJwt(ctx.env)
  const minted = await gh(ctx, 'POST', `/app/installations/${installation}/access_tokens`, jwt, { permissions: { contents: 'read' } })
  if (!minted.ok || typeof minted.body?.token !== 'string') return fail('github_failed', 502)
  const r = await gh(ctx, 'GET', '/installation/repositories?per_page=100', minted.body.token)
  if (!r.ok) return fail('github_failed', 502)
  const list = Array.isArray(r.body?.repositories) ? r.body.repositories : []
  // A full page may hide the rest: then we cannot be sure a repository is missing, so we flag nothing.
  if (list.length >= 100) return { checked: false }
  const present = list
    .filter((x: any) => String(x?.owner?.login ?? '').toLowerCase() === owner.toLowerCase())
    .map((x: any) => String(x.name))
  const response = await ctx.fetchFn(`${ctx.env.supabaseUrl}/rest/v1/rpc/sync_private_presence`, {
    method: 'POST',
    headers: { ...dbHeaders(ctx.env), 'content-type': 'application/json' },
    body: JSON.stringify({ p_owner: userId, p_present: present }),
  })
  if (!response.ok) return fail('failed', 502)
  return { checked: true }
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

async function doBranches(owner: string, repo: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (info.status === 404) return fail('repo_not_found', 404)
  if (!info.ok) return fail('github_failed', 502)
  const list = await gh(ctx, 'GET', `/repos/${owner}/${repo}/branches?per_page=100`, token)
  if (!list.ok || !Array.isArray(list.body)) return fail('github_failed', 502)
  return { default_branch: String(info.body?.default_branch ?? 'main'), branches: list.body.map((b: any) => String(b?.name ?? '')).filter((n: string) => n.length > 0) }
}

async function doTree(owner: string, repo: string, wanted: string | null, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (info.status === 404) return fail('repo_not_found', 404)
  if (!info.ok) return fail('github_failed', 502)
  const defaultBranch = String(info.body?.default_branch ?? 'main')
  const branch = wanted ?? defaultBranch
  const ref = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, token)
  if (ref.status === 404 && wanted) return fail('branch_not_found', 404)
  if (ref.status === 404 || ref.status === 409) return { branch, default_branch: defaultBranch, head: null, entries: [], truncated: false }
  if (!ref.ok) return fail('github_failed', 502)
  const head = String(ref.body?.object?.sha ?? '')
  const tree = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/trees/${head}?recursive=1`, token)
  if (!tree.ok) return fail('github_failed', 502)
  const entries = (Array.isArray(tree.body?.tree) ? tree.body.tree : [])
    .filter((e: any) => e.type === 'blob' || e.type === 'tree')
    .map((e: any) => ({ path: String(e.path), type: e.type, size: Number(e.size ?? 0) }))
  return { branch, default_branch: defaultBranch, head, entries, truncated: Boolean(tree.body?.truncated) }
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

/** One file as base64 (for previews of images), up to 1 MB. */
async function doBlob(owner: string, repo: string, path: string, ref: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const r = await gh(ctx, 'GET', `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, token)
  if (r.status === 404) return fail('file_not_found', 404)
  if (!r.ok || r.body?.type !== 'file') return fail('github_failed', 502)
  if (Number(r.body.size) > 1_000_000 || r.body?.encoding !== 'base64') return fail('file_too_big', 413)
  return { path, size: Number(r.body.size), content_base64: String(r.body.content).replace(/\s+/g, '') }
}

/** Text search in the files of a branch: plain text (not a pattern), case does not matter, small files only. */
async function doSearch(owner: string, repo: string, branch: string | null, query: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx)
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (info.status === 404) return fail('repo_not_found', 404)
  if (!info.ok) return fail('github_failed', 502)
  const name = branch ?? String(info.body?.default_branch ?? 'main')
  const ref = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${name.split('/').map(encodeURIComponent).join('/')}`, token)
  if (ref.status === 404 || ref.status === 409) return { matches: [], scanned: 0, skipped: 0, more: false }
  if (!ref.ok) return fail('github_failed', 502)
  const tree = await gh(ctx, 'GET', `/repos/${owner}/${repo}/git/trees/${String(ref.body?.object?.sha ?? '')}?recursive=1`, token)
  if (!tree.ok) return fail('github_failed', 502)
  const all = (Array.isArray(tree.body?.tree) ? tree.body.tree : [])
    .filter((e: any) => e.type === 'blob' && !BINARY_FILE.test(String(e.path)) && !SEARCH_SKIP.test(String(e.path)) && Number(e.size ?? 0) <= SEARCH_MAX_FILE_BYTES)
    .sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)))
  const files: any[] = []
  let bytes = 0
  for (const e of all) {
    if (files.length >= SEARCH_MAX_FILES || bytes + Number(e.size ?? 0) > SEARCH_MAX_TOTAL_BYTES) break
    files.push(e)
    bytes += Number(e.size ?? 0)
  }
  const needle = query.toLowerCase()
  const matches: { path: string; line: number; text: string }[] = []
  let more = false
  for (let i = 0; i < files.length && !more; i += 8) {
    const batch = await Promise.all(files.slice(i, i + 8).map((e) => gh(ctx, 'GET', `/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(String(e.sha))}`, token)))
    for (let k = 0; k < batch.length && !more; k++) {
      const r = batch[k]
      if (!r.ok || r.body?.encoding !== 'base64') continue
      const raw = atob(String(r.body.content).replace(/\s+/g, ''))
      const bytesArr = new Uint8Array(raw.length)
      for (let j = 0; j < raw.length; j++) bytesArr[j] = raw.charCodeAt(j)
      const lines = new TextDecoder().decode(bytesArr).split('\n')
      let inFile = 0
      for (let n = 0; n < lines.length; n++) {
        if (!lines[n].toLowerCase().includes(needle)) continue
        if (matches.length >= SEARCH_MAX_MATCHES) { more = true; break }
        if (inFile >= 5) break
        inFile += 1
        matches.push({ path: String(files[i + k].path), line: n + 1, text: lines[n].trim().slice(0, 200) })
      }
    }
  }
  return { matches, scanned: files.length, skipped: all.length - files.length, more }
}

/** A collaborator may only use a branch that starts with their own username and a slash. */
export function isOwnBranch(branch: string, username: string | null): boolean {
  return !!username && branch.startsWith(`${username}/`) && branch.length > username.length + 1
    && !branch.endsWith('/') && !branch.includes('..') && !branch.includes('//')
}

const PROPOSED_BY = /Proposed from jaajef\.tech by (\S+)/g

type Pull = { number: number; title: string; branch: string; sha: string; author: string; url: string; created_at: string }
function toPull(p: any, repoFull: string): Pull | null {
  if (String(p?.head?.repo?.full_name ?? '').toLowerCase() !== repoFull.toLowerCase()) return null // proposals from forks are left to GitHub
  // Our own line is always the last one in the text, so text a member typed cannot pose as someone else.
  const marks = [...String(p?.body ?? '').matchAll(PROPOSED_BY)]
  const by = marks.length > 0 ? marks[marks.length - 1] : null
  return {
    number: Number(p.number), title: String(p.title ?? '').slice(0, 200), branch: String(p.head?.ref ?? ''), sha: String(p.head?.sha ?? ''),
    author: by ? by[1] : String(p?.user?.login ?? ''), url: String(p.html_url ?? ''), created_at: String(p.created_at ?? ''),
  }
}

/** Tells the owner (proposal opened) or the author (merged / declined). A failure here never undoes the action. */
async function notifyProposal(kind: string, projectId: string, actor: string, author: string, number: number, title: string, ctx: Ctx): Promise<void> {
  try {
    await ctx.fetchFn(`${ctx.env.supabaseUrl}/rest/v1/rpc/notify_proposal`, {
      method: 'POST',
      headers: { ...dbHeaders(ctx.env), 'content-type': 'application/json' },
      body: JSON.stringify({ p_kind: kind, p_project: projectId, p_actor: actor, p_author: author, p_number: number, p_title: title }),
    })
  } catch {
    // nothing: the notification is a convenience
  }
}

async function doPrs(owner: string, repo: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx, 'read')
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (!info.ok) return fail(info.status === 404 ? 'repo_not_found' : 'github_failed', info.status === 404 ? 404 : 502)
  const base = String(info.body?.default_branch ?? 'main')
  const r = await gh(ctx, 'GET', `/repos/${owner}/${repo}/pulls?state=open&per_page=50&base=${encodeURIComponent(base)}`, token)
  if (!r.ok || !Array.isArray(r.body)) return fail('github_failed', 502)
  const pulls = r.body.map((p: any) => toPull(p, `${owner}/${repo}`)).filter((p: Pull | null): p is Pull => p !== null)
  return { default_branch: base, pulls }
}

async function doPrOpen(owner: string, repo: string, branch: string, title: string, text: string, by: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx, 'write')
  if (isFail(token)) return token
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (!info.ok) return fail(info.status === 404 ? 'repo_not_found' : 'github_failed', info.status === 404 ? 404 : 502)
  const base = String(info.body?.default_branch ?? 'main')
  if (branch === base) return fail('bad_request', 400)
  const body = `${text}${text ? '\n\n' : ''}Proposed from jaajef.tech by ${by}`
  const made = await gh(ctx, 'POST', `/repos/${owner}/${repo}/pulls`, token, { title, head: branch, base, body })
  if (made.ok) return { number: Number(made.body?.number), url: String(made.body?.html_url ?? ''), existed: false }
  if (made.status === 422) {
    const messages = (Array.isArray(made.body?.errors) ? made.body.errors : []).map((e: any) => String(e?.message ?? '')).join(' ')
    if (/already exists/i.test(messages)) {
      const found = await gh(ctx, 'GET', `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, token)
      const first = found.ok && Array.isArray(found.body) ? found.body[0] : null
      if (first) return { number: Number(first.number), url: String(first.html_url ?? ''), existed: true }
    }
    if (/no commits between/i.test(messages)) return fail('nothing_to_propose', 409)
    return fail('branch_not_found', 404)
  }
  return fail('github_failed', 502)
}

/** Loads one proposal and checks it is an open proposal into the main branch, from a branch of this same repository. */
async function openPull(owner: string, repo: string, number: number, token: string, ctx: Ctx): Promise<any | Fail> {
  const info = await gh(ctx, 'GET', `/repos/${owner}/${repo}`, token)
  if (!info.ok) return fail('github_failed', 502)
  const r = await gh(ctx, 'GET', `/repos/${owner}/${repo}/pulls/${number}`, token)
  if (r.status === 404) return fail('pr_not_found', 404)
  if (!r.ok) return fail('github_failed', 502)
  const same = String(r.body?.head?.repo?.full_name ?? '').toLowerCase() === `${owner}/${repo}`.toLowerCase()
  if (r.body?.state !== 'open' || !same || r.body?.base?.ref !== String(info.body?.default_branch ?? 'main')) return fail('pr_not_found', 404)
  return r.body
}

async function doPrMerge(owner: string, repo: string, number: number, seenSha: string, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, true, ctx, 'write')
  if (isFail(token)) return token
  const pull = await openPull(owner, repo, number, token, ctx)
  if (isFail(pull)) return pull
  // Only what the owner looked at is merged: if the branch got a new commit since, nothing is merged.
  if (String(pull.head?.sha ?? '') !== seenSha) return fail('branch_moved', 409)
  const merged = await gh(ctx, 'PUT', `/repos/${owner}/${repo}/pulls/${number}/merge`, token, { merge_method: 'merge', sha: seenSha })
  if (merged.status === 405) return fail('not_mergeable', 409)
  if (merged.status === 409) return fail('branch_moved', 409)
  if (!merged.ok) return fail('github_failed', 502)
  return { merged: true, url: String(pull.html_url ?? ''), _by: toPull(pull, `${owner}/${repo}`) }
}

async function doPrClose(owner: string, repo: string, number: number, onlyBy: string | null, ctx: Ctx): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, false, ctx, 'write')
  if (isFail(token)) return token
  const pull = await openPull(owner, repo, number, token, ctx)
  if (isFail(pull)) return pull
  // A collaborator can only withdraw their own proposal.
  if (onlyBy !== null && toPull(pull, `${owner}/${repo}`)?.author !== onlyBy) return fail('not_yours', 403)
  const closed = await gh(ctx, 'PATCH', `/repos/${owner}/${repo}/pulls/${number}`, token, { state: 'closed' })
  if (!closed.ok) return fail('github_failed', 502)
  return { closed: true, _by: toPull(pull, `${owner}/${repo}`) }
}

async function doCommit(
  owner: string, repo: string, branch: string, baseSha: string, message: string, changes: FileChange[], ctx: Ctx,
  by: string = `@${owner}`, createFrom: string | null = null,
): Promise<unknown | Fail> {
  const installation = await findInstallation(owner, ctx)
  if (isFail(installation)) return installation
  if (installation === null) return fail('not_installed', 409)
  const token = await repoToken(installation, repo, true, ctx)
  if (isFail(token)) return token
  const base = `/repos/${owner}/${repo}`

  const path = (name: string) => name.split('/').map(encodeURIComponent).join('/')
  if (createFrom) {
    // Make the new branch first, from the branch the editor was looking at (refused if that branch moved meanwhile).
    const from = await gh(ctx, 'GET', `${base}/git/ref/heads/${path(createFrom)}`, token)
    if (from.status === 404) return fail('branch_not_found', 404)
    if (!from.ok) return fail('github_failed', 502)
    if (String(from.body?.object?.sha ?? '') !== baseSha) return fail('branch_moved', 409)
    const made = await gh(ctx, 'POST', `${base}/git/refs`, token, { ref: `refs/heads/${branch}`, sha: baseSha })
    if (made.status === 422) return fail('branch_exists', 409)
    if (!made.ok) return fail('github_failed', 502)
  }
  const ref = await gh(ctx, 'GET', `${base}/git/ref/heads/${path(branch)}`, token)
  if (ref.status === 404) return fail('branch_not_found', 404)
  if (!ref.ok) return fail('github_failed', 502)
  const head = String(ref.body?.object?.sha ?? '')
  if (head !== baseSha) return fail('branch_moved', 409)

  const commit = await gh(ctx, 'GET', `${base}/git/commits/${head}`, token)
  if (!commit.ok) return fail('github_failed', 502)

  const tree: unknown[] = []
  for (const change of changes) {
    if (change.delete) { tree.push({ path: change.path, mode: '100644', type: 'blob', sha: null }); continue }
    if (change.move_from) {
      const found = await gh(ctx, 'GET', `${base}/contents/${change.move_from.split('/').map(encodeURIComponent).join('/')}?ref=${head}`, token)
      if (found.status === 404) return fail('file_not_found', 404)
      if (!found.ok || found.body?.type !== 'file' || typeof found.body?.sha !== 'string') return fail('github_failed', 502)
      tree.push({ path: change.move_from, mode: '100644', type: 'blob', sha: null })
      tree.push({ path: change.path, mode: '100644', type: 'blob', sha: found.body.sha })
      continue
    }
    const blob = await gh(ctx, 'POST', `${base}/git/blobs`, token, change.content_base64 !== undefined
      ? { content: change.content_base64, encoding: 'base64' } : { content: change.content, encoding: 'utf-8' })
    if (!blob.ok) return fail('github_failed', 502)
    tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.body.sha })
  }
  const newTree = await gh(ctx, 'POST', `${base}/git/trees`, token, { base_tree: commit.body?.tree?.sha, tree })
  if (!newTree.ok) return fail('github_failed', 502)
  const created = await gh(ctx, 'POST', `${base}/git/commits`, token, {
    message: `${message}\n\nSaved from jaajef.tech by ${by}`, tree: newTree.body.sha, parents: [head],
  })
  if (!created.ok) return fail('github_failed', 502)
  const moved = await gh(ctx, 'PATCH', `${base}/git/refs/heads/${path(branch)}`, token, { sha: created.body.sha, force: false })
  if (moved.status === 422 || moved.status === 409) return fail('branch_moved', 409)
  if (!moved.ok) return fail('github_failed', 502)
  return { commit_sha: String(created.body.sha), html_url: `https://github.com/${owner}/${repo}/commit/${created.body.sha}` }
}

// ---- A simple limit per member (kept in the memory of the running function, so it is a best effort) ----------------------
const hits = new Map<string, number[]>()
function overLimit(userId: string, cost: number, perMinute: number, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (recent.length + cost > perMinute) { hits.set(userId, recent); return true }
  for (let i = 0; i < cost; i++) recent.push(now)
  hits.set(userId, recent)
  return false
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

  const perMinute = Number(getEnv('EDITOR_RATE_PER_MINUTE')) || 120
  if (overLimit(userId, body.action === 'search' ? 10 : 1, perMinute)) return jsonResponse({ error: 'too_many_requests' }, 429)

  // Reading the code of a project: the owner and the collaborators, through the owner's installation.
  // The caller's own GitHub account is not needed (a collaborator may have none).
  let owner: string | null
  let projectRepo: string | null = null
  let isProjectOwner = false
  if (typeof body.project === 'string' && ['tree', 'file', 'blob', 'search', 'history', 'branches', 'commit', 'prs', 'pr_open', 'pr_merge', 'pr_close'].includes(body.action)) {
    if (!UUID.test(body.project)) return jsonResponse({ error: 'bad_request' }, 400)
    const access = await memberProject(userId, body.project, ctx)
    if (!access) return jsonResponse({ error: 'repo_not_allowed' }, 403)
    owner = access.owner
    projectRepo = access.repo
    isProjectOwner = access.isOwner
  } else {
    owner = await githubNameOf(userId, ctx)
    if (!owner) return jsonResponse({ error: 'github_not_linked' }, 409)
  }

  const needRepo = (): string | null => projectRepo ?? (typeof body.repo === 'string' && NAME.test(body.repo) ? body.repo : null)
  let result: unknown | Fail
  try {
    switch (body.action) {
      case 'status': result = await doStatus(owner, ctx); break
      case 'repos': result = await doRepos(owner, ctx); break
      case 'tree': {
        const repo = needRepo()
        const wanted = body.branch === undefined || body.branch === null ? null : (typeof body.branch === 'string' && REF.test(body.branch) ? body.branch : 'bad')
        result = repo && wanted !== 'bad' ? await doTree(owner, repo, wanted, ctx) : fail('bad_request', 400)
        break
      }
      case 'branches': {
        const repo = needRepo()
        result = repo ? await doBranches(owner, repo, ctx) : fail('bad_request', 400)
        break
      }
      case 'file': {
        const repo = needRepo()
        const path = cleanPath(body.path)
        const ref = typeof body.ref === 'string' && body.ref.length > 0 && body.ref.length <= 200 ? body.ref : null
        result = repo && path && ref ? await doFile(owner, repo, path, ref, ctx) : fail('bad_request', 400)
        break
      }
      case 'blob': {
        const repo = needRepo()
        const path = cleanPath(body.path)
        const ref = typeof body.ref === 'string' && REF.test(body.ref) ? body.ref : null
        result = repo && path && ref ? await doBlob(owner, repo, path, ref, ctx) : fail('bad_request', 400)
        break
      }
      case 'search': {
        const repo = needRepo()
        const q = typeof body.q === 'string' ? body.q.trim() : ''
        const wanted = body.branch === undefined || body.branch === null ? null : (typeof body.branch === 'string' && REF.test(body.branch) ? body.branch : 'bad')
        result = repo && projectRepo !== null && q.length >= 2 && q.length <= 100 && wanted !== 'bad'
          ? await doSearch(owner, repo, wanted, q, ctx) : fail('bad_request', 400)
        break
      }
      case 'history': {
        const repo = needRepo()
        const ref = typeof body.ref === 'string' && body.ref.length > 0 ? (REF.test(body.ref) ? body.ref : 'bad') : null
        const path = body.path === undefined || body.path === null ? null : cleanPath(body.path)
        const page = Number.isInteger(body.page) && body.page >= 1 && body.page <= 50 ? body.page : 1
        result = repo && ref !== 'bad' && !(body.path !== undefined && body.path !== null && path === null)
          ? await doHistory(owner, repo, ref, path, page, ctx) : fail('bad_request', 400)
        break
      }
      case 'presence': result = await doPresence(userId, owner, ctx); break
      case 'adopt': {
        const repo = needRepo()
        const title = typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 100 ? body.title.trim() : null
        const summary = typeof body.summary === 'string' && body.summary.length <= 300 ? body.summary : null
        result = repo ? await doAdopt(userId, owner, repo, title, summary, ctx) : fail('bad_request', 400)
        break
      }
      case 'prs': {
        const repo = needRepo()
        result = repo ? await doPrs(owner, repo, ctx) : fail('bad_request', 400)
        break
      }
      case 'pr_open': {
        const repo = needRepo()
        const branch = typeof body.branch === 'string' && REF.test(body.branch) ? body.branch : null
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        const text = typeof body.body === 'string' ? body.body.trim() : ''
        if (!(repo && projectRepo !== null && branch && title.length > 0 && title.length <= 200 && text.length <= 2000)) { result = fail('bad_request', 400); break }
        const username = await usernameOf(userId, ctx)
        if (!username) { result = fail('bad_request', 400); break }
        if (!isProjectOwner && !isOwnBranch(branch, username)) { result = fail('branch_not_yours', 403); break }
        result = await doPrOpen(owner, repo, branch, title, text, username, ctx)
        if (!isFail(result) && (result as any).existed === false && !isProjectOwner) {
          await notifyProposal('proposal_opened', body.project, userId, username, (result as any).number, title, ctx)
        }
        break
      }
      case 'pr_merge': {
        const repo = needRepo()
        const number = Number.isInteger(body.number) && body.number >= 1 && body.number <= 10_000_000 ? body.number : null
        const seen = typeof body.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha) ? body.sha : null
        if (!(repo && projectRepo !== null && number && seen)) { result = fail('bad_request', 400); break }
        result = isProjectOwner ? await doPrMerge(owner, repo, number, seen, ctx) : fail('owner_only', 403)
        if (!isFail(result)) {
          const by = (result as any)._by as Pull | null
          delete (result as any)._by
          if (by) await notifyProposal('proposal_merged', body.project, userId, by.author, by.number, by.title, ctx)
        }
        break
      }
      case 'pr_close': {
        const repo = needRepo()
        const number = Number.isInteger(body.number) && body.number >= 1 && body.number <= 10_000_000 ? body.number : null
        if (!(repo && projectRepo !== null && number)) { result = fail('bad_request', 400); break }
        const username = isProjectOwner ? null : await usernameOf(userId, ctx)
        if (!isProjectOwner && !username) { result = fail('not_yours', 403); break }
        result = await doPrClose(owner, repo, number, username, ctx)
        if (!isFail(result)) {
          const by = (result as any)._by as Pull | null
          delete (result as any)._by
          // Withdrawing your own proposal tells nobody; declining someone else's tells its author.
          if (by && isProjectOwner) await notifyProposal('proposal_declined', body.project, userId, by.author, by.number, by.title, ctx)
        }
        break
      }
      case 'commit': {
        const repo = needRepo()
        const changes = cleanChanges(body.files)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        const branch = typeof body.branch === 'string' && /^[A-Za-z0-9._\/-]{1,100}$/.test(body.branch) ? body.branch : null
        const baseSha = typeof body.base_sha === 'string' && /^[0-9a-f]{40}$/.test(body.base_sha) ? body.base_sha : null
        const createFrom = body.create_from === undefined || body.create_from === null ? null : (typeof body.create_from === 'string' && REF.test(body.create_from) ? body.create_from : 'bad')
        if (!(repo && changes && branch && baseSha && message.length > 0 && message.length <= 500) || createFrom === 'bad') { result = fail('bad_request', 400); break }
        let by = `@${owner}`
        if (projectRepo !== null && !isProjectOwner) {
          // A collaborator never writes to the main code: only to a branch named after them.
          const username = await usernameOf(userId, ctx)
          if (!isOwnBranch(branch, username)) {
            result = fail('branch_not_yours', 403)
            break
          }
          // Automation files (GitHub Actions and friends) can run code with the repository's secrets: only the owner changes them.
          if (changes.some((c) => /^\.github\//i.test(c.path))) { result = fail('path_not_allowed', 403); break }
          by = username
        }
        result = await doCommit(owner, repo, branch, baseSha, message, changes, ctx, by, createFrom)
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
