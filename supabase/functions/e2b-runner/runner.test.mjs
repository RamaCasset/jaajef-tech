// Test for the E2B runner. The sandbox is replaced by a folder on this machine, but the player's code and the
// small driver programs REALLY run (python3 and node), so what is tested is the real behaviour.
//
//   node --experimental-strip-types supabase/functions/e2b-runner/runner.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handler, sameJson } from './index.ts'

const KEY = 'runner-key-0123456789'
let opened = 0
let closed = 0
let failOpen = false
const written = [] // every file content that reached the "sandbox"

function localFactory() {
  return async () => {
    opened += 1
    if (failOpen) throw new Error('no capacity')
    const dir = mkdtempSync(path.join(tmpdir(), 'e2b-test-'))
    return {
      workdir: dir,
      async writeFile(p, content) { written.push(content); writeFileSync(p, content) },
      run(command, timeoutMs) {
        return new Promise((resolve) => {
          const child = spawn('sh', ['-c', command], { cwd: dir, detached: true })
          let stdout = ''
          let stderr = ''
          let timedOut = false
          child.stdout.on('data', (d) => { stdout += d })
          child.stderr.on('data', (d) => { stderr += d })
          const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ } }, timeoutMs)
          child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr, timedOut }) })
        })
      },
      async close() { closed += 1; rmSync(dir, { recursive: true, force: true }) },
    }
  }
}

const env = (name) => ({ E2B_API_KEY: 'e2b-test', RUNNER_KEY: KEY })[name]
async function call(body, { auth = `Bearer ${KEY}`, method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  const res = await handler(new Request('http://x/run', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined }), env, localFactory())
  return { status: res.status, body: await res.json() }
}
const tests = (...pairs) => pairs.map(([input, expected], i) => ({ name: `t${i + 1}`, input, expected }))
const py = (code, t, extra = {}) => call({ language: 'python', entry_point: 'solve', code, tests: t, time_limit_ms: 3000, ...extra })
const js = (code, t, extra = {}) => call({ language: 'javascript', entry_point: 'solve', code, tests: t, time_limit_ms: 3000, ...extra })
const passes = (r) => r.body.results.map((x) => x.passed)
let count = 0
const ok = (what) => { count += 1; console.log(`OK ${count}: ${what}`) }

// ---- 1. Python: right and wrong answers --------------------------------------------------------------------------
{
  const code = 'def solve(values):\n    return sum(values)\n'
  const r = await py(code, tests([[1, 2, 3], 6], [[], 0], [[5], 99]))
  assert.equal(r.status, 200)
  assert.deepEqual(passes(r), [true, true, false])
  assert.deepEqual(r.body.results.map((x) => x.name), ['t1', 't2', 't3'])
  assert.equal(r.body.results[2].error, undefined, 'a wrong answer is not an error')
  ok('python: right answers pass, a wrong one fails without an error message')
}

// ---- 2. Python: None is null, floats, nested data, key order -----------------------------------------------------
{
  const code = 'def solve(v):\n    if v == "none": return None\n    if v == "obj": return {"b": [1, 2.5], "a": "é"}\n    return v\n'
  const r = await py(code, tests(['none', null], ['obj', { a: 'é', b: [1, 2.5] }], ['obj', { a: 'é', b: [2.5, 1] }]))
  assert.deepEqual(passes(r), [true, true, false])
  ok('python: None equals null, objects compare whatever the key order, arrays keep their order')
}

// ---- 3. Python: errors are reported briefly ----------------------------------------------------------------------
{
  const r = await py('def solve(v):\n    return 1 / 0\n', tests([1, 1]))
  assert.equal(r.body.results[0].passed, false)
  assert.equal(r.body.results[0].error, 'ZeroDivisionError: division by zero')
  const missing = await py('def other(v):\n    return v\n', tests([1, 1]))
  assert.match(missing.body.results[0].error, /Function solve is not defined/)
  const syntax = await py('def solve(v)\n    return v\n', tests([1, 1]))
  assert.match(syntax.body.results[0].error, /SyntaxError/)
  const notJson = await py('def solve(v):\n    return {1, 2}\n', tests([1, 1]))
  assert.equal(notJson.body.results[0].passed, false)
  assert.ok(notJson.body.results[0].error.length > 0 && notJson.body.results[0].error.length <= 200)
  ok('python: a crash, a missing function, a syntax error and an unusable value fail the test with a short message')
}

// ---- 4. Python: endless loop stops at the time limit ------------------------------------------------------------------
{
  const started = Date.now()
  const r = await py('def solve(v):\n    while True:\n        pass\n', tests([1, 1]), { time_limit_ms: 800 })
  assert.equal(r.body.results[0].passed, false)
  assert.equal(r.body.results[0].error, 'Time limit exceeded')
  assert.ok(Date.now() - started < 5000)
  ok('python: an endless loop is stopped at the time limit')
}

// ---- 5. Player output cannot fake a result ------------------------------------------------------------------------------
{
  const noise = 'import sys\nprint("@@fake@@ 7")\nprint("hello")\ndef solve(v):\n    print("@@0000@@7")\n    return 1\n'
  const r = await py(noise, tests([1, 7], [1, 1]))
  assert.deepEqual(passes(r), [false, true])
  ok('python: lines the player prints are ignored; guessing the marker does not help')
}

