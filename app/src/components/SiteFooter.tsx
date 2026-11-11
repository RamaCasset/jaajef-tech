import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'

/** The footer on every page: the legal pages and who designed the site. */
export function SiteFooter() {
  const t = fr.footer
  return (
    <footer className="site-footer">
      <nav aria-label={t.label}>
        <Link to="/conditions">{t.terms}</Link>
        <Link to="/confidentialite">{t.privacy}</Link>
        <Link to="/regles">{t.rules}</Link>
        <Link to="/regles-offres">{t.jobRules}</Link>
      </nav>
      <p>{t.credit}</p>
    </footer>
  )
}
