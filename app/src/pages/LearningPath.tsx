import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ArticleBody } from '../components/ArticleBody'
import { Companion } from '../components/Companion'
import { Icon } from '../components/Icon'
import { fr } from '../i18n/fr'
import { listLearningPaths, listLearningSteps, markStepRead, type LearningPath as Path, type LearningStep } from '../lib/api'

/** One learning path: the steps on the left, the lesson of the chosen step on the right. */
export function LearningPath() {
  const { slug = '' } = useParams()
  const t = fr.learning
  const [path, setPath] = useState<Path | null | undefined>(undefined)
  const [steps, setSteps] = useState<LearningStep[] | null>(null)
  const [current, setCurrent] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    Promise.resolve()
      .then(() => Promise.all([listLearningPaths(), listLearningSteps(slug)]))
      .then(([paths, list]) => {
        if (!alive) return
        const rows = list ?? []
        setPath((paths ?? []).find((p) => p.slug === slug) ?? null)
        setSteps(rows)
        const firstTodo = rows.findIndex((s) => !s.done)
        setCurrent(firstTodo === -1 ? 0 : firstTodo)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [slug, reload])

  async function read(step: LearningStep) {
    setBusy(true)
    setSaveFailed(false)
    try {
      await markStepRead(step.id)
      setSteps((list) => (list ?? []).map((s) => (s.id === step.id ? { ...s, done: s.quest_slug ? s.done : true } : s)))
      setCurrent((c) => Math.min(c + 1, (steps?.length ?? 1) - 1))
    } catch {
      setSaveFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const step = steps && steps.length > 0 ? steps[Math.min(current, steps.length - 1)] : null
  const doneCount = steps ? steps.filter((s) => s.done).length : 0

  return (
    <AppShell>
      <main className="page learning notices-page">
        <header className="quest-ws-head">
          <p className="eyebrow"><Link to="/parcours" aria-label={t.back}>{t.eyebrow.split(' / ')[1]}</Link>{path ? ` / ${fr.clans[path.clan].name}` : ''}</p>
          <h1 className="page-title">{path ? path.title : t.title}</h1>
          {path?.summary ? <p className="muted">{path.summary}</p> : null}
        </header>

        {failed && (
          <div role="alert" className="alert">
            {t.error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button>
          </div>
        )}
        {!failed && !steps && <p className="muted">{fr.common.loading}</p>}
        {!failed && path === null && <div className="panel panel-pad"><p className="muted">{t.notFound}</p><Link className="btn" to="/parcours">{t.back}</Link></div>}
        {steps && path && steps.length === 0 && <div className="panel panel-pad"><p className="muted">{t.noSteps}</p></div>}
        {steps && path && step && (
          <div className="path-layout">
            <nav className="panel path-steps" aria-label={t.stepList}>
              <p className="muted tiny path-steps-count">{t.steps(doneCount, steps.length)}</p>
              <ol>
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" className={`path-step${i === current ? ' path-step-on' : ''}${s.done ? ' path-step-done' : ''}`} aria-current={i === current ? 'step' : undefined} onClick={() => setCurrent(i)}>
                      <span className="path-step-mark" aria-hidden="true">{s.done ? <Icon name="check" size={14} /> : s.step_no}</span>
                      <span className="path-step-name">{s.title}</span>
                      <span className="sr-only">{s.done ? t.stepDone : t.stepTodo}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <section className="panel path-lesson" aria-label={step.title}>
              <header className="quest-pane-head">
                <Icon name="book" size={18} />
                <h2>{step.title}</h2>
                <span className="quest-lang tiny muted">{t.stepOf(step.step_no, steps.length)}{step.est_minutes ? ` · ${t.minutes(step.est_minutes)}` : ''}</span>
              </header>
              <div className="quest-pane-body path-lesson-body">
                {step.mastery ? <span className="quest-level-chip">{fr.masteries[step.mastery].name}</span> : null}
                <div className="quest-md">{step.lesson_md ? <ArticleBody text={step.lesson_md} /> : null}</div>
              </div>
              <footer className="path-lesson-foot">
                {step.quest_slug ? (
                  <div className="path-quest">
                    <Companion clan={path.clan} size={40} />
                    <div>
                      <p><strong>{step.quest_title}</strong></p>
                      <p className="muted tiny">{step.done ? t.stepDone : t.questToFinish}{step.quest_xp ? ` · ${t.questReward(step.quest_xp, Number(step.quest_kopeks ?? 0))}` : ''}</p>
                    </div>
                    <Link className={`btn${step.done ? '' : ' btn-cta'}`} to={`/quetes/${step.quest_slug}`}>
                      {step.done || step.quest_status === 'in_progress' ? t.resumeQuest : t.startQuest} <Icon name="forward" size={16} />
                    </Link>
                  </div>
                ) : step.done ? (
                  <p className="muted">{t.markReadDone}</p>
                ) : (
                  <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void read(step)}>{t.markRead}</button>
                )}
                {saveFailed ? <p role="alert" className="alert">{t.saveError}</p> : null}
                {steps.length > 0 && doneCount === steps.length ? <p className="path-complete">{t.allDone}</p> : null}
                <div className="path-pager">
                  <button type="button" className="btn" disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>{t.previous}</button>
                  <button type="button" className="btn" disabled={current >= steps.length - 1} onClick={() => setCurrent((c) => Math.min(steps.length - 1, c + 1))}>{t.next}</button>
                </div>
              </footer>
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}
