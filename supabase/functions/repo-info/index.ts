// jaajef.tech - Last commit of each file (Supabase Edge Function)
//
// What it does, for a signed-in member (POST, JSON, { project_id, paths: [..] }):
//   returns { commits: { "<path>": { message, date } } } with the message line and date of the last commit that touched
//   each file or folder, so the file list of a project can show them like GitHub does.
//
// Safety rules:
//   * Only a signed-in member can ask (the sign-in token is checked).
//   * Only repositories of public projects listed in our own database are looked up (never an address sent by the browser).
//   * At most 40 paths per call; paths are checked (no "..", no ".git").
//   * The question to GitHub is ONE call, and the paths go in as variables, never glued into the query text.
//
// Secrets: GITHUB_TOKEN (any token that can read public repositories). SUPABASE_URL and the service key are provided by Supabase.

type Env = { supabaseUrl: string; serviceKey: string; githubToken: string; githubApi: string }

const MAX_PATHS = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME = /^[A-Za-z0-9._-]{1,100}$/

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

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

export function cleanPath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return null
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0')) return null
  if (path.split('/').some((p) => p === '' || p === '.' || p === '..' || p.toLowerCase() === '.git')) return null
  return path
}

function dbHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { apikey: env.serviceKey }
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
}

async function isSignedIn(token: string, env: Env, fetchFn: typeof fetch): Promise<boolean> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.serviceKey, authorization: `Bearer ${token}` } })
  if (!response.ok) return false
  const user = await response.json()
  return typeof user?.id === 'string'
}

async function projectRepo(id: string, env: Env, fetchFn: typeof fetch): Promise<{ owner: string; repo: string } | null> {
  const response = await fetchFn(
    `${env.supabaseUrl}/rest/v1/projects?id=eq.${encodeURIComponent(id)}&is_public=eq.true&staff_hidden=eq.false&select=github_owner,github_repo`,
    { headers: dbHeaders(env) })
  if (!response.ok) return null
  const rows = await response.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row || !NAME.test(row.github_owner ?? '') || !NAME.test(row.github_repo ?? '')) return null
  return { owner: row.github_owner, repo: row.github_repo }
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    githubToken: getEnv('GITHUB_TOKEN') ?? '',
    githubApi: getEnv('GITHUB_API_URL') || 'https://api.github.com',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!env.supabaseUrl || !env.serviceKey || !env.githubToken) return jsonResponse({ error: 'not_configured' }, 503)

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !(await isSignedIn(token, env, fetchFn))) return jsonResponse({ error: 'not_signed_in' }, 401)

  let body: any
  try { body = await request.json() } catch { return jsonResponse({ error: 'bad_request' }, 400) }
  if (typeof body !== 'object' || body === null || typeof body.project_id !== 'string' || !UUID.test(body.project_id)) return jsonResponse({ error: 'bad_request' }, 400)
  if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.length > MAX_PATHS) return jsonResponse({ error: 'bad_request' }, 400)
  const paths: string[] = []
  for (const p of body.paths) {
    const clean = cleanPath(p)
    if (!clean) return jsonResponse({ error: 'bad_request' }, 400)
    if (!paths.includes(clean)) paths.push(clean)
  }

  try {
    const target = await projectRepo(body.project_id, env, fetchFn)
    if (!target) return jsonResponse({ error: 'not_found' }, 404)

    const declared = paths.map((_, i) => `$p${i}: String!`).join(', ')
    const fields = paths.map((_, i) => `p${i}: history(first: 1, path: $p${i}) { nodes { messageHeadline committedDate } }`).join('\n')
    const query = `query($owner: String!, $name: String!, ${declared}) {
      repository(owner: $owner, name: $name) { defaultBranchRef { target { ... on Commit { ${fields} } } } }
    }`
    const variables: Record<string, string> = { owner: target.owner, name: target.repo }
    paths.forEach((p, i) => { variables[`p${i}`] = p })

    const graphqlUrl = `${env.githubApi.replace(/\/$/, '')}/graphql`
    const response = await fetchFn(graphqlUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.githubToken}`, 'content-type': 'application/json', 'user-agent': 'jaajef-tech-info' },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) return jsonResponse({ error: 'github_failed' }, 502)
    const result = await response.json()
    const node = result?.data?.repository?.defaultBranchRef?.target
    if (!node) return jsonResponse({ commits: {} })

    const commits: Record<string, { message: string; date: string }> = {}
    paths.forEach((p, i) => {
      const first = node[`p${i}`]?.nodes?.[0]
      if (first && typeof first.messageHeadline === 'string' && typeof first.committedDate === 'string') {
        commits[p] = { message: first.messageHeadline.slice(0, 300), date: first.committedDate }
      }
    })
    return jsonResponse({ commits })
  } catch {
    return jsonResponse({ error: 'failed' }, 500)
  }
}

// Supabase starts the function here. Tests import `handler` instead.
declare const Deno: { serve: (fn: (r: Request) => Promise<Response>) => void; env: { get: (n: string) => string | undefined } } | undefined
if (typeof Deno !== 'undefined' && Deno && typeof Deno.serve === 'function') {
  Deno.serve((request) => handler(request, (name) => Deno.env.get(name)))
}
