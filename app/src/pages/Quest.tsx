import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ArticleBody } from '../components/ArticleBody'
import { CodeEditor } from '../components/CodeEditor'
import { Icon } from '../components/Icon'
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
  const [resultTab, setResultTab] = useState<'terminal' | 'results'>('terminal')
  const [note, setNote] = useState<string | null>(null)
  const [hintBusy, setHintBusy] = useState(false)
  const [noMoreHints, setNoMoreHints] = useState(false)
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState('')
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 })

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
      setSaved(attempt.code ?? quest.starter_code ?? '')
      setState('ready')
    })().catch((e: unknown) => {
      if (!alive) return
      setState(e instanceof Error && e.message.toLowerCase().includes('quest not available') ? 'missing' : 'failed')
    })
    return () => { alive = false }
  }, [slug, reload])

  const solved = data?.attempt.status === 'solved'

  const resultsRef = useRef<HTMLElement | null>(null)

  const run = useCallback(async () => {
    if (!data) return
    setResultTab('terminal')
    // Show the terminal straight away, so the member watches the run.
    window.setTimeout(() => resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50)
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
      setSaved(code)
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
  const ext = quest.language === 'python' ? 'py' : quest.language === 'javascript' ? 'js' : 'txt'
  const file = `solution.${ext}`
  const changed = !solved && code !== saved
  const shown = outcome ?? null

  return (
    <AppShell>
      <main className="page quest-page quest-ws">
        <header className="quest-ws-head">
          <p className="eyebrow">
            <Link to="/quetes" aria-label={p.back}>{p.crumb}</Link> / {fr.clans[quest.clan].name}
          </p>
          <h1 className="page-title">{quest.title}</h1>
          <div className="quest-ws-badges">
            <span className="badge-xp">+{quest.xp_reward} XP</span>
            {quest.kopek_reward > 0 ? <span className="badge-kopek">+{quest.kopek_reward} Kopeks</span> : null}
            <span className="muted tiny">
              {fr.masteries[quest.mastery].name}{quest.language ? ` · ${fr.quests.languages[quest.language]}` : ''} · {fr.quests.minutes(quest.est_minutes)}
            </span>
          </div>
        </header>

        {error ? <p role="alert" className="alert">{error}</p> : null}

        {outcome?.solved && !outcome.already_solved ? (
          <section className="panel quest-win" aria-label={p.solvedTitle}>
            <h2>{p.solvedTitle}</h2>
            {outcome.rewarded === false ? <p>{p.noPoints}</p> : <p>{p.reward(outcome.xp ?? 0, outcome.kopeks ?? 0)}</p>}
            {outcome.streak_days ? <p className="muted">{p.streak(outcome.streak_days)}</p> : null}
            {outcome.daily_quest && ((outcome.bonus_xp ?? 0) > 0 || (outcome.bonus_kopeks ?? 0) > 0)
              ? <p className="muted">{p.bonus(outcome.bonus_xp ?? 0, outcome.bonus_kopeks ?? 0)}</p> : null}
            {outcome.duration_ms ? <p className="muted">{p.seconds(Math.round(outcome.duration_ms / 1000))}</p> : null}
          </section>
        ) : null}
        {solved && !(outcome?.solved && !outcome.already_solved) ? <p className="muted">{p.alreadySolved}</p> : null}

        <div className="quest-grid">
          <section className="panel quest-pane quest-brief" aria-label={p.statement}>
            <header className="quest-pane-head"><Icon name="blog" size={18} /> <h2>{p.statementTitle}</h2></header>
            <div className="quest-pane-body">
              <span className="quest-level-chip">{fr.masteries[quest.mastery].name}</span>
              <div className="quest-md">{quest.statement_md ? <ArticleBody text={quest.statement_md} /> : <p className="muted">{p.noStatement}</p>}</div>
            </div>
          </section>

          <div className="quest-center">
            <section className="panel quest-pane quest-editor-pane" aria-label={file}>
              <header className="quest-pane-head quest-file-head">
                <Icon name="file" size={16} />
                <span className="mono">{file}</span>
                {changed ? <span className="quest-dirty" role="img" aria-label={p.unsaved} title={p.unsaved} /> : null}
                <span className="quest-lang mono tiny muted">{quest.language ? fr.quests.languages[quest.language] : ''}</span>
                <button type="button" className="btn btn-cta quest-run" disabled={running || code.trim() === ''} onClick={() => void run()}>
                  <Icon name="play" size={14} /> {running ? p.running : p.run}
                </button>
              </header>
              <div className="quest-editor-box">
                <CodeEditor path={file} value={code} onChange={setCode} height="100%" onCursor={(line, col) => setCursor({ line, col })} />
              </div>
              <footer className="quest-statusbar">
                <span className="mono tiny muted">{p.cursor(cursor.line, cursor.col)} · UTF-8</span>
                {solved ? <span className="muted tiny">{p.solvedLocked}</span> : (
                  <span className="quest-actions">
                    {note ? <span role="status" className="muted tiny">{note}</span> : null}
                    <button type="button" className="btn" disabled={running} onClick={() => void save()}>{p.saveDraft}</button>
                  </span>
                )}
              </footer>
            </section>

            <section ref={resultsRef} className="panel quest-pane quest-results" aria-label={p.results}>
              <header className="quest-pane-head quest-tabs-head">
                <div role="tablist" className="quest-tabs">
                  <button type="button" role="tab" aria-selected={resultTab === 'terminal'} className={resultTab === 'terminal' ? 'quest-tab quest-tab-on' : 'quest-tab'} onClick={() => setResultTab('terminal')}>Terminal</button>
                  <button type="button" role="tab" aria-selected={resultTab === 'results'} className={resultTab === 'results' ? 'quest-tab quest-tab-on' : 'quest-tab'} onClick={() => setResultTab('results')}>{p.tabResults}</button>
                </div>
                {shown ? <span className={`quest-chip ${shown.tests_passed === shown.tests_total ? 'quest-chip-ok' : ''}`}>{p.passedChip(shown.tests_passed, shown.tests_total)}</span> : null}
              </header>
              <div className="quest-pane-body" role="tabpanel">
                {!shown ? <p className="muted tiny">{p.noResultsYet}</p> : (
                  <>
                    {shown.reason === 'too_fast' ? <p role="status" className="muted">{p.tooFast(shown.min_seconds ?? 0)}</p> : null}
                    {resultTab === 'terminal' ? (
                      <div className="term-out">
                        <p className="term-cmd">{quest.language === 'python' ? 'python' : quest.language === 'javascript' ? 'node' : 'run'} {file}</p>
                        {shown.tests.map((t) => (
                          <div key={t.name}>
                            <p className={t.passed ? 'term-line term-ok' : 'term-line term-ko'}><span aria-hidden="true">{t.passed ? '✓' : '×'}</span> <span className="visually-hidden">{t.passed ? p.passed : p.failed} </span>{t.name}</p>
                            {t.message ? <p className="term-line term-err">{t.message}</p> : null}
                          </div>
                        ))}
                        <p className="term-sum">{p.terminalSummary(shown.tests_passed, shown.tests_total)}</p>
                      </div>
                    ) : (
                      <>
                        <p className="tiny muted">{p.testsPassed(shown.tests_passed, shown.tests_total)}</p>
                        <ul className="test-list">
                          {shown.tests.map((t) => (
                            <li key={t.name}>
                              <span className={t.passed ? 'test-ok' : 'test-ko'}>{t.passed ? p.passed : p.failed}</span>
                              <span className="mono">{t.name}</span>
                              {t.message ? <span className="muted tiny">{t.message}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>

          <aside className="quest-side-col">
            <section className="panel quest-pane" aria-label={p.hints}>
              <header className="quest-pane-head"><Icon name="question" size={16} /> <h2>{p.hints}</h2></header>
              <div className="quest-pane-body">
                <p className="muted tiny">{p.hintsUsed(hints.length)}</p>
                {hints.length > 0 ? <ol className="hint-list">{hints.map((h) => <li key={h.level}>{h.body}</li>)}</ol> : null}
                {noMoreHints ? <p className="muted tiny">{p.noMoreHints}</p> : null}
                {!solved ? <div><button type="button" className="btn" disabled={hintBusy || noMoreHints} onClick={() => void moreHint()}>{p.askHint}</button></div> : null}
              </div>
            </section>
            {solved && explanation ? (
              <section className="panel quest-pane" aria-label={p.explanation}>
                <header className="quest-pane-head"><Icon name="blog" size={16} /> <h2>{p.explanation}</h2></header>
                <div className="quest-pane-body quest-md"><ArticleBody text={explanation} /></div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
