import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { getTalent, startConversation, type TalentDetail } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

export function TalentProfile() {
  const t = fr.talent
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [p, setP] = useState<TalentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getTalent(id).then((r) => { if (alive) setP(r) }).catch((e) => { if (alive) setError(friendlyError(e)) })
    return () => { alive = false }
  }, [id])

  async function write() {
    if (!p) return
    setError(null)
    try {
      navigate(`/messages/${await startConversation(p.user_id)}`)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <AppShell>
      <main className="page jobs">
        <p><Link to="/talents">← {t.back}</Link></p>
        {error && <div className="alert" role="alert">{error}</div>}
        {!p && !error && <p className="muted">{fr.common.loading}</p>}
        {p && (
          <>
            <header className="page-head">
              <h1 className="page-title">{p.display_name}</h1>
              <p>{p.headline}</p>
              <p className="muted">
                {[
                  p.location,
                  p.experience_years != null ? t.years(p.experience_years) : null,
                  p.availability ? t.availabilities[p.availability as keyof typeof t.availabilities] : null,
                ].filter(Boolean).join(' · ')}
              </p>
              <p><button type="button" className="btn btn-cta" onClick={() => void write()}>{t.write}</button></p>
            </header>
            {p.summary && <section className="panel panel-pad"><p style={{ whiteSpace: 'pre-wrap' }}>{p.summary}</p></section>}
            {p.skills.length > 0 && (
              <section className="panel panel-pad">
                <h2>{t.skills}</h2>
                <p>{p.skills.map((k) => <span key={k} className="tag">{k}</span>)}</p>
              </section>
            )}
            {(p.website || p.linkedin_url) && (
              <section className="panel panel-pad">
                {p.website && <p><a href={p.website} target="_blank" rel="noopener noreferrer nofollow">{t.website}</a></p>}
                {p.linkedin_url && <p><a href={p.linkedin_url} target="_blank" rel="noopener noreferrer nofollow">{t.linkedin}</a></p>}
              </section>
            )}
            {p.portfolio.length > 0 && (
              <section className="panel panel-pad">
                <h2>{t.portfolio}</h2>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {p.portfolio.map((it, i) => (
                    <li key={i} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                      <strong>{it.title}</strong>
                      {it.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{it.description}</p>}
                      {it.url && <p className="tiny" style={{ margin: 0 }}><a href={it.url} target="_blank" rel="noopener noreferrer nofollow">{it.url}</a></p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
