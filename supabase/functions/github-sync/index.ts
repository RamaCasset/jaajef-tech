// jaajef.tech - GitHub checker (Supabase Edge Function)
//
// What it does
//   1. Asks the database which listed projects need checking (projects_to_sync).
//   2. Asks GitHub about each repository.
//   3. Sends the answer back to the database (record_github_sync). The database
//      decides what to do: make the project public, hide it, pay the reward.
//   4. Then, for listed projects, a second pass reads the build status (GitHub Actions
//      on the main branch) and the open issues labelled "good first issue", and sends
//      them to the database (record_github_extras). If GitHub cannot be reached for a
//      project, the last known values stay.
//
// Safety rules
//   * A project is reported as "not found" ONLY when GitHub says 404, 451 or a
//     blocked-repository 403.
//     A network error, a GitHub outage or a rate limit never hides anything: the
//     project is simply left for the next run.
//   * A private repository is treated as not found, so private details can never
//     reach the public showcase, even if the access token can see them.
//   * When GitHub says "too many requests" the run stops and resumes next time.
//   * Only a caller that knows CRON_SECRET can start a run.
//
// Secrets (set in Supabase, never in the code)
//   CRON_SECRET     required. Any long random text. The scheduler sends it.
//   GITHUB_TOKEN    optional. Raises GitHub's limit from 60 to 5000 checks an hour.
//                   Use a token that can only read public repositories.
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS on newer
//   projects) are provided by Supabase itself.

type Env = {
  supabaseUrl: string
  serviceKey: string
  githubToken?: string
  cronSecret: string
}

type Project = { project_id: string; github_owner: string; github_repo: string }

type Summary = {
  checked: number
  verified: number
  hidden: number
  skipped: number
  stopped: string | null
}

const BATCH_SIZE = 50
const TIME_BUDGET_MS = 100_000
const MAX_CONSECUTIVE_ERRORS = 3

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Compares two texts without stopping at the first difference.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function callDatabase(env: Env, fetchFn: typeof fetch, name: string, args: Record<string, unknown>) {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: env.serviceKey }
  // The older keys are tokens (JWT) and go in Authorization too. The newer keys
  // (sb_secret_...) are not tokens and go in the apikey header only.
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`

  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`database call ${name} failed with status ${response.status}`)
  }
  return await response.json()
}

type GithubAnswer =
  | { kind: 'found'; owner: string; description: string | null; language: string | null; stars: number }
  | { kind: 'missing' }
  | { kind: 'rate_limited' }
  | { kind: 'error' }

async function askGithub(env: Env, fetchFn: typeof fetch, project: Project): Promise<GithubAnswer> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'jaajef-tech-sync',
  }
  if (env.githubToken) headers.authorization = `Bearer ${env.githubToken}`

  let response: Response
  try {
    response = await fetchFn(
      `https://api.github.com/repos/${encodeURIComponent(project.github_owner)}/${encodeURIComponent(project.github_repo)}`,
      { headers },
    )
  } catch {
    return { kind: 'error' }
  }

  if (response.status === 404 || response.status === 451) return { kind: 'missing' }

  // Too many requests: GitHub answers 429, or 403 with no calls left (or a Retry-After).
  const outOfCalls = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null
  if (response.status === 429 || (response.status === 403 && outOfCalls)) return { kind: 'rate_limited' }

  // Any other 403 means GitHub blocked this repository: treat it as not available.
  if (response.status === 403) return { kind: 'missing' }

  if (response.status !== 200) return { kind: 'error' }

  let data: any
  try {
    data = await response.json()
  } catch {
    return { kind: 'error' }
  }

  // A private repository must never appear on the showcase.
  if (data?.private === true) return { kind: 'missing' }

  const owner = data?.owner?.login
  if (typeof owner !== 'string' || owner.length === 0) return { kind: 'error' }

  return {
    kind: 'found',
    owner,
    description: typeof data.description === 'string' ? data.description : null,
    language: typeof data.language === 'string' ? data.language : null,
    stars: Number.isInteger(data.stargazers_count) && data.stargazers_count >= 0 ? data.stargazers_count : 0,
  }
}

export async function runSync(env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Summary> {
  const summary: Summary = { checked: 0, verified: 0, hidden: 0, skipped: 0, stopped: null }
  const started = now()

  const projects: Project[] = await callDatabase(env, fetchFn, 'projects_to_sync', { p_limit: BATCH_SIZE })
  let consecutiveErrors = 0

  for (const project of projects) {
    if (now() - started > TIME_BUDGET_MS) {
      summary.stopped = 'time_budget'
      break
    }

    const answer = await askGithub(env, fetchFn, project)

    if (answer.kind === 'rate_limited') {
      summary.stopped = 'github_rate_limit'
      break
    }

    if (answer.kind === 'error') {
      summary.skipped++
      consecutiveErrors++
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        summary.stopped = 'github_errors'
        break
      }
      continue
    }
    consecutiveErrors = 0

    const args =
      answer.kind === 'found'
        ? {
            p_project: project.project_id,
            p_exists: true,
            p_owner_login: answer.owner,
            p_description: answer.description,
            p_language: answer.language,
            p_stars: answer.stars,
          }
        : { p_project: project.project_id, p_exists: false }

    const result = await callDatabase(env, fetchFn, 'record_github_sync', args)
    summary.checked++
    if (result?.verified) summary.verified++
    else summary.hidden++
  }

  return summary
}

// ---------------------------------------------------------------------
// Second pass: build status and "good first issue" issues
// ---------------------------------------------------------------------

type ExtrasSummary = { checked: number; skipped: number; stopped: string | null }

const EXTRAS_BATCH_SIZE = 30
const EXTRAS_TIME_BUDGET_MS = 40_000

