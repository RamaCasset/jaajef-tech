import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BackLink } from '../components/BackLink'
import { Icon } from '../components/Icon'
import { useLang } from '../i18n/LangContext'
import { fr } from '../i18n/fr'

/** The settings home: one row per area, each leading to its own page. */
export function SettingsHub() {
  const t = fr.settingsHub
  const { lang } = useLang()
  const rows = [
    { to: '/parametres/profil', ...t.profile, side: t.profile.action, danger: false },
    { to: '/parametres/compte', ...t.account, side: t.account.action, danger: false },
    { to: '/parametres/langue', ...t.language, side: lang === 'fr' ? 'Français' : 'English', danger: false },
    { to: '/parametres/compte#notifications', ...t.notifications, side: t.notifications.action, danger: false },
    { to: '/parametres/compte#suppression', ...t.delete, side: t.delete.action, danger: true },
  ]
  return (
    <AppShell>
      <main className="page settings-hub">
        <BackLink to="/la-cite">{fr.settingsHub.back}</BackLink>
        <p className="eyebrow">{t.crumb}</p>
        <h1 className="page-title">{t.title}</h1>
        <p className="muted">{t.subtitle}</p>
        <ul className="settings-list panel">
          {rows.map((r) => (
            <li key={r.to} className={r.danger ? 'settings-row settings-row-danger' : 'settings-row'}>
              <Link to={r.to}>
                <span>
                  <strong>{r.title}</strong>
                  <span className="muted">{r.text}</span>
                </span>
                <span className="settings-action">{r.side} <Icon name="chevron-right" size={14} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </AppShell>
  )
}
