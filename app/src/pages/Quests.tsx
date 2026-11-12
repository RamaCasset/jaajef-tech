import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { FlameTile, StreakDay } from '../components/StreakIcons'
import { useAuth } from '../auth/AuthContext'
import { useDebounced } from '../hooks'
import { getDailyQuest, getMyStreak, getQuestDrip, getXpPerLevel, listMyQuestProgress, listQuests, type DailyQuest, type MyQuestProgress, type QuestDrip, type QuestFilters, type QuestSummary, type StreakInfo } from '../lib/api'
import { Companion } from '../components/Companion'
import mascot from '../assets/art/mascot.png'
import baobabArt from '../assets/art/baobab.svg'
import fruitArt from '../assets/art/fruit.svg'
import singeArt from '../assets/art/singe.svg'
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
          <span className="quest-status-dot" aria-hidden="true" />
          {solved ? fr.quests.solved : going ? fr.quests.inProgress(progress.tests_passed, progress.tests_total) : fr.quests.available}
        </span>
      </div>
      <p className={`quest-kind tiny quest-kind-${quest.clan}`}>
        {fr.clans[quest.clan].name}{quest.language ? ` · ${fr.quests.languages[quest.language]}` : ''}
        {quest.daily_on ? ` · ${fr.quests.daily}` : ''}
      </p>
      <h3>{quest.title}</h3>
      {quest.summary ? <p className="muted">{quest.summary}</p> : null}
      <p className="muted tiny quest-meta"><span>{fr.masteries[quest.mastery].name}</span><span className="quest-time"><Icon name="clock" size={14} /> {fr.quests.minutes(quest.est_minutes)}</span></p>
      <div className="quest-foot">
        <span className="mono tiny quest-reward">{fr.quests.reward(quest.xp_reward, quest.kopek_reward)}</span>
        <Link className={`btn${going ? ' btn-cta' : ''}`} to={`/quetes/${quest.slug}`} aria-label={`${fr.quests.open} : ${quest.title}`}>
          {solved || going ? fr.quests.resume : fr.quests.launch} <Icon name="forward" size={16} />
        </Link>
      </div>
    </article>
  )
}

/** The seven days of this week (Monday first): the ones inside the current streak are ticked. */
function WeekDots({ streak }: { streak: StreakInfo }) {
  const today = (new Date().getDay() + 6) % 7
  const lastDone = streak.done_today ? today : today - 1
  return (
    <div className="week-dots" aria-hidden="true">
      {fr.quests.weekDays.map((d, i) => {
        const done = streak.current_streak > 0 && i <= lastDone && i > lastDone - streak.current_streak
        const state = i === today && streak.current_streak > 0 && streak.done_today ? 'today' : done ? 'done' : i === today ? 'today' : 'later'
        return (
          <span key={i} className="week-day">
            <StreakDay state={state} />
            <span className={`tiny muted${i === today ? ' week-today' : ''}`}>{d}</span>
          </span>
        )
      })}
    </div>
  )
}