type Fetched = { kind: 'ok'; data: any } | { kind: 'rate_limited' } | { kind: 'other'; status: number } | { kind: 'error' }

async function githubGet(env: Env, fetchFn: typeof fetch, url: string): Promise<Fetched> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'jaajef-tech-sync',
  }
  if (env.githubToken) headers.authorization = `Bearer ${env.githubToken}`

  let response: Response
  try {
    response = await fetchFn(url, { headers })
  } catch {
    return { kind: 'error' }
  }
  const outOfCalls = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null
  if (response.status === 429 || (response.status === 403 && outOfCalls)) return { kind: 'rate_limited' }
  if (response.status !== 200) return { kind: 'other', status: response.status }
  try {
    return { kind: 'ok', data: await response.json() }
  } catch {
    return { kind: 'error' }
  }
}

// success = passing, failure = failing, still going = running, no runs at all = none.
// Anything else (cancelled, skipped, neutral...) says nothing, so the last value stays.
function buildStatusFrom(data: any): string | null {
  const runs = data?.workflow_runs
  if (!Array.isArray(runs)) return null
  if (runs.length === 0) return 'none'
  const run = runs[0]
  if (run?.status && run.status !== 'completed') return 'running'
  if (run?.conclusion === 'success') return 'passing'
  if (run?.conclusion === 'failure' || run?.conclusion === 'timed_out' || run?.conclusion === 'startup_failure') return 'failing'
  return null
}

function issuesFrom(data: any): unknown[] | null {
  if (!Array.isArray(data)) return null
  return data
    .filter((item) => item && typeof item === 'object' && !('pull_request' in item))
    .slice(0, 10)
    .map((item) => ({
      number: item.number,
      title: item.title,
      comments: item.comments,
      url: item.html_url,
      created_at: item.created_at,
    }))
}

export async function runExtras(env: Env, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<ExtrasSummary> {
  const summary: ExtrasSummary = { checked: 0, skipped: 0, stopped: null }
  const started = now()

  const projects: Project[] = await callDatabase(env, fetchFn, 'projects_for_extras', { p_limit: EXTRAS_BATCH_SIZE })
  let consecutiveErrors = 0

  for (const project of projects) {
    if (now() - started > EXTRAS_TIME_BUDGET_MS) {
      summary.stopped = 'time_budget'
      break
    }

    const base = `https://api.github.com/repos/${encodeURIComponent(project.github_owner)}/${encodeURIComponent(project.github_repo)}`

    const repo = await githubGet(env, fetchFn, base)
    if (repo.kind === 'rate_limited') { summary.stopped = 'github_rate_limit'; break }

    let buildStatus: string | null = null
    let issues: unknown[] | null = null
    let failed = false

    if (repo.kind === 'ok' && repo.data?.private !== true) {
      const branch = typeof repo.data?.default_branch === 'string' ? repo.data.default_branch : ''

      const found = await githubGet(env, fetchFn, `${base}/issues?labels=${encodeURIComponent('good first issue')}&state=open&per_page=30`)
      if (found.kind === 'rate_limited') { summary.stopped = 'github_rate_limit'; break }
      if (found.kind === 'ok') issues = issuesFrom(found.data)
      else failed = true

      if (branch) {
        const runs = await githubGet(env, fetchFn, `${base}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1&exclude_pull_requests=true`)
        if (runs.kind === 'rate_limited') { summary.stopped = 'github_rate_limit'; break }
        if (runs.kind === 'ok') buildStatus = buildStatusFrom(runs.data)
        else failed = true
      }
    } else if (repo.kind !== 'ok') {
      failed = true
    }

    if (failed) {
      summary.skipped++
      consecutiveErrors++
    } else {
      consecutiveErrors = 0
    }

    // Always sent, even when nothing could be read, so one stubborn project cannot block the others.
    // Empty values mean "leave what is there".
    await callDatabase(env, fetchFn, 'record_github_extras', {
      p_project: project.project_id,
      p_build_status: buildStatus,
      p_issues: issues,
    })
    summary.checked++

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      summary.stopped = 'github_errors'
      break
    }
  }

  return summary
}

// Supabase's newer projects give the secret keys as a JSON list of name and key.
function firstSecretKey(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const first = Object.values(parsed ?? {})[0]
    return typeof first === 'string' ? first : ''
  } catch {
    return ''
  }
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'use POST' }, 405)

  const cronSecret = getEnv('CRON_SECRET') ?? ''
  const supabaseUrl = getEnv('SUPABASE_URL') ?? ''
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || ''
  if (cronSecret.length < 16 || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'the checker is not configured' }, 500)
  }

  const sent = request.headers.get('x-cron-secret') ?? ''
  if (!sameSecret(sent, cronSecret)) return jsonResponse({ error: 'not allowed' }, 401)

  try {
    const env = { supabaseUrl, serviceKey, cronSecret, githubToken: getEnv('GITHUB_TOKEN') || undefined }
    const summary = await runSync(env, fetchFn)
    // The second pass never makes the run fail: the main check has already been done.
    let extras: ExtrasSummary | { error: string }
    if (summary.stopped === 'github_rate_limit') {
      extras = { checked: 0, skipped: 0, stopped: 'github_rate_limit' }
    } else {
      try {
        extras = await runExtras(env, fetchFn)
      } catch (error) {
        console.error('github-sync extras failed', error instanceof Error ? error.message : error)
        extras = { error: 'the second pass failed, see the function logs' }
      }
    }
    return jsonResponse({ ...summary, extras })
  } catch (error) {
    // Details stay in the logs, not in the answer.
    console.error('github-sync failed', error instanceof Error ? error.message : error)
    return jsonResponse({ error: 'the run failed, see the function logs' }, 500)
  }
}

// Start the web service when running inside Supabase (Deno). Skipped in tests.
const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
