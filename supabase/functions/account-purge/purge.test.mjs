// Test for the account purge. The database and Storage are pretend: this checks the order of the steps and the
// safety rules (files before account, blocked accounts kept, failures stop the run).
//
//   node --experimental-strip-types supabase/functions/account-purge/purge.test.mjs

import assert from 'node:assert/strict'
import { handler, runPurge } from './index.ts'

const SECRET = 'cron-secret-0123456789'
const VALUES = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key-0123456789', CRON_SECRET: SECRET }
const getEnv = (overrides = {}) => (name) => ({ ...VALUES, ...overrides })[name]
const ENV = { supabaseUrl: VALUES.SUPABASE_URL, serviceKey: VALUES.SUPABASE_SERVICE_ROLE_KEY, cronSecret: SECRET }
const U = (n) => `00000000-0000-0000-0000-00000000000${n}`

let due, blockers, files, calls, failFor, failStorageFor, failDue, deletedFiles
function reset() {
  due = []; blockers = {}; files = {}; calls = []; failFor = new Set(); failStorageFor = new Set(); failDue = false; deletedFiles = []
}
const fetchFn = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {}
  const ok = (data) => new Response(JSON.stringify(data), { status: 200 })
  assert.equal(init.headers.apikey, VALUES.SUPABASE_SERVICE_ROLE_KEY)
  if (url.includes('/storage/v1/object/')) {
    const bucket = url.split('/storage/v1/object/')[1]
    calls.push(`storage:${bucket}`)
    if (body.prefixes.some((n) => failStorageFor.has(n.split('/')[0]))) return new Response('{}', { status: 500 })
    deletedFiles.push(...body.prefixes.map((n) => `${bucket}/${n}`))
    return ok([])
  }
  const name = url.split('/rpc/')[1]
  calls.push(`${name}:${body.p_user ?? ''}`)
  if (name === 'accounts_due_for_deletion') return failDue ? new Response('{}', { status: 500 }) : ok(due.map((id) => ({ user_id: id })))
  if (failFor.has(`${name}:${body.p_user}`)) return new Response('{}', { status: 500 })
  if (name === 'account_blockers_for') return ok(blockers[body.p_user] ?? [])
  if (name === 'account_files') return ok(files[body.p_user] ?? [])
  if (name === 'abort_account_deletion' || name === 'purge_account') return ok(null)
  throw new Error(`unexpected call ${name}`)
}
const post = (secret = SECRET, env = getEnv()) =>
  handler(new Request('https://db.test/fn', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} }), env, fetchFn)
let count = 0
const ok = (what) => { count += 1; console.log(`OK ${count}: ${what}`) }

// ---- 1. Setup and who may start a run ---------------------------------------------------------------------------------
reset()
assert.equal((await post(SECRET, getEnv({ SUPABASE_URL: '' }))).status, 503)
assert.equal((await post(SECRET, getEnv({ SUPABASE_SERVICE_ROLE_KEY: '' }))).status, 503)
assert.equal((await post(SECRET, getEnv({ CRON_SECRET: 'short' }))).status, 503)
assert.equal((await post(null)).status, 401)
assert.equal((await post('wrong')).status, 401)
assert.equal((await handler(new Request('https://db.test/fn'), getEnv(), fetchFn)).status, 405)
assert.equal((await handler(new Request('https://db.test/fn', { method: 'OPTIONS' }), getEnv(), fetchFn)).status, 204)
assert.equal(calls.length, 0)
ok('missing settings, a wrong or missing password and a GET are refused before anything is touched')

// ---- 2. Files are deleted first, then the account ------------------------------------------------------------------------
reset()
due = [U(1)]
files[U(1)] = [
  { bucket_id: 'dm-files', name: `${U(1)}/a.png` }, { bucket_id: 'dm-files', name: `${U(1)}/b.png` },
  { bucket_id: 'cv-files', name: `${U(1)}/cv.pdf` }, { bucket_id: 'souk-images', name: `${U(1)}/i.webp` },
]
let res = await post()
assert.deepEqual(await res.json(), { due: 1, deleted: 1, kept: 0, failed: 0, stopped: null })
assert.deepEqual(calls, [
  'accounts_due_for_deletion:', `account_blockers_for:${U(1)}`, `account_files:${U(1)}`,
  'storage:dm-files', 'storage:cv-files', 'storage:souk-images', `purge_account:${U(1)}`,
])
assert.deepEqual(deletedFiles.sort(), [`cv-files/${U(1)}/cv.pdf`, `dm-files/${U(1)}/a.png`, `dm-files/${U(1)}/b.png`, `souk-images/${U(1)}/i.webp`].sort())
ok('blockers are checked, the files go (bucket by bucket), and only then is the account purged')

