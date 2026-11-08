import { CornerArt } from '../components/CornerArt'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { Stepper } from '../components/Stepper'
import { fr, type ClanKey, type MasteryKey } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { setCharacter, setOnboardingStep } from '../lib/api'

const CLANS = Object.keys(fr.clans) as ClanKey[]
const MASTERIES = Object.keys(fr.masteries) as MasteryKey[]

export function ChooseClan() {
  const { member, refreshMember } = useAuth()
  const navigate = useNavigate()
  const [clan, setClan] = useState<ClanKey | null>(null)
  const [mastery, setMastery] = useState<MasteryKey | null>('ndongo')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const profile = member?.profile
  const username = profile?.username ?? ''
  const ready = clan !== null && mastery !== null

  async function enter() {
    if (!clan || !mastery) { setError(fr.clan.chooseFirst); return }
    setError(null)
    setBusy(true)
    try {
      await setCharacter(clan, mastery)
      // Step 3 of the original design ("Votre guide") is not built yet, so we go straight to step 4.
      await setOnboardingStep(4)
      await refreshMember()
      navigate('/cite', { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page" style={{ alignContent: 'start' }}>
      <CornerArt />
      <header style={{ width: 'min(100%, 1100px)', marginBottom: 24 }}><Logo /></header>
      <Stepper steps={[fr.steps.identity, fr.steps.clan, fr.steps.enter]} current={1} />

      <section className="panel clan-layout">
        <div>
          <p className="eyebrow">{fr.clan.eyebrow}</p>
          <h1 style={{ fontSize: 34, margin: '8px 0 4px' }}>{fr.clan.title}</h1>
          <p className="muted" style={{ marginBottom: 20 }}>{fr.clan.subtitle}</p>

          {error && <div className="alert" role="alert">{error}</div>}

          <div role="radiogroup" aria-label={fr.clan.title} className="clan-grid">
            {CLANS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={clan === key}
                className={`choice ${clan === key ? 'choice-on' : ''}`}
                onClick={() => setClan(key)}
              >
                <strong>{fr.clans[key].name}</strong>
                <span className="choice-role">{fr.clans[key].role}</span>
                <span className="muted choice-tag">{fr.clans[key].tagline}</span>
              </button>
            ))}
          </div>

          <h2 style={{ fontSize: 15, margin: '24px 0 10px' }}>{fr.clan.mastery}</h2>
          <div role="radiogroup" aria-label={fr.clan.mastery} className="mastery-row">
            {MASTERIES.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={mastery === key}
                className={`pill ${mastery === key ? 'pill-on' : ''}`}
                onClick={() => setMastery(key)}
              >
                {fr.masteries[key].name} <span className="muted">({fr.masteries[key].level})</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{fr.clan.masteryHint}</p>
        </div>

        <aside className="preview" aria-label={fr.clan.previewLabel}>
          <div className="preview-head"><span className="eyebrow" style={{ color: 'var(--fg-muted)' }}>{fr.clan.previewLabel}</span><span className="live">● LIVE</span></div>
          <div className="avatar" aria-hidden="true">{(profile?.display_name ?? username ?? '?').slice(0, 1).toUpperCase() || '?'}</div>
          <h3 style={{ textAlign: 'center', fontSize: 22 }}>{profile?.display_name ?? username}</h3>
          <p className="muted" style={{ textAlign: 'center', margin: '2px 0 14px', fontSize: 13 }}>@{username}</p>
          <p style={{ textAlign: 'center', minHeight: 24 }}>
            {clan ? <span className="tag">{fr.clans[clan].name}</span> : <span className="muted">—</span>}
          </p>
          <p style={{ textAlign: 'center', color: 'var(--accent)', fontSize: 14 }}>
            {mastery ? fr.masteries[mastery].name : '—'} · {fr.clan.level} 1
          </p>
          <dl className="stats">
            <div><dt>{fr.clan.level}</dt><dd>01</dd></div>
            <div><dt>{fr.clan.xp}</dt><dd>0</dd></div>
            <div><dt>{fr.clan.kopeks}</dt><dd>{member?.kopeks ?? 100}</dd></div>
          </dl>
        </aside>
      </section>

      <footer className="clan-footer">
        <span className="muted">{fr.clan.adventure}</span>
        <button className="btn btn-cta" type="button" onClick={enter} disabled={!ready || busy}>{fr.clan.enter} →</button>
      </footer>
    </main>
  )
}