/** Level, mastery and XP of the member, top right of the page. */
function LevelCard() {
  const { member } = useAuth()
  const [per, setPer] = useState(10000)
  useEffect(() => {
    let alive = true
    // A bonus block: if the setting cannot be read, the usual 10 000 XP per level is used.
    Promise.resolve().then(() => getXpPerLevel()).then((n) => { if (alive && n > 0) setPer(n) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const p = member?.profile
  if (!p || typeof p.xp !== 'number') return null
  const level = 1 + Math.floor(p.xp / per)
  const inLevel = p.xp % per
  const mastery = p.mastery ? fr.masteries[p.mastery]?.name : null
  return (
    <section className="panel level-card" aria-label={fr.profile.level(level, inLevel, per)}>
      <p className="level-line"><strong>{fr.home.level(level)}</strong>{mastery ? <span className="level-mastery"> · {mastery}</span> : null}</p>
      <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={per} aria-valuenow={inLevel} aria-label={fr.profile.level(level, inLevel, per)}>
        <div className="xp-fill" style={{ width: `${Math.min(100, (inLevel / per) * 100)}%` }} />
      </div>
      <p className="mono tiny muted level-xp">{inLevel} / {per} XP</p>
    </section>
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
          const label = daily.status === 'in_progress' || daily.status === 'solved' ? fr.quests.resume : fr.quests.launch
          return (
            <>
              <p className="hero-eyebrow"><Icon name="sun" size={16} /> <strong>{fr.quests.dailyEyebrow}</strong> <span className="muted"> · {fr.quests.dailyLeft(hours, minutes)}</span></p>
              <h2>{daily.title}</h2>
              {daily.summary ? <p className="hero-summary">{daily.summary}</p> : null}
              <p className="muted tiny">{fr.clans[daily.clan].name} · {fr.masteries[daily.mastery].name} · {fr.quests.minutes(daily.est_minutes)}</p>
              <p className="hero-reward">
                <span className="hero-xp">+{daily.xp_reward} XP</span>
                {daily.kopek_reward > 0 ? <span className="hero-kopeks"><span className="coin" aria-hidden="true" /> +{daily.kopek_reward} Kopeks</span> : null}
              </p>
              <p className="hero-go">
                <Link className="btn btn-cta" to={`/quetes/${daily.slug}`}>{label} <Icon name="forward" size={16} /></Link>
                <span className="muted tiny">{fr.quests.dailyHint}</span>
              </p>
            </>
          )
        })() : <p className="muted">{t.none}</p>}
        <div className="hero-mascot" aria-hidden="true">
          <div className="hero-mascot-circle"><img src={mascot} alt="" /></div>
          <span>{fr.quests.mascotSays}</span>
        </div>
      </section>
      {streak ? (
        <section className="panel hero-streak" aria-label={st.title}>
          <div className="hero-streak-top">
            <FlameTile />
            <div>
              <h2>{fr.quests.streakDaysRow(streak.current_streak)}</h2>
              <p className="muted">{streak.at_risk && !streak.done_today ? st.atRisk : streak.current_streak === 0 ? st.none : fr.quests.streakTagline}</p>
            </div>
          </div>
          <WeekDots streak={streak} />
          {streak.next_chest_in !== null && streak.chest_kopeks > 0 ? (
            <div className="hero-chest">
              <h3>{fr.quests.chestTitle(streak.chest_every)}</h3>
              <p className="muted">{fr.quests.chestLeft(streak.next_chest_in)}</p>
              <p className="hero-chest-reward">{fr.quests.chestReward(streak.chest_kopeks)} <span aria-hidden="true">✧</span></p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

type Tab = 'all' | 'going' | 'solved'

export function Quests() {
  const { member } = useAuth()
  const userId = member?.profile.id
  const [filters, setFilters] = useState<QuestFilters>(EMPTY)
  const [tab, setTab] = useState<Tab>('all')
  const query = useDebounced(filters.query)
  const [quests, setQuests] = useState<QuestSummary[] | null>(null)
  const [progress, setProgress] = useState<MyQuestProgress[]>([])
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [drip, setDrip] = useState<QuestDrip | null>(null)

  const set = <K extends keyof QuestFilters>(k: K, v: QuestFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    let alive = true
    // A bonus line: if it cannot load, the list below still works.
    Promise.resolve().then(() => (userId ? getQuestDrip() : null)).then((d) => { if (alive) setDrip(d ?? null) }).catch(() => undefined)
    return () => { alive = false }
  }, [userId])

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
  const statusOf = (q: QuestSummary) => byQuest.get(q.id)?.status
  const going = (quests ?? []).filter((q) => statusOf(q) === 'in_progress').length
  const done = (quests ?? []).filter((q) => statusOf(q) === 'solved').length
  const shown = (quests ?? []).filter((q) => tab === 'all' || (tab === 'going' ? statusOf(q) === 'in_progress' : statusOf(q) === 'solved'))
  const firstName = (member?.profile.display_name ?? '').split(/\s+/)[0]
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'all', label: fr.quests.tabAll, n: quests?.length ?? 0 },
    { key: 'going', label: fr.quests.tabGoing, n: going },
    { key: 'solved', label: fr.quests.tabDone, n: done },
  ]

  return (
    <AppShell>
      <main className="page quests notices-page">
        <div className="quest-deco" aria-hidden="true">
          <img src={baobabArt} alt="" />
          <img src={fruitArt} alt="" />
          <img src={singeArt} alt="" />
        </div>
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{fr.quests.eyebrow}</p>
            <h1 className="page-title">{firstName ? fr.quests.greeting(firstName) : fr.quests.title}</h1>
            <p className="muted">{fr.quests.subtitle}</p>
          </div>
          <LevelCard />
        </header>

        <Hero />

        <div className="quest-section-head">
          <h2>{fr.quests.nextAdventure}</h2>
          {quests ? <span className="muted tiny">{fr.quests.count(quests.length)}</span> : null}
          {drip ? <span className="muted tiny">{fr.quests.drip(drip.day, drip.total)}</span> : null}
          <Link className="quest-notebook-link tiny" to="/quetes/carnet">{fr.quests.notebookLink(progress.filter((x) => x.status === 'solved').length)}</Link>
        </div>
        <div className="quest-tabs" role="tablist" aria-label={fr.quests.nextAdventure}>
          {tabs.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={`quest-tab${tab === x.key ? ' quest-tab-on' : ''}`} onClick={() => setTab(x.key)}>
              {x.label} <span className="quest-tab-n">{x.n}</span>
            </button>
          ))}
        </div>

        <div className="quest-filters">
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input type="search" role="searchbox" aria-label={fr.quests.search} placeholder={fr.quests.search} value={filters.query} onChange={(e) => set('query', e.target.value)} />
          </label>
          <label className="quest-select">
            <span className="sr-only">{fr.quests.mastery}</span>
            <select aria-label={fr.quests.mastery} value={filters.mastery} onChange={(e) => set('mastery', e.target.value as MasteryKey | '')}>
              <option value="">{fr.quests.anyMastery}</option>
              {Object.entries(fr.masteries).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </label>
          <label className="quest-select">
            <span className="sr-only">{fr.quests.language}</span>
            <select aria-label={fr.quests.language} value={filters.language} onChange={(e) => set('language', e.target.value as QuestFilters['language'])}>
              <option value="">{fr.quests.anyLanguage}</option>
              {Object.entries(fr.quests.languages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="notice-filters" role="group" aria-label={fr.quests.clan}>
          <button type="button" className="chip" aria-pressed={filters.clan === ''} onClick={() => set('clan', '')}>{fr.quests.allClans}</button>
          {(Object.entries(fr.clans) as [ClanKey, { name: string }][]).map(([k, v]) => (
            <button key={k} type="button" className="chip" aria-pressed={filters.clan === k} onClick={() => set('clan', filters.clan === k ? '' : k)}>{v.name}</button>
          ))}
          {filtersOn ? <button type="button" className="btn btn-small" onClick={() => setFilters(EMPTY)}>{fr.quests.reset}</button> : null}
        </div>

        {failed ? (
          <div role="alert" className="alert">
            {fr.quests.error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.quests.retry}</button>
          </div>
        ) : null}
        {quests === null && !failed ? <p className="muted">{fr.common.loading}</p> : null}
        {quests && shown.length === 0 ? <p className="muted">{fr.quests.empty}</p> : null}
        {quests && shown.length > 0 ? (
          <div className="quest-list">
            {shown.map((q) => <QuestCard key={q.id} quest={q} progress={byQuest.get(q.id)} />)}
          </div>
        ) : null}
        <p className="quest-foot-note muted tiny">{fr.quests.footNote}</p>
      </main>
    </AppShell>
  )
}