// ---- 3. A file that cannot be deleted keeps the account for the next run -------------------------------------------------
reset()
due = [U(1), U(2)]
files[U(1)] = [{ bucket_id: 'dm-files', name: `${U(1)}/a.png` }]
files[U(2)] = [{ bucket_id: 'dm-files', name: `${U(2)}/a.png` }]
failStorageFor = new Set([U(1)])
res = await post()
assert.deepEqual(await res.json(), { due: 2, deleted: 1, kept: 0, failed: 1, stopped: null })
assert.equal(calls.includes(`purge_account:${U(1)}`), false, 'no purge after a failed file deletion')
assert.equal(calls.includes(`purge_account:${U(2)}`), true)
ok('a failed file deletion keeps that account for the next run and does not hold back the others')

// ---- 4. An account that can no longer be deleted is sent back to normal --------------------------------------------------
reset()
due = [U(1)]
blockers[U(1)] = [{ code: 'staff', detail: 1 }]
files[U(1)] = [{ bucket_id: 'dm-files', name: `${U(1)}/a.png` }]
res = await post()
assert.deepEqual(await res.json(), { due: 1, deleted: 0, kept: 1, failed: 0, stopped: null })
assert.deepEqual(calls, ['accounts_due_for_deletion:', `account_blockers_for:${U(1)}`, `abort_account_deletion:${U(1)}`])
assert.equal(deletedFiles.length, 0, 'no file of a kept account is touched')
ok('a blocked account keeps its files and its login, and its request is cancelled')

// ---- 5. Only the member's own files in the known buckets are ever deleted -------------------------------------------------
reset()
due = [U(1)]
files[U(1)] = [
  { bucket_id: 'dm-files', name: `${U(1)}/ok.png` },
  { bucket_id: 'dm-files', name: `${U(2)}/someone-elses.png` },
  { bucket_id: 'public-assets', name: `${U(1)}/wrong-bucket.png` },
  { bucket_id: 'dm-files', name: '../escape.png' },
  { bucket_id: 'cv-files' },
  null,
]
await post()
assert.deepEqual(deletedFiles, [`dm-files/${U(1)}/ok.png`])
ok("a name outside the member's folder, an unknown bucket or a malformed row is ignored, even if the database listed it")

// ---- 6. Failures: three in a row stop the run; a success resets the count -------------------------------------------------
reset()
due = [U(1), U(2), U(3), U(4), U(5)]
failFor = new Set([`purge_account:${U(1)}`, `purge_account:${U(2)}`, `purge_account:${U(3)}`])
res = await post()
assert.deepEqual(await res.json(), { due: 5, deleted: 0, kept: 0, failed: 3, stopped: 'three failures in a row' })
reset()
due = [U(1), U(2), U(3), U(4), U(5)]
failFor = new Set([`purge_account:${U(1)}`, `purge_account:${U(2)}`, `purge_account:${U(4)}`, `purge_account:${U(5)}`])
res = await post()
assert.deepEqual(await res.json(), { due: 5, deleted: 1, kept: 0, failed: 4, stopped: null })
ok('three failures in a row stop the run; two failures, a success, then two failures do not')

// ---- 7. Nothing due, database trouble, time budget ---------------------------------------------------------------------------
reset()
assert.deepEqual(await (await post()).json(), { due: 0, deleted: 0, kept: 0, failed: 0, stopped: null })
reset()
failDue = true
res = await post()
assert.equal(res.status, 502)
reset()
due = [U(1), U(2), U(3)]
let clock = 0
const summary = await runPurge(ENV, fetchFn, () => (clock += 60_000))
assert.equal(summary.stopped, 'time budget used')
assert.ok(summary.deleted < 3)
ok('nothing due does nothing; a database failure is reported; the time budget stops a long run')

// ---- 8. The blocker check failing is a failure, never a go-ahead ---------------------------------------------------------
reset()
due = [U(1)]
failFor = new Set([`account_blockers_for:${U(1)}`])
res = await post()
assert.deepEqual(await res.json(), { due: 1, deleted: 0, kept: 0, failed: 1, stopped: null })
assert.equal(calls.some((c) => c.startsWith('purge_account') || c.startsWith('storage')), false)
ok('if the blocker check itself fails, nothing is deleted');

console.log(`ALL ACCOUNT PURGE TESTS PASSED (${count})`)
