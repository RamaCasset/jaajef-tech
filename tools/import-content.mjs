// Turns the content spreadsheets (saved as CSV files) into one SQL file for the Supabase SQL Editor.
// Usage: node tools/import-content.mjs <folder with the CSV files> [output.sql]
// Files read (any that is missing is skipped): quests.csv, tests.csv, paths.csv, steps.csv
// Running the SQL again updates what exists (matched by slug) and never touches member progress.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CLANS = ['griot_du_code', 'forgeron', 'saltigue', 'buur_linguere']
const MASTERIES = ['ndongo', 'bagne', 'borom_xam_xam']
const LANGUAGES = ['python', 'javascript', 'html_css']
const GRADED = ['python', 'javascript']
const SLUG = /^[a-z0-9-]{3,60}$/
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/

/** Reads CSV text into rows of cells. Handles quotes, commas and line breaks inside quotes, and a BOM. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/** CSV text to a list of objects keyed by the header row (lower case). */
export function readTable(text) {
  const [head, ...body] = parseCsv(text)
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r, i) => {
    const o = { _line: i + 2 }
    keys.forEach((k, j) => { o[k] = (r[j] ?? '').trim() === '' ? '' : r[j] })
    return o
  })
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const qn = (s) => (s === '' || s == null ? 'null' : q(s))
const int = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : NaN)
const yes = (s) => ['oui', 'yes', 'true', '1', 'x'].includes(String(s).trim().toLowerCase())

