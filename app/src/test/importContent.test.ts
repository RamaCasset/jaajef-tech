import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, parseCsv, readTable } from '../../../tools/import-content.mjs'

const folder = resolve(process.cwd(), '../content/templates')
const load = (n: string) => readTable(readFileSync(resolve(folder, n), 'utf8'))
const tables = () => ({ quests: load('quests.csv'), tests: load('tests.csv'), paths: load('paths.csv'), steps: load('steps.csv') })

describe('content import tool', () => {
  it('reads quotes, commas and line breaks inside a cell', () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n"say ""hi""",z\r\n')).toEqual([['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']])
  })

  it('turns the template files into SQL with no problems', () => {
    const { sql, errors } = build(tables())
    expect(errors).toEqual([])
    expect(sql).toContain("insert into public.quests")
    expect(sql).toContain("'sum_evens'")
    expect(sql).toContain("'[1, 2, 3, 4]'::jsonb")
    expect(sql).toContain('insert into public.learning_steps')
    expect(sql?.startsWith('-- jaajef.tech')).toBe(true)
    expect(sql).toContain('begin;')
    expect(sql).toContain('commit;')
  })

  it('doubles single quotes so text cannot break the SQL', () => {
    const t = tables()
    t.quests[0].title = "L'arbre d'or"
    expect(build(t).sql).toContain("'L''arbre d''or'")
  })

  it('names each problem with the file and line, and writes no SQL', () => {
    const t = tables()
    t.quests[0].clan = 'pirate'
    t.quests[0].minutes = '30'
    t.steps[0].path = 'inconnu'
    const { sql, errors } = build(t)
    expect(sql).toBeNull()
    expect(errors.join('\n')).toMatch(/quests\.csv line 2: somme-des-pairs: clan must be one of/)
    expect(errors.join('\n')).toMatch(/minutes must be a whole number from 1 to 10/)
    expect(errors.join('\n')).toMatch(/steps\.csv line 2: path "inconnu" is not in paths\.csv/)
  })

  it('rejects a test cell that is not JSON', () => {
    const t = tables()
    t.tests[1].expected = 'not json'
    expect(build(t).errors.join('\n')).toMatch(/tests\.csv line 3.*expected is not valid JSON/)
  })

  it('asks for tests and an entry point on a graded quest', () => {
    const t = tables()
    t.tests = []
    t.quests[0].entry_point = ''
    const { errors } = build(t)
    expect(errors.join('\n')).toMatch(/entry_point/)
    expect(errors.join('\n')).toMatch(/at least one row in tests\.csv/)
  })

  it('refuses a test that points at an unknown quest', () => {
    const t = tables()
    t.tests.push({ _line: '9', quest: 'fantome', name: 'x', input: '1', expected: '1' })
    expect(build(t).errors.join('\n')).toMatch(/quest "fantome" is not in quests\.csv/)
  })
})
