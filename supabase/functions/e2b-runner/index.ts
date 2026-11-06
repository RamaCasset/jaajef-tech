// jaajef.tech - The code runner, backed by E2B (Supabase Edge Function)
//
// This is the "runner" that run-quest talks to. It receives
//   { language, entry_point, code, tests: [{ name, input, expected }], time_limit_ms }
// runs the player's code inside a throwaway E2B sandbox (no internet, destroyed afterwards), and answers
//   { results: [{ name, passed, error? }] }
//
// How a test works: the sandbox only ever receives the player's code and ONE test input. It calls the function
// named entry_point with that input as its single argument and prints what the function returned. The comparison
// with the expected value happens HERE, outside the sandbox, so the expected values never enter the sandbox and
// the player's code cannot read them.
//
// Secrets: E2B_API_KEY (from the E2B account) and RUNNER_KEY (the same password run-quest sends; set it to the
// same value in both places). "Verify JWT" must be OFF for this function, like github-sync.

export type TestSpec = { name: string; input: unknown; expected: unknown }
export type TestResult = { name: string; passed: boolean; error?: string }

/** What the runner needs from a sandbox. The real one is E2B; the tests plug in a local stand-in. */
export type SandboxClient = {
  workdir: string
  writeFile(path: string, content: string): Promise<void>
  run(command: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  close(): Promise<void>
}
export type SandboxFactory = (options: { lifetimeMs: number }) => Promise<SandboxClient>

const MAX_CODE_CHARS = 50_000
const MAX_TESTS = 50
const MIN_LIMIT_MS = 500
const MAX_LIMIT_MS = 10_000
const DEFAULT_LIMIT_MS = 5_000
const ENTRY_POINT = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/
const MAX_MESSAGE = 200

const JSON_HEADERS = { 'content-type': 'application/json' }
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- The small programs that run inside the sandbox ------------------------------------------------------------

function pythonDriver(entry: string, input: unknown, marker: string, dir: string): string {
  return [
    'import json, sys',
    `ENTRY = ${JSON.stringify(entry)}`,
    `ARG = json.loads(${JSON.stringify(JSON.stringify(input))})`,
    `MARKER = ${JSON.stringify(marker)}`,
    `source = open(${JSON.stringify(`${dir}/player.py`)}).read()`,
    "namespace = {'__name__': 'player'}",
    "exec(compile(source, 'player.py', 'exec'), namespace)",
    'fn = namespace.get(ENTRY)',
    'if not callable(fn):',
    "    raise NameError('Function ' + ENTRY + ' is not defined')",
    'result = fn(ARG)',
    "sys.stdout.write('\\n' + MARKER + json.dumps(result) + '\\n')",
    '',
  ].join('\n')
}

function javascriptDriver(entry: string, input: unknown, marker: string, dir: string): string {
  return [
    "const fs = require('fs')",
    "const vm = require('vm')",
    `const ENTRY = ${JSON.stringify(entry)}`,
    `const ARG = JSON.parse(${JSON.stringify(JSON.stringify(input))})`,
    `const MARKER = ${JSON.stringify(marker)}`,
    `const source = fs.readFileSync(${JSON.stringify(`${dir}/player.js`)}, 'utf8')`,
    "const fn = vm.runInThisContext(source + '\\n;(typeof ' + ENTRY + \" === 'function' ? \" + ENTRY + ' : undefined)', { filename: 'player.js' })",
    "if (typeof fn !== 'function') throw new Error('Function ' + ENTRY + ' is not defined')",
    'const result = fn(ARG)',
    "if (result && typeof result.then === 'function') throw new Error('Asynchronous functions are not supported')",
    "const text = JSON.stringify(result === undefined ? null : result)",
    "process.stdout.write('\\n' + MARKER + text + '\\n')",
    '',
  ].join('\n')
}

// ---- Reading what came back -----------------------------------------------------------------------------------------

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE - 1)}…` : flat
}

/** The one useful line of an error: Python puts it last, Node prints "SomeError: message" near the top. */
function errorLine(language: string, stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return 'The code stopped without a message'
  if (language === 'python') return shorten(lines[lines.length - 1])
  const named = lines.find((l) => /^[A-Za-z]*Error\b/.test(l))
  return shorten(named ?? lines[lines.length - 1])
}

/** Picks the printed result out of the output, ignoring anything else the player's code printed. */
function readResult(stdout: string, marker: string): { found: boolean; value?: unknown } {
  for (const line of stdout.split('\n').reverse()) {
    if (!line.startsWith(marker)) continue
    try { return { found: true, value: JSON.parse(line.slice(marker.length)) } } catch { return { found: false } }
  }
  return { found: false }
}

/** Same value, whatever the key order (objects) — arrays keep their order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]))
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every((k) => k in (b as object) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

// ---- The runner ----------------------------------------------------------------------------------------------------------

async function grade(client: SandboxClient, language: 'python' | 'javascript', entry: string, tests: TestSpec[], limitMs: number): Promise<TestResult[]> {
  const dir = client.workdir
  const ext = language === 'python' ? 'py' : 'js'
  const runWith = language === 'python' ? 'python3' : 'node'
  const marker = `@@${randomToken()}@@`
  return Promise.all(tests.map(async (test, i): Promise<TestResult> => {
    try {
      const driverPath = `${dir}/driver_${i}.${ext}`
      const driver = language === 'python' ? pythonDriver(entry, test.input, marker, dir) : javascriptDriver(entry, test.input, marker, dir)
      await client.writeFile(driverPath, driver)
      const out = await client.run(`${runWith} ${driverPath}`, limitMs)
      if (out.timedOut) return { name: test.name, passed: false, error: 'Time limit exceeded' }
      if (out.exitCode !== 0) return { name: test.name, passed: false, error: errorLine(language, out.stderr) }
      const read = readResult(out.stdout, marker)
      if (!read.found) return { name: test.name, passed: false, error: 'The function did not return a usable value' }
      return { name: test.name, passed: sameJson(read.value, test.expected) }
    } catch {
      return { name: test.name, passed: false, error: 'The test could not be run' }
    }
  }))
}

export async function runTests(request: Request, runnerKey: string, openSandbox: SandboxFactory): Promise<Response> {
  if (request.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)
  if (request.headers.get('authorization') !== `Bearer ${runnerKey}`) return respond({ error: 'unauthorized' }, 401)

  let payload: any
  try { payload = await request.json() } catch { return respond({ error: 'bad_request' }, 400) }
  const { language, entry_point: entry, code, tests } = payload ?? {}
  if (language !== 'python' && language !== 'javascript') return respond({ error: 'unsupported_language' }, 400)
  if (typeof entry !== 'string' || !ENTRY_POINT.test(entry)) return respond({ error: 'bad_entry_point' }, 400)
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_CHARS) return respond({ error: 'bad_code' }, 400)
  if (!Array.isArray(tests) || tests.length === 0 || tests.length > MAX_TESTS
      || !tests.every((t) => t && typeof t.name === 'string' && 'input' in t && 'expected' in t)) return respond({ error: 'bad_tests' }, 400)
  const asked = Number(payload.time_limit_ms)
  const limitMs = Math.min(MAX_LIMIT_MS, Math.max(MIN_LIMIT_MS, Number.isFinite(asked) ? asked : DEFAULT_LIMIT_MS))

  let client: SandboxClient | null = null
  try {
    client = await openSandbox({ lifetimeMs: limitMs + 60_000 })
    await client.writeFile(`${client.workdir}/player.${language === 'python' ? 'py' : 'js'}`, code)
    const results = await grade(client, language, entry, tests as TestSpec[], limitMs)
    return respond({ results })
  } catch {
    return respond({ error: 'sandbox_unavailable' }, 502)
  } finally {
    try { await client?.close() } catch { /* the sandbox also expires by itself */ }
  }
}

// ---- E2B itself (loaded only when the function really runs) -------------------------------------------------------

export function e2bFactory(apiKey: string): SandboxFactory {
  return async ({ lifetimeMs }) => {
    const { Sandbox } = await import('npm:e2b@2.63.0')
    const sandbox = await Sandbox.create({ apiKey, timeoutMs: lifetimeMs, allowInternetAccess: false })
    return {
      workdir: '/home/user',
      async writeFile(path, content) { await sandbox.files.write(path, content) },
      async run(command, timeoutMs) {
        try {
          const r = await sandbox.commands.run(command, { timeoutMs })
          return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: false }
        } catch (e: any) {
          if (typeof e?.exitCode === 'number') return { exitCode: e.exitCode, stdout: e.stdout ?? '', stderr: e.stderr ?? '', timedOut: false }
          if (/timeout|timed out|deadline/i.test(`${e?.name} ${e?.message}`)) return { exitCode: -1, stdout: '', stderr: '', timedOut: true }
          throw e
        }
      },
      async close() { await sandbox.kill() },
    }
  }
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, factory?: SandboxFactory): Promise<Response> {
  const apiKey = getEnv('E2B_API_KEY') ?? ''
  const runnerKey = getEnv('RUNNER_KEY') ?? ''
  if (!apiKey || !runnerKey) return respond({ error: 'not_configured' }, 503)
  return runTests(request, runnerKey, factory ?? e2bFactory(apiKey))
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
