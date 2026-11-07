import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'

export function Guide() {
  const t = fr.guide
  return (
    <AppShell>
      <main className="page">
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>
        <ol style={{ listStyle: 'none', padding: 0 }}>
          {t.sections.map((s, i) => (
            <li key={s.id}>
              <section className="panel" style={{ marginBottom: 12 }} aria-labelledby={`g-${s.id}`}>
                <h2 id={`g-${s.id}`}>{i + 1}. {s.title}</h2>
                <p>{s.text}</p>
                {'to' in s && s.to ? <p><Link className="btn" to={s.to}>{s.cta}</Link></p> : null}
              </section>
            </li>
          ))}
        </ol>
      </main>
    </AppShell>
  )
}
