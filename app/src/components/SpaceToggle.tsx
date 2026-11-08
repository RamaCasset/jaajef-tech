import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'

/** Switches between the community projects and the member's own space. */
export function SpaceToggle({ active }: { active: 'community' | 'personal' }) {
  const t = fr.myRepos
  return (
    <nav className="space-toggle" aria-label={t.toggleLabel}>
      <Link to="/projets" className={active === 'community' ? 'space-on' : ''} aria-current={active === 'community' ? 'page' : undefined}>{t.community}</Link>
      <Link to="/depots" className={active === 'personal' ? 'space-on' : ''} aria-current={active === 'personal' ? 'page' : undefined}>{t.personal}</Link>
    </nav>
  )
}
