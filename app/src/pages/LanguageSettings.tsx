import { AppShell } from '../components/AppShell'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { fr } from '../i18n/fr'

export function LanguageSettings() {
  const t = fr.settingsHub.languagePage
  return (
    <AppShell>
      <main className="page settings-hub">
        <p className="eyebrow">{t.crumb}</p>
        <h1 className="page-title">{t.title}</h1>
        <p className="muted">{t.text}</p>
        <div className="panel panel-pad"><LanguageSwitch /></div>
      </main>
    </AppShell>
  )
}
