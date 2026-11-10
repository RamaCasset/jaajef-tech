import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { myEquippedTheme } from '../lib/api'
import { applyTheme } from '../lib/theme'

/** Puts the member's equipped Souk theme on the whole app when they sign in, and takes it off when they leave. */
export function ThemeApplier() {
  const { session } = useAuth()
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) { applyTheme(null); return }
    let alive = true
    Promise.resolve().then(() => myEquippedTheme(userId)).then((d) => { if (alive) applyTheme(d ?? null) }).catch(() => undefined)
    return () => { alive = false }
  }, [userId])
  return null
}
