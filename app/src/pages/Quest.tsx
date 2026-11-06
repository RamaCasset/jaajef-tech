import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  getExplanation, getQuest, getUnlockedHints, RunError, runQuest, saveDraft, startQuest, revealHint,
  type Hint, type QuestAttempt, type QuestDetail, type RunOutcome,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

type Loaded = { quest: QuestDetail; attempt: QuestAttempt; hints: Hint[]; explanation: string | null }

function runMessage(e: unknown): string {
  if (e instanceof RunError) {
    const known = fr.quests.page.runErrors as Record<string, string>
    return known[e.code] ?? fr.quests.page.runErrors.other
  }
  return friendlyError(e)
}

export function Quest() {
  const { slug = '' } = useParams()
  const { refreshMember } = useAuth()
  const [state, setState] = useState<'loading' | 'missing' | 'failed' | 'ready'>('loading')
  const [data, setData] = useState<Loaded | null>(null)
  const [code, setCode] = useState('')
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [hintBusy, setHintBusy] = useState(false)
  const [noMoreHints, setNoMoreHints] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    setData(null)
    setOutcome(null)
    setError(null)
    setNote(null)
    setNoMoreHints(false)
    ;(async () => {
      const quest = await getQuest(slug)
      if (!quest) { if (alive) setState('missing'); return }
      const attempt = await startQuest(quest.id)
      const [hints, explanation] = await Promise.all([
        getUnlockedHints(quest.id),
        attempt.status === 'solved' ? getExplanation(quest.id) : Promise.resolve(null),
      ])
      if (!alive) return
      setData({ quest, attempt, hints, explanation })
      setCode(attempt.code ?? quest.starter_code ?? '')
      setState('ready')
    })().catch((e: unknown) => {
      if (!alive) return
      setState(e instanceof Error && e.message.toLowerCase().includes('quest not available') ? 'missing' : 'failed')
    })
    return () => { alive = false }
  }, [slug, reload])

  const solved = data?.attempt.status === 'solved'

  const run = useCallback(async () => {
    if (!data) return
    setRunning(true)
    setError(null)
    setNote(null)
    try {
      const result = await runQuest(data.quest.id, code)
      setOutcome(result)
      if (result.solved) {
        const explanation = await getExplanation(data.quest.id).catch(() => null)
        setData((d) => (d ? { ...d, attempt: { ...d.attempt, status: 'solved' }, explanation } : d))
        void refreshMember()
      } else {
        setData((d) => (d ? { ...d, attempt: { ...d.attempt, tests_passed: result.tests_passed, tests_total: result.tests_total } } : d))
      }
    } catch (e) {
      setError(runMessage(e))
    } finally {
      setRunning(false)
    }
  }, [data, code, refreshMember])

  async function save() {
    if (!data) return
    setError(null)
    setNote(null)
    try {
      await saveDraft(data.quest.id, code, data.attempt.tests_passed)
      setNote(fr.quests.page.draftSaved)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function moreHint() {
    if (!data) return
    setHintBusy(true)
    setError(null)
    try {
      const r = await revealHint(data.quest.id)
      if (r.no_more_hints || r.level === undefined || r.body === undefined) setNoMoreHints(true)
      else {
        const hint: Hint = { level: r.level, body: r.body }
        setData((d) => (d ? { ...d, hints: [...d.hints.filter((h) => h.level !== hint.level), hint].sort((a, b) => a.level - b.level) } : d))
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setHintBusy(false)
    }
  }

  const back = <Link className="btn" to="/quetes">{fr.quests.page.back}</Link>

  if (state !== 'ready' || !data) {
    return (
      <AppShell>
        <main className="page quest-page">
          {back}
          {state === 'loading' ? <p className="muted">{fr.common.loading}</p> : null}
          {state === 'missing' ? <p className="muted">{fr.quests.page.notFound}</p> : null}
          {state === 'failed' ? (
            <div role="alert" className="alert">
              {fr.quests.page.loadError} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.quests.retry}</button>
            </div>
          ) : null}
        </main>
      </AppShell>
    )
  }

  const { quest, hints, explanation } = data
  const p = fr.quests.page

  return (
    <AppShell>
      <main className="page quest-page">
        {back}
        <header className="page-head">
          <div className="project-tags">
            <span className="tag">{fr.clans[quest.clan].name}</span>
            <span className="tag">{fr.masteries[quest.mastery].name}</span>
            {quest.language ? <span className="tag">{fr.quests.languages[quest.language]}</span> : null}
          </div>
          <h1 className="page-title">{quest.title}</h1>
          <p className="mono tiny">{fr.quests.minutes(quest.est_minutes)} · {fr.quests.reward(quest.xp_reward, quest.kopek_reward)}</p>
        </header>

        {error ? <p role="alert" className="alert">{error}</p> : null}

        {outcome?.solved && !outcome.already_solved ? (
          <section className="panel quest-win" aria-label={p.solvedTitle}>
            <h2>{p.solvedTitle}</h2>
            <p>{p.reward(outcome.xp ?? 0, outcome.kopeks ?? 0)}</p>
            {outcome.streak_days ? <p className="muted">{p.streak(outcome.streak_days)}</p> : null}
            {outcome.daily_quest && ((outcome.bonus_xp ?? 0) > 0 || (outcome.bonus_kopeks ?? 0) > 0)
              ? <p className="muted">{p.bonus(outcome.bonus_xp ?? 0, outcome.bonus_kopeks ?? 0)}</p> : null}
            {outcome.duration_ms ? <p className="muted">{p.seconds(Math.round(outcome.duration_ms / 1000))}</p> : null}
          </section>
        ) : null}
        {solved && !(outcome?.solved && !outcome.already_solved) ? <p className="muted">{p.alreadySolved}</p> : null}

        <div className="quest-cols">
          <section>
            <h2>{p.statement}</h2>
            <div className="panel quest-statement">{quest.statement_md ?? p.noStatement}</div>
          </section>

          <section className="quest-editor">
            <label htmlFor="quest-code"><h2>{p.editor}</h2></label>
            <textarea id="quest-code" className="quest-code" spellCheck={false} value={code} readOnly={solved} onChange={(e) => setCode(e.target.value)} />
            {solved ? <p className="muted">{p.solvedLocked}</p> : (
              <div className="quest-actions">
                <button type="button" className="btn btn-cta" disabled={running || code.trim() === ''} onClick={() => void run()}>{running ? p.running : p.run}</button>
                <button type="button" className="btn" disabled={running} onClick={() => void save()}>{p.saveDraft}</button>
                {note ? <span role="status" className="muted">{note}</span> : null}
              </div>
            )}
          </section>
        </div>

        {outcome ? (
          <section aria-label={p.results}>
            <h2>{p.results}</h2>
            <p>{p.testsPassed(outcome.tests_passed, outcome.tests_total)}</p>
            {outcome.reason === 'too_fast' ? <p role="status" className="muted">{p.tooFast(outcome.min_seconds ?? 0)}</p> : null}
            <ul className="test-list">
              {outcome.tests.map((t) => (
                <li key={t.name}>
                  <span className={t.passed ? 'test-ok' : 'test-ko'}>{t.passed ? p.passed : p.failed}</span>
                  <span className="mono">{t.name}</span>
                  {t.message ? <span className="muted tiny">{t.message}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="quest-cols">
          <section className="quest-side">
            <h2>{p.hints}</h2>
            <p className="muted">{p.hintsUsed(hints.length)}</p>
            {hints.length > 0 ? (
              <ol className="hint-list">{hints.map((h) => <li key={h.level}>{h.body}</li>)}</ol>
            ) : null}
            {noMoreHints ? <p className="muted">{p.noMoreHints}</p> : null}
            {!solved ? <div><button type="button" className="btn" disabled={hintBusy || noMoreHints} onClick={() => void moreHint()}>{p.askHint}</button></div> : null}
          </section>
          {solved && explanation ? (
            <section>
              <h2>{p.explanation}</h2>
              <div className="panel quest-statement">{explanation}</div>
            </section>
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
