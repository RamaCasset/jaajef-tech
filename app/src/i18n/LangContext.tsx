import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getLang, setLangValue, type Lang } from './lang'

type Ctx = { lang: Lang; setLang: (l: Lang) => void }
const LangCtx = createContext<Ctx>({ lang: 'fr', setLang: () => undefined })

export function useLang(): Ctx {
  return useContext(LangCtx)
}

/**
 * Holds the chosen language. Changing it re-creates the screen underneath, so every text is read again.
 * Place it inside the router and the account provider, so the sign-in and the page are kept.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getLang())
  const setLang = useCallback((l: Lang) => {
    setLangValue(l)
    setLangState(l)
  }, [])
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return (
    <LangCtx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangCtx.Provider>
  )
}
