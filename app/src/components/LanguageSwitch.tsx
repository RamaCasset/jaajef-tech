import { useLang } from '../i18n/LangContext'
import type { Lang } from '../i18n/lang'

const OPTIONS: { value: Lang; label: string; name: string }[] = [
  { value: 'fr', label: 'FR', name: 'Français' },
  { value: 'en', label: 'EN', name: 'English' },
]

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang()
  return (
    <div className={`lang-switch${className ? ` ${className}` : ''}`} role="group" aria-label="Langue / Language">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-label={o.name}
          aria-pressed={lang === o.value}
          className={lang === o.value ? 'lang-on' : undefined}
          onClick={() => setLang(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
