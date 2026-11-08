import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { useDebounced } from '../hooks'
import { getDailyQuest, getMyStreak, listMyQuestProgress, listQuests, type DailyQuest, type MyQuestProgress, type QuestFilters, type QuestSummary, type StreakInfo } from '../lib/api'
import { Companion } from '../components/Companion'
import mascot from '../assets/art/mascot.png'
import { fr, type ClanKey, type MasteryKey } from '../i18n/fr'

const EMPTY: QuestFilters = { clan: '', mastery: '', language: '', query: '' }

function QuestCard({ quest, progress }: { quest: QuestSummary; progress?: MyQuestProgress }) {
  const solved = progress?.status === 'solved'
  const going = progress?.status === 'in_progress'
  return (
    <article className={`panel quest-card${going ? ' quest-card-on' : ''}`}>
      <div className="quest-top">
        <Companion clan={quest.clan} />
        <span className={`quest-status${solved ? ' quest-status-done' : going ? ' quest-status-going' : ''}`}>
          {solved ? fr.quests.solved : going ? fr.quests.inProgress(progress.tests_passed, progress.tests_total) : fr.quests.available}
        </span>
      </div>
      <p className="quest-kind tiny">
        {fr.clans[quest.clan].name}{quest.language ? ` · ${fr.quests.languages[quest.language]}` : ''}
        {quest.daily_on ? ` · ${fr.quests.daily}` : ''}
      </p>
      <h3>{quest.title}</h3>
      {quest.summary ? <p className="muted">{quest.summary}</p> : null}
      <p className="muted tiny">{fr.masteries[quest.mastery].name} · {fr.quests.minutes(quest.est_minutes)}</p>
      <div className="quest-foot">
        <span className="mono tiny quest-reward">{fr.quests.reward(quest.xp_reward, quest.kopek_reward)}</span>
        <Link className={`btn${solved ? '' : going ? ' btn-cta' : ''}`} to={`/quetes/${quest.slug}`} aria-label={`${fr.quests.open} : ${quest.title}`}>
          {solved ? fr.quests.review : going ? fr.quests.resume : fr.quests.launch}
        </Link>
      </div>
    </article>
  )
}

function Hero() {
  const [daily, setDaily] = useState<DailyQuest | null>(null)
  const [streak, setStreak] = useState<StreakInfo | null>(null)
  useEffect(() => {
    let alive = true
    // These two blocks are a bonus: if they cannot load, the list below still works.
    Promise.resolve().then(() => getDailyQuest()).then((d) => { if (alive) setDaily(d ?? null) }).catch(() => undefined)
    Promise.resolve().then(() => getMyStreak()).then((s) => { if (alive) setStreak(s ?? null) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const t = fr.home.quest
  const st = fr.home.streak
  return (
    <div className="quest-hero">
      <section className="panel hero-daily" aria-label={t.title}>
        {daily ? (() => {
          const hours = Math.floor(daily.seconds_left / 3600)
          const minutes = Math.floor((daily.seconds_left % 3600) / 60)
          return (
            <>
              <p className="eyebrow">{t.title} · {t.timeLeft(hours, minutes)}</p>
              <h2>{daily.title}</h2>
              {daily.summary ? <p className="muted">{daily.summary}</p> : null}
              <p className="muted tiny">{fr.clans[daily.clan].name} · {fr.masteries[daily.mastery].name} · {fr.quests.minutes(daily.est_minutes)}</p>
              <p className="mono quest-reward">{fr.quests.reward(daily.xp_reward, daily.kopek_reward)}</p>
              <p>
                <Link className={daily.status === 'solved' ? 'btn' : 'btn btn-cta'} to={`/quetes/${daily.slug}`}>
                  {daily.status === 'solved' ? t.review : daily.status === 'in_progress' ? t.resume : t.start}
                </Link>
              </p>
            </>
          )
        })() : <p className="muted">{t.none}</p>}
        <div className="hero-mascot" aria-hidden="true">
          <img src={mascot} alt="" />
          <span>{fr.quests.mascotSays}</span>
        </div>
      </section>
      {streak ? (
        <section className="panel hero-streak" aria-label={st.title}>
          <h2>{st.days(streak.current_streak)}</h2>
          {streak.done_today ? <p>{st.doneToday}</p> : streak.at_risk ? <p>{st.atRisk}</p> : <p className="muted">{streak.current_streak === 0 ? st.none : ''}</p>}
          <p className="muted tiny">{st.longest(streak.longest_streak)}</p>
          {streak.next_chest_in !== null && streak.chest_kopeks > 0 ? <p className="muted tiny">{st.chest(streak.next_chest_in, streak.chest_kopeks)}</p> : null}
        </section>
      ) : null}
    </div>
  )
}

export function Quests() {
  const { member } = useAuth()
  const userId = member?.profile.id
  const [filters, setFilters] = useState<QuestFilters>(EMPTY)
  const query = useDebounced(filters.query)
  const [quests, setQuests] = useState<QuestSummary[] | null>(null)
  const [progress, setProgress] = useState<MyQuestProgress[]>([])
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  const set = <K extends keyof QuestFilters>(k: K, v: QuestFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    let alive = true
    setFailed(false)
    setQuests(null)
    Promise.all([listQuests({ ...filters, query }), userId ? listMyQuestProgress(userId) : Promise.resolve([])])
      .then(([list, mine]) => { if (alive) { setQuests(list); setProgress(mine) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
    // The typed field is read through its debounced copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.clan, filters.mastery, filters.language, userId, reload])

  const byQuest = new Map(progress.map((p) => [p.quest_id, p]))
  const filtersOn = filters.clan || filters.mastery || filters.language || filters.query

  return (
    <AppShell>
      <main className="page quests">
        <header className="page-head">
          <h1 className="page-title">{fr.quests.title}</h1>
          <p className="muted">{fr.quests.subtitle}</p>
        </header>

        <Hero />

        <div className="quest-filters">
          <input type="search" role="searchbox" aria-label={fr.quests.search} placeholder={fr.quests.search} value={filters.query} onChange={(e) => set('query', e.target.value)} />
          <label>{fr.quests.clan}
            <select value={filters.clan} onChange={(e) => set('clan', e.target.value as ClanKey | '')}>
              <option value="">{fr.quests.any}</option>
              {Object.entries(fr.clans).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </label>
          <label>{fr.quests.mastery}
            <select value={filters.mastery} onChange={(e) => set('mastery', e.target.value as MasteryKey | '')}>
              <option value="">{fr.quests.any}</option>
              {Object.entries(fr.masteries).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </label>
          <label>{fr.quests.language}
            <select value={filters.language} onChange={(e) => set('language', e.target.value as QuestFilters['language'])}>
              <option value="">{fr.quests.any}</option>
              {Object.entries(fr.quests.languages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {filtersOn ? <button type="button" className="btn" onClick={() => setFilters(EMPTY)}>{fr.quests.reset}</button> : null}
        </div>

        {failed ? (
          <div role="alert" className="alert">
            {fr.quests.error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.quests.retry}</button>
          </div>
        ) : null}
        {quests === null && !failed ? <p className="muted">{fr.common.loading}</p> : null}
        {quests && quests.length === 0 ? <p className="muted">{fr.quests.empty}</p> : null}
        {quests && quests.length > 0 ? (
          <>
            <p className="muted">{fr.quests.count(quests.length)}</p>
            <div className="quest-list">
              {quests.map((q) => <QuestCard key={q.id} quest={q} progress={byQuest.get(q.id)} />)}
            </div>
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
