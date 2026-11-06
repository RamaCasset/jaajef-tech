import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { useDebounced } from '../hooks'
import { listMyQuestProgress, listQuests, type MyQuestProgress, type QuestFilters, type QuestSummary } from '../lib/api'
import { fr, type ClanKey, type MasteryKey } from '../i18n/fr'

const EMPTY: QuestFilters = { clan: '', mastery: '', language: '', query: '' }

function QuestCard({ quest, progress }: { quest: QuestSummary; progress?: MyQuestProgress }) {
  return (
    <article className="panel quest-card">
      <div className="project-tags">
        <span className="tag">{fr.clans[quest.clan].name}</span>
        <span className="tag">{fr.masteries[quest.mastery].name}</span>
        {quest.language ? <span className="tag">{fr.quests.languages[quest.language]}</span> : null}
        {quest.daily_on ? <span className="tag">{fr.quests.daily}</span> : null}
        {progress?.status === 'solved' ? <span className="tag">{fr.quests.solved}</span> : null}
        {progress?.status === 'in_progress' ? <span className="tag">{fr.quests.inProgress(progress.tests_passed, progress.tests_total)}</span> : null}
      </div>
      <h3>{quest.title}</h3>
      {quest.summary ? <p className="muted">{quest.summary}</p> : null}
      <div className="quest-foot">
        <span className="mono tiny">{fr.quests.minutes(quest.est_minutes)} · {fr.quests.reward(quest.xp_reward, quest.kopek_reward)}</span>
        <Link className="btn" to={`/quetes/${quest.slug}`} aria-label={`${fr.quests.open} : ${quest.title}`}>{fr.quests.open}</Link>
      </div>
    </article>
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
