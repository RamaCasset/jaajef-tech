// jaajef.tech - File cleanup (Supabase Edge Function)
//
// What it does
//   1. Asks the database for CV files and Souk images that nothing uses any more (files_to_clean).
//      The database only lists files older than a grace period, so a file just uploaded is never listed.
//   2. Deletes them through Supabase Storage.
//
// Safety rules
//   * Only the two buckets the database names are touched, and only the names it lists.
//   * Any error leaves the files in place: they are listed again at the next run.
//   * Three failures in a row stop the run.
//   * Only a caller that knows CRON_SECRET can start a run.
//
// Secrets: CRON_SECRET (required, the same as the GitHub checker's). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS) are provided by Supabase itself.

type Env = { supabaseUrl: string; serviceKey: string; cronSecret: string }

type Summary = { found: number; deleted: number; failed: number; stopped: string | null }

const BATCH_SIZE = 200
const DELETE_CHUNK = 50
const MAX_CONSECUTIVE_FAILURES = 3
const TIME_BUDGET_MS = 100_000
const ALLOWED_BUCKETS = new Set(['cv-files', 'souk-images'])

// Lets the private test page call this from a browser. Starting a run still needs the password.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'x-cron-secret, content-type, authorization, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function authHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: env.serviceKey }
  // The older keys are tokens (JWT) and go in Authorization too. The newer keys (sb_secret_...) do not.
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
}

async function listFiles(env: Env, fetchFn: typeof fetch): Promise<{ bucket_id: string; name: string }[]> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/files_to_clean`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ p_limit: BATCH_SIZE }),
  })
  if (!response.ok) throw new Error(`database call files_to_clean failed with status ${response.status}`)
  const rows = await response.json()
  return Array.isArray(rows) ? rows : []
}

export async function runCleanup(env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Summary> {
  const summary: Summary = { found: 0, deleted: 0, failed: 0, stopped: null }
  const started = now()
  const rows = (await listFiles(env, fetchFn)).filter(
    (r) => r && ALLOWED_BUCKETS.has(r.bucket_id) && typeof r.name === 'string' && r.name.length > 0,
  )
  summary.found = rows.length

  const byBucket = new Map<string, string[]>()
  for (const r of rows) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.name])

  let consecutiveFailures = 0
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += DELETE_CHUNK) {
      if (now() - started > TIME_BUDGET_MS) {
        summary.stopped = 'time_budget'
        return summary
      }
      const chunk = names.slice(i, i + DELETE_CHUNK)
      let removed = -1
      try {
        const response = await fetchFn(`${env.supabaseUrl}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: authHeaders(env),
          body: JSON.stringify({ prefixes: chunk }),
        })
        if (response.ok) {
          const body = await response.json().catch(() => null)
          removed = Array.isArray(body) ? body.length : chunk.length
        }
      } catch {
        removed = -1
      }
      if (removed < 0) {
        summary.failed += chunk.length
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          summary.stopped = 'storage_errors'
          return summary
        }
      } else {
        consecutiveFailures = 0
        summary.deleted += removed
      }
    }
  }
  return summary
}

function firstSecretKey(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const first = Object.values(JSON.parse(raw) ?? {})[0]
    return typeof first === 'string' ? first : ''
  } catch {
    return ''
  }
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return jsonResponse({ error: 'use POST' }, 405)

  const cronSecret = getEnv('CRON_SECRET') ?? ''
  const supabaseUrl = getEnv('SUPABASE_URL') ?? ''
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || ''
  if (cronSecret.length < 16 || !supabaseUrl || !serviceKey) return jsonResponse({ error: 'the cleanup is not configured' }, 500)

  const sent = request.headers.get('x-cron-secret') ?? ''
  if (!sameSecret(sent, cronSecret)) return jsonResponse({ error: 'not allowed' }, 401)

  try {
    return jsonResponse(await runCleanup({ supabaseUrl, serviceKey, cronSecret }, fetchFn))
  } catch (error) {
    console.error('file-cleanup failed', error instanceof Error ? error.message : error)
    return jsonResponse({ error: 'the run failed, see the function logs' }, 500)
  }
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
