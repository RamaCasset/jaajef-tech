// Test for the content import tool. Run: node --test tools/import-content.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { build, parseCsv, readTable } from './import-content.mjs'

const load = (n) => readTable(readFileSync(new URL(`../content/templates/${n}`, import.meta.url), 'utf8'))
const tables = () => ({ quests: load('quests.csv'), tests: load('tests.csv'), paths: load('paths.csv'), steps: load('steps.csv') })

test('reads quotes, commas and line breaks inside a cell', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\n"say ""hi""",z\r\n'), [['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']])
})

test('turns the template files into SQL with no problems', () => {
  const { sql, errors } = build(tables())
  assert.deepEqual(errors, [])
  assert.match(sql, /insert into public\.quests/)
  assert.match(sql, /'sum_evens'/)
  assert.match(sql, /'\[1, 2, 3, 4\]'::jsonb/)
  assert.match(sql, /insert into public\.learning_steps/)
  assert.ok(sql.startsWith('-- jaajef.tech'))
  assert.match(sql, /begin;/)
  assert.match(sql, /commit;/)
})

test('doubles single quotes so text cannot break the SQL', () => {
  const t = tables()
  t.quests[0].title = "L'arbre d'or"
  assert.ok(build(t).sql.includes("'L''arbre d''or'"))
})

test('names each problem with the file and line, and writes no SQL', () => {
  const t = tables()
  t.quests[0].clan = 'pirate'
  t.quests[0].minutes = '30'
  t.steps[0].path = 'inconnu'
  const { sql, errors } = build(t)
  assert.equal(sql, null)
  const text = errors.join('\n')
  assert.match(text, /quests\.csv line 2: somme-des-pairs: clan must be one of/)
  assert.match(text, /minutes must be a whole number from 1 to 10/)
  assert.match(text, /steps\.csv line 2: path "inconnu" is not in paths\.csv/)
})

test('rejects a test cell that is not JSON', () => {
  const t = tables()
  t.tests[1].expected = 'not json'
  assert.match(build(t).errors.join('\n'), /tests\.csv line 3.*expected is not valid JSON/)
})

test('asks for tests and an entry point on a graded quest', () => {
  const t = tables()
  t.tests = []
  t.quests[0].entry_point = ''
  const text = build(t).errors.join('\n')
  assert.match(text, /entry_point/)
  assert.match(text, /at least one row in tests\.csv/)
})

test('refuses a test that points at an unknown quest', () => {
  const t = tables()
  t.tests.push({ _line: '9', quest: 'fantome', name: 'x', input: '1', expected: '1' })
  assert.match(build(t).errors.join('\n'), /quest "fantome" is not in quests\.csv/)
})
