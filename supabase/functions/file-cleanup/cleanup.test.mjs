// Test for the file cleanup, against a REAL PostgreSQL database.
//
// Run it AFTER the migrations are applied and the PG* variables point to the test database:
//   node --experimental-strip-types supabase/functions/file-cleanup/cleanup.test.mjs
//
// A small stand-in for Supabase runs the real database function as "service_role" and
// pretends to be Storage: its delete call removes the rows from the test storage table.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { handler, runCleanup } from './index.ts'

function psql(sql, vars = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  args.push('-f', '-')
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

const SERVICE_KEY = 'test-service-key-0123456789'
const NEW_KEY = 'sb_secret_test0123456789'
const CRON_SECRET = 'test-cron-secret-0123456789'
const UID = 'd5d5d5d5-0000-0000-0000-000000000001'

const storageCalls = []
let storageMode = 'ok' // ok | fail | partial
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    try {
      const legacyOk = req.headers.apikey === SERVICE_KEY && req.headers.authorization === `Bearer ${SERVICE_KEY}`
      const newOk = req.headers.apikey === NEW_KEY && req.headers.authorization === undefined
      if (!legacyOk && !newOk) return answer(401, { message: 'bad key' })
      const payload = Buffer.concat(chunks).toString() || '{}'
      if (req.url === '/rest/v1/rpc/files_to_clean' && req.method === 'POST') {
        const out = psql(
          `set role service_role;
           select coalesce(jsonb_agg(t), '[]'::jsonb) from public.files_to_clean(p_limit := (:'payload'::jsonb ->> 'p_limit')::int) t;`,
          { payload },
        )
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(out.split('\n').filter((l) => l !== 'SET').pop())
      }
      const m = req.url.match(/^\/storage\/v1\/object\/([a-z-]+)$/)
      if (m && req.method === 'DELETE') {
        const prefixes = JSON.parse(payload).prefixes
        storageCalls.push({ bucket: m[1], prefixes })
        if (storageMode === 'fail') return answer(500, { message: 'storage down' })
        const names = storageMode === 'partial' ? prefixes.slice(0, 1) : prefixes
        const gone = names.map((n) => ({ name: n }))
        for (const n of names) psql(`delete from storage.objects where bucket_id = :'b' and name = :'n';`, { b: m[1], n })
        return answer(200, gone)
      }
      answer(404, { message: 'unknown' })
    } catch (e) {
      answer(400, { message: String(e.message).slice(0, 300) })
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const SUPABASE_URL = `http://127.0.0.1:${server.address().port}`
const env = (extra = {}) => ({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, cronSecret: CRON_SECRET, ...extra })
const count = (where = 'true') => Number(psql(`select count(*) from storage.objects where name like '${UID}/%' and ${where};`))

let passed = 0
const ok = (message) => { passed++; console.log(`OK ${passed}: ${message}`) }

const addFiles = (bucket, prefix, n, hours = 100) =>
  psql(`insert into storage.objects (bucket_id, name, created_at)
        select '${bucket}', '${UID}/${prefix}-' || g, now() - make_interval(hours => ${hours}) from generate_series(1, ${n}) g;`)

try {
  psql(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values ('${UID}', 'cleanup-ama@exemple.sn', '{"provider":"email"}', '{}');
    -- a clean slate: files left by other tests are made fresh so they are not listed
    update storage.objects set created_at = now();
    insert into public.application_files (user_id, cv_path, cv_name, cv_size, cv_uploaded_at)
      values ('${UID}', '${UID}/cv-keep', 'cv.pdf', 10, now());
    insert into storage.objects (bucket_id, name, created_at) values
      ('cv-files', '${UID}/cv-keep', now() - interval '100 hours'),
      ('cv-files', '${UID}/cv-new', now() - interval '1 hour'),
      ('dm-files', '${UID}/dm-keep', now() - interval '100 hours');
  `)
  addFiles('cv-files', 'cv-old', 2)
  addFiles('souk-images', 'img-old', 2)

  // ---- 1. A normal run -------------------------------------------------------------------------------
  const first = await runCleanup(env(), fetch)
  assert.deepEqual(first, { found: 4, deleted: 4, failed: 0, stopped: null })
  assert.equal(count(), 3, 'only the used, the fresh and the message file remain')
  assert.equal(count(`name = '${UID}/cv-keep'`), 1, 'the current CV stays')
  assert.equal(count(`name = '${UID}/cv-new'`), 1, 'a fresh file stays')
  assert.equal(count(`bucket_id = 'dm-files'`), 1, 'message files are never touched')
  assert.deepEqual(storageCalls.map((c) => c.bucket).sort(), ['cv-files', 'souk-images'])
  ok('unused old files are deleted through Storage; used, fresh and message files stay')

  // ---- 2. Nothing to do ------------------------------------------------------------------------------------
  storageCalls.length = 0
  assert.deepEqual(await runCleanup(env(), fetch), { found: 0, deleted: 0, failed: 0, stopped: null })
  assert.equal(storageCalls.length, 0, 'no Storage call when there is nothing to delete')
  ok('with nothing to clean, Storage is not called')

  // ---- 3. Big batches are deleted in chunks ------------------------------------------------------------------
  addFiles('cv-files', 'cv-many', 120)
  storageCalls.length = 0
  const big = await runCleanup(env(), fetch)
  assert.equal(big.deleted, 120)
  assert.ok(storageCalls.every((c) => c.prefixes.length <= 50), 'chunks of at most 50')
  assert.equal(storageCalls.length, 3)
  ok('many files are deleted in chunks of 50')

  // ---- 4. Storage down: files stay, run stops after three failures ---------------------------------------------
  addFiles('cv-files', 'cv-down', 160)
  storageMode = 'fail'
  storageCalls.length = 0
  const down = await runCleanup(env(), fetch)
  storageMode = 'ok'
  assert.equal(down.stopped, 'storage_errors')
  assert.equal(down.deleted, 0)
  assert.equal(storageCalls.length, 3)
  assert.equal(count(`name like '${UID}/cv-down-%'`), 160, 'nothing is lost when Storage fails')
  ok('when Storage is down nothing is lost and the run stops after three failures')

  // ---- 5. Partial answers are counted honestly ----------------------------------------------------------------------
  storageMode = 'partial'
  const partial = await runCleanup(env(), fetch)
  storageMode = 'ok'
  assert.ok(partial.deleted > 0 && partial.deleted < partial.found, 'only what Storage really removed is counted')
  assert.equal(partial.deleted, count(`name like '${UID}/cv-down-%'`) === 160 - partial.deleted ? partial.deleted : -1, 'the count matches the files really gone')
  assert.ok(count(`name like '${UID}/cv-down-%'`) > 0, 'files Storage did not remove are still there')
  const again = await runCleanup(env(), fetch)
  assert.equal(again.failed, 0)
  ok('files Storage did not remove stay and are listed again next time')

  // ---- 6. Time budget ----------------------------------------------------------------------------------------------------------
  psql(`delete from storage.objects where name like '${UID}/cv-down-%';`)
  addFiles('cv-files', 'cv-time', 120)
  let clock = 0
  const slow = await runCleanup(env(), fetch, () => (clock += 60_000))
  assert.equal(slow.stopped, 'time_budget')
  assert.ok(slow.deleted < 120)
  psql(`delete from storage.objects where name like '${UID}/cv-time-%';`)
  ok('a run that takes too long stops cleanly')

  // ---- 7. Who may start a run ------------------------------------------------------------------------------------------------
  const getEnv = (extra = {}) => (name) => ({ CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...extra })[name]
  const post = (headers = {}, method = 'POST') => new Request('http://localhost/', { method, headers })
  assert.equal((await handler(post(), getEnv())).status, 401, 'no secret')
  assert.equal((await handler(post({ 'x-cron-secret': 'wrong-secret-0123456789' }), getEnv())).status, 401, 'wrong secret')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }, 'GET'), getEnv())).status, 405, 'GET is refused')
  assert.equal((await handler(post({ 'x-cron-secret': 'short' }), getEnv({ CRON_SECRET: 'short' }))).status, 500, 'a weak secret is refused')
  assert.equal((await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_URL: '' }))).status, 500, 'missing configuration')
  addFiles('cv-files', 'cv-handler', 1)
  const good = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv())
  assert.equal(good.status, 200)
  assert.deepEqual(await good.json(), { found: 1, deleted: 1, failed: 0, stopped: null })
  ok('only a caller with the secret can start a run')

  // ---- 8. Newer key format, and a wrong key ------------------------------------------------------------------------------------
  addFiles('cv-files', 'cv-newkey', 1)
  const newStyle = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEYS: JSON.stringify({ default: NEW_KEY }) }))
  assert.equal(newStyle.status, 200)
  assert.equal((await newStyle.json()).deleted, 1)
  addFiles('cv-files', 'cv-badkey', 1)
  const broken = await handler(post({ 'x-cron-secret': CRON_SECRET }), getEnv({ SUPABASE_SERVICE_ROLE_KEY: 'wrong-key-0123456789' }))
  assert.equal(broken.status, 500)
  assert.ok(!(await broken.text()).includes('wrong-key'), 'the key must never appear in an answer')
  assert.equal(count(`name like '${UID}/cv-badkey-%'`), 1, 'nothing deleted with a wrong key')
  ok('the newer key format works, and a wrong key deletes nothing and never shows the key')

  // ---- 9. Only the two named buckets, only listed names -----------------------------------------------------------------------------
  const rogue = (url, init) =>
    String(url).endsWith('/rest/v1/rpc/files_to_clean')
      ? Promise.resolve(new Response(JSON.stringify([{ bucket_id: 'dm-files', name: `${UID}/dm-keep` }, { bucket_id: 'cv-files', name: '' }]), { status: 200 }))
      : fetch(url, init)
  storageCalls.length = 0
  const guarded = await runCleanup(env(), rogue)
  assert.equal(guarded.found, 0)
  assert.equal(storageCalls.length, 0, 'a bucket that is not allowed is never deleted from')
  assert.equal(count(`bucket_id = 'dm-files'`), 1)
  ok('even if the list were wrong, other buckets and empty names are never deleted')

  psql(`
    delete from storage.objects where name like '${UID}/%';
    delete from public.application_files where user_id = '${UID}';
    delete from public.profiles where id = '${UID}';
    delete from auth.users where id = '${UID}';
  `)
  console.log(`ALL FILE CLEANUP TESTS PASSED (${passed})`)
} catch (error) {
  console.error('FAIL:', error.message)
  process.exitCode = 1
} finally {
  server.close()
}
