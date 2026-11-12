import { Link } from 'react-router-dom'
import { CornerArt } from '../components/CornerArt'
import { SiteFooter } from '../components/SiteFooter'
import { Logo } from '../components/Logo'
import { legal, type LegalDocKey } from '../i18n/legal'
import { getLang } from '../i18n/lang'

const ORDER: { key: LegalDocKey; to: string }[] = [
  { key: 'privacy', to: '/confidentialite' },
  { key: 'terms', to: '/conditions' },
  { key: 'rules', to: '/regles' },
  { key: 'jobs', to: '/regles-offres' },
]

/** One of the legal pages. Public: anyone can read them, signed in or not. */
export function Legal({ doc }: { doc: LegalDocKey }) {
  const set = legal[getLang()]
  const d = set.docs[doc]
  return (
    <main className="about legal">
      <CornerArt />
      <header className="about-top"><Link to="/" aria-label="jaajef.tech"><Logo size={18} /></Link></header>
      <nav aria-label={set.menu} className="legal-nav">
        {ORDER.map((o) => (
          <Link key={o.key} to={o.to} className={`pill ${o.key === doc ? 'pill-on' : ''}`} aria-current={o.key === doc ? 'page' : undefined}>
            {set.docs[o.key].title}
          </Link>
        ))}
      </nav>
      <article className="legal-body">
        <h1>{d.title}</h1>
        <p className="tiny muted">{set.updated}</p>
        <p>{d.intro}</p>
        {d.sections.map((s) => (
          <section key={s.h} className="legal-section">
            <h2>{s.h}</h2>
            {s.p.map((t) => <p key={t}>{t}</p>)}
          </section>
        ))}
      </article>
      <SiteFooter />
    </main>
  )
}
