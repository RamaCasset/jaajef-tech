import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Companion } from '../components/Companion'
import { useAuth } from '../auth/AuthContext'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import { listMyNotebook, type NotebookEntry } from '../lib/api'

/** "Mon carnet": every quest the member has passed, the latest first, with how many there are. */
export function QuestNotebook() {
  const { member } = useAuth()
  const userId = member?.profile.id
  const t = fr.quests.notebook
  const [items, setItems] = useState<NotebookEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!userId) return
    let alive = true
    setFailed(false)
    listMyNotebook(userId).then((l) => { if (alive) setItems(l) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [userId, reload])

  return (
    <AppShell>
      <main className="page quests notices-page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="page-title">{t.title}</h1>
            <p className="muted">{t.subtitle}</p>
          </div>
          <div className="notice-head-actions">
            <Link className="btn" to="/quetes">{fr.quests.page.back}</Link>
          </div>
        </header>

        {failed && (
          <div role="alert" className="alert">
            {t.error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.quests.retry}</button>
          </div>
        )}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}
        {items && (
          <>
            <section className="panel level-card notebook-total" aria-label={t.count(items.length)}>
              <p className="notebook-number">{items.length}</p>
              <p className="muted">{t.count(items.length)}</p>
            </section>
            {items.length === 0 ? (
              <div className="panel panel-pad">
                <p className="muted">{t.empty}</p>
                <Link className="btn btn-cta" to="/quetes">{t.goQuests}</Link>
              </div>
            ) : (
              <section className="panel notebook-list">
                {items.map((e) => (
                  <article key={e.quest_id} className="notebook-row">
                    <Companion clan={e.quests.clan} size={48} />
                    <div className="notebook-body">
                      <h3 className="notebook-title"><Link className="inbox-stretch" to={`/quetes/${e.quests.slug}`}>{e.quests.title}</Link></h3>
                      <p className={`tiny quest-kind-${e.quests.clan}`}>
                        {fr.clans[e.quests.clan].name}{e.quests.language ? ` · ${fr.quests.languages[e.quests.language]}` : ''} · {fr.masteries[e.quests.mastery].name}
                      </p>
                    </div>
                    <div className="inbox-meta">
                      <span className="muted tiny">{e.solved_at ? t.solvedOn(new Date(e.solved_at).toLocaleDateString(dateLocale())) : ''}</span>
                      {e.duration_ms ? <span className="muted tiny">{t.took(Math.max(1, Math.round(e.duration_ms / 60000)))}</span> : null}
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
