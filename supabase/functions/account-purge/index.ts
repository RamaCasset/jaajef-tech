// jaajef.tech - Account purge (Supabase Edge Function)
//
// What it does, once a day
//   1. Asks the database for accounts whose deletion was requested and whose waiting period is over.
//   2. For each one:
//        - if something now prevents the deletion (the member became staff, got suspended, ...), the
//          request is cancelled and the account stays;
//        - otherwise the member's uploaded files (private messages, CVs, Souk images) are deleted from
//          Storage, and then the database deletes the login and everything linked to it.
//
// Safety rules
//   * Files first, account second: if a file cannot be deleted the account is kept and tried again at the
//     next run, so a deleted account never leaves files behind.
//   * At most 20 accounts per run; three failures in a row stop the run.
//   * Only a caller that knows CRON_SECRET can start a run.
//
// Secrets: CRON_SECRET (same as the other functions). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or
// SUPABASE_SECRET_KEYS) are provided by Supabase itself.

export type Env = { supabaseUrl: string; serviceKey: string; cronSecret: string }
export type Summary = { due: number; deleted: number; kept: number; failed: number; stopped: string | null }

const MAX_ACCOUNTS_PER_RUN = 20
const MAX_CONSECUTIVE_FAILURES = 3
const FILE_CHUNK = 100
const TIME_BUDGET_MS = 100_000
const ALLOWED_BUCKETS = new Set(['dm-files', 'cv-files', 'souk-images', 'profile-images', 'project-covers'])

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

async function rpc(name: string, args: unknown, env: Env, fetchFn: typeof fetch): Promise<{ ok: boolean; body: any }> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify(args) })
  let body: any = null
  try { body = await response.json() } catch { body = null }
  return { ok: response.ok, body }
}

async function deleteFiles(bucket: string, names: string[], env: Env, fetchFn: typeof fetch): Promise<boolean> {
  for (let i = 0; i < names.length; i += FILE_CHUNK) {
    const response = await fetchFn(`${env.supabaseUrl}/storage/v1/object/${bucket}`, {
      method: 'DELETE', headers: authHeaders(env), body: JSON.stringify({ prefixes: names.slice(i, i + FILE_CHUNK) }),
    })
    if (!response.ok) return false
  }
  return true
}

/** Returns 'deleted', 'kept' (a reason now prevents deletion) or 'failed' (try again at the next run). */
async function purgeOne(userId: string, env: Env, fetchFn: typeof fetch): Promise<'deleted' | 'kept' | 'failed'> {
  const blockers = await rpc('account_blockers_for', { p_user: userId }, env, fetchFn)
  if (!blockers.ok || !Array.isArray(blockers.body)) return 'failed'
  if (blockers.body.length > 0) {
    const aborted = await rpc('abort_account_deletion', { p_user: userId }, env, fetchFn)
    return aborted.ok ? 'kept' : 'failed'
  }

  const listed = await rpc('account_files', { p_user: userId }, env, fetchFn)
  if (!listed.ok || !Array.isArray(listed.body)) return 'failed'
  const byBucket = new Map<string, string[]>()
  for (const f of listed.body) {
    // Only the buckets and names the database listed for this member, and only the known buckets.
    if (f && typeof f.bucket_id === 'string' && typeof f.name === 'string' && ALLOWED_BUCKETS.has(f.bucket_id) && f.name.startsWith(`${userId}/`)) {
      byBucket.set(f.bucket_id, [...(byBucket.get(f.bucket_id) ?? []), f.name])
    }
  }
  for (const [bucket, names] of byBucket) {
    if (!(await deleteFiles(bucket, names, env, fetchFn))) return 'failed'
  }

  const purged = await rpc('purge_account', { p_user: userId }, env, fetchFn)
  return purged.ok ? 'deleted' : 'failed'
}

export async function runPurge(env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Summary> {
  const started = now()
  const due = await rpc('accounts_due_for_deletion', { p_limit: MAX_ACCOUNTS_PER_RUN }, env, fetchFn)
  if (!due.ok || !Array.isArray(due.body)) throw new Error('database call accounts_due_for_deletion failed')
  const ids: string[] = due.body.map((r: any) => r?.user_id).filter((v: unknown): v is string => typeof v === 'string')

  const summary: Summary = { due: ids.length, deleted: 0, kept: 0, failed: 0, stopped: null }
  let streak = 0
  for (const id of ids) {
    if (now() - started > TIME_BUDGET_MS) { summary.stopped = 'time budget used'; break }
    let outcome: 'deleted' | 'kept' | 'failed'
    try { outcome = await purgeOne(id, env, fetchFn) } catch { outcome = 'failed' }
    if (outcome === 'failed') {
      summary.failed += 1
      streak += 1
      if (streak >= MAX_CONSECUTIVE_FAILURES) { summary.stopped = 'three failures in a row'; break }
    } else {
      streak = 0
      summary[outcome] += 1
    }
  }
  return summary
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    cronSecret: getEnv('CRON_SECRET') ?? '',
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (!env.supabaseUrl || !env.serviceKey || env.cronSecret.length < 16) return jsonResponse({ error: 'not_configured' }, 503)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!sameSecret(request.headers.get('x-cron-secret') ?? '', env.cronSecret)) return jsonResponse({ error: 'not_allowed' }, 401)
  try {
    return jsonResponse(await runPurge(env, fetchFn))
  } catch {
    return jsonResponse({ error: 'run_failed' }, 502)
  }
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
