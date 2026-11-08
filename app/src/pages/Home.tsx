import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { ProfileView } from '../components/ProfileView'
import { getDailyQuest, getMyStreak, loadProfile, type DailyQuest, type ProfileData, type StreakInfo } from '../lib/api'
import { fr } from '../i18n/fr'

type Loaded<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T }

/** Loads one block of the page on its own, so one failure does not blank the rest. */
function useBlock<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [block, setBlock] = useState<Loaded<T>>({ state: 'loading' })
  useEffect(() => {
    let alive = true
    setBlock({ state: 'loading' })
    load().then((value) => { if (alive) setBlock({ state: 'ready', value }) }).catch(() => { if (alive) setBlock({ state: 'failed' }) })
    return () => { alive = false }
    // `key` stands for the inputs of `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return block
}

function QuestCard({ block }: { block: Loaded<DailyQuest | null> }) {
  const t = fr.home.quest
  return (
    <section className="panel home-card home-quest" aria-label={t.title}>
      <h2>{t.title}</h2>
      {block.state === 'loading' ? <p className="muted">{fr.common.loading}</p> : null}
      {block.state === 'failed' ? <p role="alert" className="alert">{t.error}</p> : null}
      {block.state === 'ready' && !block.value ? <p className="muted">{t.none}</p> : null}
      {block.state === 'ready' && block.value ? (() => {
        const q = block.value
        const hours = Math.floor(q.seconds_left / 3600)
        const minutes = Math.floor((q.seconds_left % 3600) / 60)
        return (
          <>
            <div className="project-tags">
              <span className="tag">{fr.clans[q.clan].name}</span>
              <span className="tag">{fr.masteries[q.mastery].name}</span>
              {q.language ? <span className="tag">{fr.quests.languages[q.language]}</span> : null}
            </div>
            <h3 style={{ margin: 0 }}>{q.title}</h3>
            {q.summary ? <p className="muted">{q.summary}</p> : null}
            <p className="mono tiny">{fr.quests.minutes(q.est_minutes)} · {fr.quests.reward(q.xp_reward, q.kopek_reward)} · {t.timeLeft(hours, minutes)}</p>
            {q.status === 'solved' ? <p>{t.solved}</p> : null}
            <p>
              <Link className={q.status === 'solved' ? 'btn' : 'btn btn-cta'} to={`/quetes/${q.slug}`}>
                {q.status === 'solved' ? t.review : q.status === 'in_progress' ? t.resume : t.start}
              </Link>
            </p>
          </>
        )
      })() : null}
    </section>
  )
}

function StreakCard({ block }: { block: Loaded<StreakInfo | null> }) {
  const t = fr.home.streak
  return (
    <section className="panel home-card" aria-label={t.title}>
      <h2>{t.title}</h2>
      {block.state === 'loading' ? <p className="muted">{fr.common.loading}</p> : null}
      {block.state === 'failed' ? <p role="alert" className="alert">{t.error}</p> : null}
      {block.state === 'ready' && block.value ? (() => {
        const s = block.value
        return (
          <>
            <p className="home-big">{t.days(s.current_streak)}</p>
            {s.current_streak === 0 ? <p className="muted">{t.none}</p> : null}
            {s.done_today ? <p>{t.doneToday}</p> : null}
            {!s.done_today && s.protected_by_freeze ? <p>{t.protectedByFreeze}</p> : null}
            {!s.done_today && !s.protected_by_freeze && s.at_risk ? <p>{t.atRisk}</p> : null}
            <p className="muted tiny">{t.longest(s.longest_streak)}</p>
            {s.next_chest_in !== null && s.chest_kopeks > 0 ? <p className="muted tiny">{t.chest(s.next_chest_in, s.chest_kopeks)}</p> : null}
            {s.freeze_max > 0 ? <p className="muted tiny">{t.freezes(s.freezes, s.freeze_max)}</p> : null}
          </>
        )
      })() : null}
    </section>
  )
}

export function Home() {
  const { member } = useAuth()
  const me = member?.profile
  const [data, setData] = useState<ProfileData | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const quest = useBlock(getDailyQuest, 'quest')
  const streak = useBlock(getMyStreak, 'streak')

  const username = me?.username
  const myId = me?.id
  useEffect(() => {
    if (!username || !myId) return
    let alive = true
    setFailed(false)
    loadProfile(username, myId).then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [username, myId, reload])

  return (
    <AppShell>
      <main className="page profile">
        {failed ? (
          <div className="alert" role="alert">
            {fr.home.profileError} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.profile.retry}</button>
          </div>
        ) : data === undefined ? (
          <p className="muted">{fr.common.loading}</p>
        ) : data === null ? (
          <p role="status">{fr.profile.notFound}</p>
        ) : (
          <ProfileView
            data={data}
            viewerId={me?.id ?? ''}
            extra={(
              <div className="home-strip">
                <QuestCard block={quest} />
                <StreakCard block={streak} />
              </div>
            )}
          />
        )}
      </main>
    </AppShell>
  )
}
