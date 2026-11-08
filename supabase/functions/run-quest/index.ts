// jaajef.tech - Run a quest solution (Supabase Edge Function)
//
// What it does, for a signed-in player who sends { quest_id, code }:
//   1. Checks who the player is, from their sign-in token.
//   2. Asks the database for the quest's hidden tests (this also checks the quest was started and not
//      already solved, and enforces the run limit).
//   3. Sends the code and the tests to the RUNNER, a sandbox that executes untrusted code.
//   4. Records the result itself in the database. The player never reports a result.
//   5. Answers with pass/fail per test. The expected values of the hidden tests are never sent back.
//
// The runner is a plug-in point. It must accept a POST with
//   { language, entry_point, code, tests: [{ name, input, expected }], time_limit_ms }
// entry_point is the name of the function the player wrote; each test calls it with "input" as its single
// argument and compares what it returns with "expected".
// and answer
//   { results: [{ name, passed, error? }] }        (error = a crash or a timeout, short text)
// Any service can be used behind this contract through a small adapter.
//
// Secrets: RUNNER_URL and RUNNER_KEY (the runner's address and password).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS) are provided by Supabase itself.

type Env = { supabaseUrl: string; serviceKey: string; runnerUrl: string; runnerKey: string; runnerTimeoutMs?: number }

type TestSpec = { name: string; input: unknown; expected: unknown }
type RunnerResult = { name: string; passed: boolean; error?: string }

const MAX_CODE_CHARS = 50_000
const TIME_LIMIT_MS = 5_000
const DEFAULT_RUNNER_TIMEOUT_MS = 20_000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

function authHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: env.serviceKey }
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
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

async function whoIs(token: string, env: Env, fetchFn: typeof fetch): Promise<string | null> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.serviceKey, authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  const user = await response.json()
  return typeof user?.id === 'string' ? user.id : null
}

async function rpc(name: string, args: Record<string, unknown>, env: Env, fetchFn: typeof fetch): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(args),
  })
  let body: any = null
  try { body = await response.json() } catch { body = null }
  return { ok: response.ok, status: response.status, body }
}

function databaseError(message: string): Response {
  const m = message.toLowerCase()
  if (m.includes('start the quest first')) return jsonResponse({ error: 'not_started' }, 409)
  if (m.includes('already solved')) return jsonResponse({ error: 'already_solved' }, 409)
  if (m.includes('quest not available')) return jsonResponse({ error: 'quest_not_found' }, 404)
  if (m.includes('has no tests') || m.includes('no entry point')) return jsonResponse({ error: 'quest_not_ready' }, 409)
  return jsonResponse({ error: 'database_error' }, 502)
}

async function runInSandbox(language: string, entryPoint: string, code: string, tests: TestSpec[], env: Env, fetchFn: typeof fetch): Promise<RunnerResult[] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.runnerTimeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS)
  try {
    const response = await fetchFn(env.runnerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.runnerKey}` },
      body: JSON.stringify({ language, entry_point: entryPoint, code, tests, time_limit_ms: TIME_LIMIT_MS }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = await response.json()
    return Array.isArray(body?.results) ? body.results : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function runQuest(request: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) return jsonResponse({ error: 'sign_in_required' }, 401)
  const userId = await whoIs(token, env, fetchFn)
  if (!userId) return jsonResponse({ error: 'sign_in_required' }, 401)

  let payload: any
  try { payload = await request.json() } catch { return jsonResponse({ error: 'bad_request' }, 400) }
  const questId = payload?.quest_id
  const code = payload?.code
  if (typeof questId !== 'string' || typeof code !== 'string' || code.length === 0) return jsonResponse({ error: 'bad_request' }, 400)
  if (code.length > MAX_CODE_CHARS) return jsonResponse({ error: 'code_too_long' }, 413)

  const begun = await rpc('begin_quest_run', { p_user: userId, p_quest_id: questId }, env, fetchFn)
  if (!begun.ok) return databaseError(String(begun.body?.message ?? ''))
  if (!begun.body?.allowed) return jsonResponse({ error: 'too_many_runs' }, 429)

  const tests: TestSpec[] = Array.isArray(begun.body.tests) ? begun.body.tests : []
  const results = await runInSandbox(String(begun.body.language), String(begun.body.entry_point), code, tests, env, fetchFn)
  if (!results) return jsonResponse({ error: 'runner_unavailable' }, 502)

  // Missing or malformed answers count as failures, so a faulty runner can never mark a test as passed.
  const byName = new Map<string, RunnerResult>()
  for (const r of results) if (r && typeof r.name === 'string') byName.set(r.name, r)
  const shown = tests.map((t) => {
    const r = byName.get(t.name)
    const passed = r?.passed === true
    const message = !passed && typeof r?.error === 'string' && r.error ? r.error.slice(0, 200) : undefined
    return message ? { name: t.name, passed, message } : { name: t.name, passed }
  })
  const passedCount = shown.filter((t) => t.passed).length

  const recorded = await rpc('record_graded_attempt', {
    p_user: userId, p_quest_id: questId, p_code: code, p_tests_passed: passedCount, p_tests_total: tests.length,
  }, env, fetchFn)
  if (!recorded.ok) return databaseError(String(recorded.body?.message ?? ''))

  return jsonResponse({ ...recorded.body, tests: shown, tests_passed: passedCount, tests_total: tests.length })
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    runnerUrl: getEnv('RUNNER_URL') ?? '',
    runnerKey: getEnv('RUNNER_KEY') ?? '',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (!env.supabaseUrl || !env.serviceKey || !env.runnerUrl || !env.runnerKey) return jsonResponse({ error: 'not_configured' }, 503)
  return runQuest(request, env, fetchFn)
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
