import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  getDailyQuest, listMyQuestProgress, listPastDailyQuests, listQuests,
  type DailyQuest, type MyQuestProgress, type PastDailyQuest, type QuestSummary,
} from '../lib/api'
import { fr } from '../i18n/fr'

type Data = { today: DailyQuest | null; past: PastDailyQuest[]; solved: QuestSummary[] }

export function Arena() {
  const t = fr.arena
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    Promise.all([
      getDailyQuest(),
      listPastDailyQuests(30),
      listQuests({ clan: '', mastery: '', language: '', query: '' }),
      listMyQuestProgress(me),
    ])
      .then(([today, past, all, progress]: [DailyQuest | null, PastDailyQuest[], QuestSummary[], MyQuestProgress[]]) => {
        if (!alive) return
        const done = new Set(progress.filter((p) => p.status === 'solved').map((p) => p.quest_id))
        setData({ today, past, solved: all.filter((q) => done.has(q.id)) })
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [me, reload])

  const todayStatus = data?.today ? (data.today.status === 'solved' ? 'solved' : data.today.status === 'in_progress' ? 'in_progress' : 'none') : 'none'

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
          <p className="muted">{t.rule}</p>
          <p><Link to="/quetes">{t.all}</Link></p>
        </header>
        {failed && <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>}
        {!data && !failed && <p className="muted">{fr.common.loading}</p>}

        {data && (
          <>
            <section className="panel" style={{ marginBottom: 16 }} aria-label={t.today}>
              <h2>{t.today}</h2>
              {!data.today && <p className="muted">{t.todayNone}</p>}
              {data.today && (
                <>
                  <h3 style={{ margin: 0 }}>{data.today.title}</h3>
                  <p className="muted">{t.todayStatus[todayStatus]}</p>
                  <p><Link className={todayStatus === 'solved' ? 'btn' : 'btn btn-cta'} to={`/quetes/${data.today.slug}`}>
                    {todayStatus === 'solved' ? t.review : todayStatus === 'in_progress' ? t.resume : t.start}
                  </Link></p>
                </>
              )}
            </section>

            <section className="panel" style={{ marginBottom: 16 }} aria-label={t.missed}>
              <h2>{t.missed}</h2>
              {data.past.length === 0 && <p className="muted">{t.missedEmpty}</p>}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {data.past.map((d) => (
                  <li key={d.day} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    <span className="muted">{t.day(d.day)}</span>{' · '}
                    <Link to={`/quetes/${d.slug}`} aria-label={`${d.status === 'solved' ? t.redo : t.open} : ${d.title}`}>{d.title}</Link>{' '}
                    <span className="tag">{d.status === 'solved' ? t.done : d.status === 'in_progress' ? t.inProgress : t.todo}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel" aria-label={t.mine}>
              <h2>{t.mine}</h2>
              {data.solved.length === 0 && <p className="muted">{t.mineEmpty}</p>}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {data.solved.map((q) => (
                  <li key={q.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    {q.title}{' '}
                    <Link to={`/quetes/${q.slug}`} aria-label={`${t.redo} : ${q.title}`}>{t.redo}</Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
