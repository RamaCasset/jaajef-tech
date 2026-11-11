import { AppShell } from '../components/AppShell'
import { BackLink } from '../components/BackLink'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { fr } from '../i18n/fr'

export function LanguageSettings() {
  const t = fr.settingsHub.languagePage
  return (
    <AppShell>
      <main className="page settings-hub">
        <BackLink to="/parametres">{fr.settingsHub.backToSettings}</BackLink>
        <p className="eyebrow">{t.crumb}</p>
        <h1 className="page-title">{t.title}</h1>
        <p className="muted">{t.text}</p>
        <div className="panel panel-pad"><LanguageSwitch /></div>
      </main>
    </AppShell>
  )
}
