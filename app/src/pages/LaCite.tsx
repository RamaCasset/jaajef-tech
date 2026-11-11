import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { listDiscoverCommunities, listMyCommunities, listMyQuestProgress, loadMyProfileFields, type Community, type CommunityTopic } from '../lib/api'

const TOPIC_ICON: Record<CommunityTopic, string> = { web: 'repo', ia_data: 'fork', gaming: 'arena', design: 'souk', mobile: 'repo', open_source: 'fork' }

/** "La Cité": the welcome page. Three first steps, three places to go, a few communities, one way to contribute. */
export function LaCite() {
  const { member } = useAuth()
  const me = member?.profile
  const t = fr.laCite
  const [introduced, setIntroduced] = useState<boolean | null>(null)
  const [joined, setJoined] = useState<boolean | null>(null)
  const [started, setStarted] = useState<boolean | null>(null)
  const [communities, setCommunities] = useState<Community[] | null>(null)

  const myId = me?.id
  useEffect(() => {
    if (!myId) return
    let alive = true
    Promise.resolve().then(() => loadMyProfileFields(myId)).then((p) => { if (alive) setIntroduced(Boolean(p?.bio && p.bio.trim())) }).catch(() => { if (alive) setIntroduced(false) })
    Promise.resolve().then(() => listMyCommunities(myId)).then((l) => { if (alive) setJoined((l ?? []).some((c) => !c.project_id)) }).catch(() => { if (alive) setJoined(false) })
    Promise.resolve().then(() => listMyQuestProgress(myId)).then((l) => { if (alive) setStarted((l ?? []).length > 0) }).catch(() => { if (alive) setStarted(false) })
    Promise.resolve().then(() => listDiscoverCommunities()).then((l) => { if (alive) setCommunities(l ?? []) }).catch(() => { if (alive) setCommunities([]) })
    return () => { alive = false }
  }, [myId])

  const done = [introduced === true, joined === true, started === true]
  const doneCount = done.filter(Boolean).length
  const stepLinks = ['/parametres', '/communautes', '/quetes']
  const company = (communities ?? []).filter((c) => !c.project_id).slice(0, 3)

  return (
    <AppShell>
      <main className="page lacite">
        <div className="lacite-top">
          <section className="panel lacite-hero">
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="lacite-title">{t.title[0]}<br />{t.title[1]}</h1>
            <p className="muted lacite-text">{t.text[0]}<br />{t.text[1]}</p>
            <div className="lacite-actions">
              <Link className="btn btn-cta" to="/communautes">{t.explore} <Icon name="forward" size={16} /></Link>
              <Link className="btn" to="/parametres">{t.completeProfile}</Link>
            </div>
            <p className="muted tiny">{t.pace}</p>
          </section>

          <section className="panel lacite-steps" aria-label={t.stepsTitle}>
            <div className="lacite-steps-head">
              <h2>{t.stepsTitle}</h2>
              <span className="mono tiny accent">{t.stepsCount(doneCount)}</span>
            </div>
            <p className="muted">{t.stepsText}</p>
            <div className="path-bar" role="progressbar" aria-label={t.stepsTitle} aria-valuemin={0} aria-valuemax={3} aria-valuenow={doneCount}>
              <span style={{ width: `${(doneCount / 3) * 100}%` }} />
            </div>
            <ol>
              {t.steps.map((s, i) => (
                <li key={s.title}>
                  <Link className={`lacite-step${done[i] ? ' lacite-step-done' : ''}`} to={stepLinks[i]}>
                    <span className="lacite-step-no mono" aria-hidden="true">{done[i] ? <Icon name="check" size={14} /> : `0${i + 1}`}</span>
                    <span>
                      <strong>{s.title}</strong>
                      <span className="muted tiny lacite-step-text">{s.text}</span>
                    </span>
                    {done[i] ? <span className="sr-only">{t.stepDone}</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="lacite-section-head">
          <h2>{t.playground}</h2>
          <span className="mono tiny muted">{t.playgroundCaption}</span>
        </div>
        <div className="lacite-cards">
          {([
            { key: 'projects', icon: 'repo', to: '/projets', tone: 'blue' },
            { key: 'quests', icon: 'quest', to: '/quetes', tone: 'violet' },
            { key: 'souk', icon: 'souk', to: '/souk', tone: 'amber' },
          ] as const).map((c) => (
            <article key={c.key} className={`panel lacite-card lacite-tone-${c.tone}`}>
              <div className="lacite-card-top">
                <span className="community-tile" aria-hidden="true"><Icon name={c.icon} size={22} /></span>
                <span className="community-kind">{t.cards[c.key].kind}</span>
              </div>
              <h3>{t.cards[c.key].title}</h3>
              <p className="muted">{t.cards[c.key].text}</p>
              <Link className="community-more" to={c.to}>{t.cards[c.key].cta} <Icon name="forward" size={14} /></Link>
            </article>
          ))}
        </div>

        <div className="lacite-bottom">
          <section className="panel lacite-company" aria-label={t.companyTitle}>
            <h2>{t.companyTitle}</h2>
            <p className="muted">{t.companyText}</p>
            {communities !== null && company.length === 0 ? <p className="muted">{t.noCommunities}</p> : null}
            <ul>
              {company.map((c) => (
                <li key={c.id}>
                  <span className="community-tile" aria-hidden="true">{c.topic ? <Icon name={TOPIC_ICON[c.topic]} size={20} /> : c.name.slice(0, 2).toUpperCase()}</span>
                  <span className="lacite-company-body">
                    <strong>{c.name}</strong>
                    <span className="muted tiny">{c.description ?? (c.tags ?? []).join(', ')}</span>
                  </span>
                  <Link className="btn" to={`/communautes/${c.slug}`} aria-label={`${t.discover} : ${c.name}`}>{t.discover}</Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel lacite-impact" aria-label={t.impactTitle.join(' ')}>
            <p className="community-kind">{t.impactKind}</p>
            <h2>{t.impactTitle[0]}<br />{t.impactTitle[1]}</h2>
            <p className="muted">{t.impactText}</p>
            <span className="lacite-gfi"><Icon name="fork" size={14} /> {t.impactTag}</span>
            <Link className="btn" to="/projets">{t.impactCta} <Icon name="forward" size={14} /></Link>
          </section>
        </div>

        <footer className="communities-foot">
          <span className="muted tiny">{t.footer}</span>
        </footer>
      </main>
    </AppShell>
  )
}