/** Builds the SQL and the list of problems. Problems make `sql` null so nothing half-valid is produced. */
export function build({ quests = [], tests = [], paths = [], steps = [] }) {
  const errors = []
  const err = (file, o, msg) => errors.push(`${file} line ${o._line}: ${msg}`)
  const out = []
  const questSlugs = new Set()
  const dripOut = []
  const dripDays = new Set()
  const pathSlugs = new Set()

  for (const r of quests) {
    const slug = r.slug.trim()
    if (!SLUG.test(slug)) { err('quests.csv', r, `slug "${slug}" must be 3 to 60 characters: lower case letters, digits and dashes`); continue }
    if (questSlugs.has(slug)) { err('quests.csv', r, `slug "${slug}" appears twice`); continue }
    questSlugs.add(slug)
    const bad = []
    if (!r.title.trim()) bad.push('title is empty')
    if (!CLANS.includes(r.clan.trim())) bad.push(`clan must be one of ${CLANS.join(', ')}`)
    if (!MASTERIES.includes(r.mastery.trim())) bad.push(`mastery must be one of ${MASTERIES.join(', ')}`)
    if (!LANGUAGES.includes(r.language.trim())) bad.push(`language must be one of ${LANGUAGES.join(', ')}`)
    const minutes = int(r.minutes)
    if (!(minutes >= 1 && minutes <= 10)) bad.push('minutes must be a whole number from 1 to 10')
    const xp = int(r.xp)
    if (!(xp >= 1)) bad.push('xp must be a whole number above 0')
    const kopeks = r.kopeks === '' ? 0 : int(r.kopeks)
    if (Number.isNaN(kopeks)) bad.push('kopeks must be a whole number')
    const position = r.position === '' ? null : int(r.position)
    if (Number.isNaN(position)) bad.push('position must be a whole number from 1')
    // Optional column: the day the quest unlocks for a member (1 = the day they join).
    const dripRaw = (r.drip_day ?? '').trim()
    const drip = dripRaw === '' ? null : int(dripRaw)
    if (dripRaw !== '' && !(Number.isInteger(drip) && drip >= 1)) bad.push('drip_day must be a whole number from 1')
    if (drip !== null && dripDays.has(drip)) bad.push(`drip_day ${drip} is used by another quest`)
    const graded = GRADED.includes(r.language.trim())
    if (graded && !IDENT.test(r.entry_point.trim())) bad.push('entry_point (the function name the player writes) is required for python and javascript')
    if (graded && !tests.some((t) => t.quest.trim() === slug)) bad.push('needs at least one row in tests.csv')
    if (bad.length) { bad.forEach((m) => err('quests.csv', r, `${slug}: ${m}`)); continue }

    if (drip !== null) { dripDays.add(drip); dripOut.push(`update public.quests set drip_day = ${drip} where slug = ${q(slug)};`) }
    out.push(`-- Quest: ${slug}`)
    out.push(`insert into public.quests (slug, title, summary, statement_md, clan, mastery, language, topic, est_minutes, xp_reward, kopek_reward, entry_point, starter_code, position, published)`)
    out.push(`values (${q(slug)}, ${q(r.title)}, ${qn(r.summary)}, ${qn(r.statement)}, ${q(r.clan.trim())}, ${q(r.mastery.trim())}, ${q(r.language.trim())}, ${qn(r.topic)}, ${minutes}, ${xp}, ${kopeks}, ${graded ? q(r.entry_point.trim()) : 'null'}, ${qn(r.starter_code)}, ${position ?? 'null'}, ${yes(r.published)})`)
    out.push(`on conflict (slug) do update set title = excluded.title, summary = excluded.summary, statement_md = excluded.statement_md, clan = excluded.clan, mastery = excluded.mastery, language = excluded.language, topic = excluded.topic, est_minutes = excluded.est_minutes, xp_reward = excluded.xp_reward, kopek_reward = excluded.kopek_reward, entry_point = excluded.entry_point, starter_code = excluded.starter_code, position = excluded.position, published = excluded.published;`)
    const id = `(select id from public.quests where slug = ${q(slug)})`
    out.push(`delete from public.quest_hints where quest_id = ${id};`)
    ;['hint1', 'hint2', 'hint3'].forEach((k, i) => {
      if (r[k].trim()) out.push(`insert into public.quest_hints (quest_id, level, body) values (${id}, ${i + 1}, ${q(r[k])});`)
    })
    if (r.explanation.trim()) {
      out.push(`insert into public.quest_explanations (quest_id, explanation_md) values (${id}, ${q(r.explanation)}) on conflict (quest_id) do update set explanation_md = excluded.explanation_md;`)
    } else {
      out.push(`delete from public.quest_explanations where quest_id = ${id};`)
    }
    out.push(`delete from public.quest_tests where quest_id = ${id};`)
    let pos = 0
    for (const t of tests.filter((x) => x.quest.trim() === slug)) {
      let ok = true
      for (const k of ['input', 'expected']) {
        try { JSON.parse(t[k]) } catch { err('tests.csv', t, `${slug}: ${k} is not valid JSON (text goes in double quotes, e.g. "abc")`); ok = false }
      }
      if (!t.name.trim()) { err('tests.csv', t, `${slug}: name is empty`); ok = false }
      if (!ok) continue
      out.push(`insert into public.quest_tests (quest_id, position, name, input, expected) values (${id}, ${pos++}, ${q(t.name)}, ${q(t.input.trim())}::jsonb, ${q(t.expected.trim())}::jsonb);`)
    }
    out.push('')
  }
  for (const t of tests) {
    if (!questSlugs.has(t.quest.trim())) err('tests.csv', t, `quest "${t.quest}" is not in quests.csv`)
  }

  if (dripOut.length) {
    out.push('-- Unlock order: one quest a day from each member\'s join date. Needs the quest drip SQL file to be run first.')
    out.push('update public.quests set drip_day = null;')
    out.push(...dripOut)
  }

  for (const r of paths) {
    const slug = r.slug.trim()
    const bad = []
    if (!SLUG.test(slug)) bad.push('slug must be 3 to 60 characters: lower case letters, digits and dashes')
    if (pathSlugs.has(slug)) bad.push('slug appears twice')
    if (!CLANS.includes(r.clan.trim())) bad.push(`clan must be one of ${CLANS.join(', ')}`)
    if (!r.title.trim()) bad.push('title is empty')
    const position = r.position === '' ? 0 : int(r.position)
    if (Number.isNaN(position)) bad.push('position must be a whole number')
    if (bad.length) { bad.forEach((m) => err('paths.csv', r, `${slug}: ${m}`)); continue }
    pathSlugs.add(slug)
    out.push(`-- Learning path: ${slug}`)
    out.push(`insert into public.learning_paths (slug, clan, title, summary, position, published) values (${q(slug)}, ${q(r.clan.trim())}, ${q(r.title)}, ${qn(r.summary)}, ${position}, ${yes(r.published)})`)
    out.push(`on conflict (slug) do update set clan = excluded.clan, title = excluded.title, summary = excluded.summary, position = excluded.position, published = excluded.published;`)
    const mine = steps.filter((s) => s.path.trim() === slug)
    const pid = `(select id from public.learning_paths where slug = ${q(slug)})`
    let last = 0
    for (const s of mine) {
      const n = int(s.position)
      const bad2 = []
      if (!(n >= 1)) bad2.push('position must be a whole number from 1')
      if (!s.title.trim()) bad2.push('title is empty')
      if (s.mastery.trim() && !MASTERIES.includes(s.mastery.trim())) bad2.push(`mastery must be one of ${MASTERIES.join(', ')}`)
      const mins = s.minutes === '' ? null : int(s.minutes)
      if (Number.isNaN(mins) || mins === 0) bad2.push('minutes must be a whole number above 0')
      if (s.quest.trim() && !SLUG.test(s.quest.trim())) bad2.push('quest must be a quest slug')
      if (bad2.length) { bad2.forEach((m) => err('steps.csv', s, `${slug}: ${m}`)); continue }
      last = Math.max(last, n)
      const quest = s.quest.trim() ? `(select id from public.quests where slug = ${q(s.quest.trim())})` : 'null'
      out.push(`insert into public.learning_steps (path_id, position, title, lesson_md, mastery, est_minutes, quest_id) values (${pid}, ${n}, ${q(s.title)}, ${q(s.lesson)}, ${s.mastery.trim() ? q(s.mastery.trim()) + '::public.mastery_type' : 'null'}, ${mins ?? 'null'}, ${quest})`)
      out.push(`on conflict (path_id, position) do update set title = excluded.title, lesson_md = excluded.lesson_md, mastery = excluded.mastery, est_minutes = excluded.est_minutes, quest_id = excluded.quest_id;`)
    }
    out.push(`delete from public.learning_steps where path_id = ${pid} and position > ${last};`)
    out.push('')
  }
  for (const s of steps) {
    if (!pathSlugs.has(s.path.trim())) err('steps.csv', s, `path "${s.path}" is not in paths.csv`)
  }

  if (errors.length) return { sql: null, errors }
  const head = ['-- jaajef.tech content import. Generated by tools/import-content.mjs: do not edit by hand, change the spreadsheets and run the tool again.', '-- Quests and paths come in unpublished unless the "published" column says oui. Member progress is never touched.', 'begin;', '']
  return { sql: [...head, ...out, 'commit;', ''].join('\n'), errors }
}

function main(argv) {
  const [dir, outFile] = argv
  if (!dir) { console.error('Usage: node tools/import-content.mjs <folder with the CSV files> [output.sql]'); return 1 }
  const read = (n) => (existsSync(join(dir, n)) ? readTable(readFileSync(join(dir, n), 'utf8')) : [])
  const { sql, errors } = build({ quests: read('quests.csv'), tests: read('tests.csv'), paths: read('paths.csv'), steps: read('steps.csv') })
  if (!sql) {
    console.error(`${errors.length} problem(s) found. Nothing was written.\n`)
    errors.forEach((e) => console.error(`- ${e}`))
    return 1
  }
  const target = outFile ?? join(dir, 'import.sql')
  writeFileSync(target, sql)
  console.log(`Written: ${target}`)
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exit(main(process.argv.slice(2)))
