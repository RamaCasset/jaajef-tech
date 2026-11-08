export type Lang = 'fr' | 'en'

const KEY = 'jaajef.lang'
let current: Lang = 'fr'

export function readStoredLang(): Lang {
  try {
    const v = window.localStorage.getItem(KEY)
    if (v === 'fr' || v === 'en') return v
  } catch {
    // Storage can be blocked: French is the default.
  }
  return 'fr'
}

export function getLang(): Lang {
  return current
}

export function setLangValue(lang: Lang): void {
  current = lang
  try { document.documentElement.lang = lang } catch { /* no document */ }
  try { window.localStorage.setItem(KEY, lang) } catch { /* the choice just will not be remembered */ }
}

export function initLang(): void {
  current = readStoredLang()
  try { document.documentElement.lang = current } catch { /* no document */ }
}

// Dates and numbers follow the chosen language.
export function dateLocale(): string {
  return current === 'en' ? 'en-GB' : 'fr-FR'
}
