import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Companion } from '../components/Companion'
import { fr } from '../i18n/fr'
import { listLearningPaths, type LearningPath } from '../lib/api'

/** "Parcours": one learning path per clan, with my progress in each. */
export function LearningPaths() {
  const t = fr.learning
  const [paths, setPaths] = useState<LearningPath[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    Promise.resolve().then(() => listLearningPaths()).then((l) => { if (alive) setPaths(l ?? []) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [reload])

  return (
    <AppShell>
      <main className="page learning notices-page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="page-title">{t.title}</h1>
            <p className="muted">{t.subtitle}</p>
          </div>
        </header>

        {failed && (
          <div role="alert" className="alert">
            {t.error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button>
          </div>
        )}
        {!failed && !paths && <p className="muted">{fr.common.loading}</p>}
        {paths && paths.length === 0 && <div className="panel panel-pad"><p className="muted">{t.empty}</p></div>}
        {paths && paths.length > 0 && (
          <section className="path-grid" aria-label={t.title}>
            {paths.map((p) => {
              const total = Number(p.steps_total)
              const done = Number(p.steps_done)
              const pct = total > 0 ? Math.round((done / total) * 100) : 0
              const label = total > 0 && done >= total ? t.review : done > 0 ? t.keepGoing : t.start
              return (
                <article key={p.id} className="panel path-card">
                  <div className="path-card-top">
                    <Companion clan={p.clan} size={56} />
                    <div>
                      <p className={`tiny quest-kind-${p.clan}`}>{fr.clans[p.clan].name}</p>
                      <p className="muted tiny">{fr.clans[p.clan].role}</p>
                    </div>
                  </div>
                  <h2 className="path-title">{p.title}</h2>
                  {p.summary ? <p className="muted">{p.summary}</p> : null}
                  <div className="path-progress">
                    <div className="path-bar" role="progressbar" aria-label={p.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted tiny">{t.steps(done, total)}</span>
                  </div>
                  <Link className={`btn${done > 0 && done < total ? ' btn-cta' : ''}`} to={`/parcours/${p.slug}`} aria-label={`${label} : ${p.title}`}>{label}</Link>
                </article>
              )
            })}
          </section>
        )}
      </main>
    </AppShell>
  )
}