// ---- 6. Awkward inputs arrive unchanged ----------------------------------------------------------------------------------
{
  const odd = ['guillemets " et \' et \\ ', 'ligne\nnouvelle', 'émoji 🌍   fin', { k: [null, true, 1.5] }, '', 0]
  const r = await py('def solve(v):\n    return v\n', tests(...odd.map((v) => [v, v])))
  assert.deepEqual(passes(r), odd.map(() => true))
  const r2 = await js('function solve(v) { return v }', tests(...odd.map((v) => [v, v])))
  assert.deepEqual(passes(r2), odd.map(() => true))
  ok('quotes, newlines, emoji, objects and empty values reach the function unchanged (python and javascript)')
}

// ---- 7. JavaScript -----------------------------------------------------------------------------------------------------------------
{
  const r = await js('function solve(values) { return values.reduce((a, b) => a + b, 0) }', tests([[1, 2, 3], 6], [[], 0], [[5], 99]))
  assert.deepEqual(passes(r), [true, true, false])
  const arrow = await js('const solve = (v) => v * 2', tests([2, 4]))
  assert.deepEqual(passes(arrow), [true])
  const nothing = await js('function solve(v) { }', tests([1, null]))
  assert.deepEqual(passes(nothing), [true], 'a function that returns nothing counts as null')
  const boom = await js('function solve(v) { throw new TypeError("nope") }', tests([1, 1]))
  assert.equal(boom.body.results[0].error, 'TypeError: nope')
  const missing = await js('function other(v) { return v }', tests([1, 1]))
  assert.match(missing.body.results[0].error, /Function solve is not defined/)
  const loop = await js('function solve(v) { while (true) {} }', tests([1, 1]), { time_limit_ms: 800 })
  assert.equal(loop.body.results[0].error, 'Time limit exceeded')
  const wrongType = await js('function solve(v) { return String(v) }', tests([1, 1]))
  assert.deepEqual(passes(wrongType), [false], '"1" is not 1')
  ok('javascript: functions, arrows, null, errors, missing function, endless loop and type strictness')
}

// ---- 8. Tests do not share state ---------------------------------------------------------------------------------------------
{
  const r = await py('calls = []\ndef solve(v):\n    calls.append(v)\n    return len(calls)\n', tests([1, 1], [2, 1], [3, 1]))
  assert.deepEqual(passes(r), [true, true, true])
  ok('each test runs on its own: nothing carries over from one test to the next')
}

// ---- 9. The expected answers never enter the sandbox ----------------------------------------------------------------
{
  written.length = 0
  await py('def solve(v):\n    return v\n', tests([1, 'SECRET-EXPECTED-VALUE-42']))
  assert.ok(written.length >= 2)
  assert.equal(written.some((c) => c.includes('SECRET-EXPECTED-VALUE-42')), false)
  ok('the expected values are never written into the sandbox')
}

// ---- 10. The request is checked -------------------------------------------------------------------------------------------------
{
  const good = { language: 'python', entry_point: 'solve', code: 'def solve(v): return v', tests: tests([1, 1]) }
  assert.equal((await call(good, { auth: null })).status, 401)
  assert.equal((await call(good, { auth: 'Bearer wrong' })).status, 401)
  assert.equal((await call(good, { method: 'GET' })).status, 405)
  assert.equal((await call({ ...good, language: 'ruby' })).status, 400)
  assert.equal((await call({ ...good, entry_point: 'solve; rm -rf /' })).status, 400)
  assert.equal((await call({ ...good, entry_point: '1abc' })).status, 400)
  assert.equal((await call({ ...good, code: '' })).status, 400)
  assert.equal((await call({ ...good, code: 'x'.repeat(50_001) })).status, 400)
  assert.equal((await call({ ...good, tests: [] })).status, 400)
  assert.equal((await call({ ...good, tests: [{ name: 'a' }] })).status, 400)
  assert.equal((await call({ ...good, tests: Array.from({ length: 51 }, (_, i) => ({ name: `n${i}`, input: 1, expected: 1 })) })).status, 400)
  const opens = opened
  await call({ ...good, language: 'ruby' })
  assert.equal(opened, opens, 'a refused request does not open a sandbox')
  ok('wrong password, wrong method, unknown language, unsafe function name, empty or oversized input are all refused before any sandbox opens')
}

// ---- 11. The sandbox is always closed; a failure to open one is reported -------------------------------------------------
{
  const openedBefore = opened
  const closedBefore = closed
  await py('def solve(v):\n    return 1/0\n', tests([1, 1]))
  await py('def solve(v):\n    while True: pass\n', tests([1, 1]), { time_limit_ms: 600 })
  assert.equal(opened - openedBefore, 2)
  assert.equal(closed - closedBefore, 2)
  failOpen = true
  const r = await py('def solve(v): return v', tests([1, 1]))
  failOpen = false
  assert.equal(r.status, 502)
  assert.equal(r.body.error, 'sandbox_unavailable')
  ok('every sandbox is closed, even after a crash or a timeout; no capacity gives a clear 502')
}

// ---- 12. Setup ----------------------------------------------------------------------------------------------------------------------
{
  const res = await handler(new Request('http://x', { method: 'POST' }), () => undefined)
  assert.equal(res.status, 503)
  const half = await handler(new Request('http://x', { method: 'POST' }), (n) => (n === 'RUNNER_KEY' ? 'k' : undefined))
  assert.equal(half.status, 503)
  ok('without both secrets the function says it is not set up')
}

// ---- 13. Comparison helper ----------------------------------------------------------------------------------------------------
assert.equal(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true)
assert.equal(sameJson([1, 2], [2, 1]), false)
assert.equal(sameJson(null, 0), false)
assert.equal(sameJson({}, []), false)
assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false)
assert.equal(sameJson(1, '1'), false)
ok('JSON comparison is strict about types and lengths')

console.log(`ALL E2B RUNNER TESTS PASSED (${count})`)
