import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { myEquippedTheme } from '../lib/api'
import { applyTheme } from '../lib/theme'

/** Puts the member's equipped Souk theme on the whole app when they sign in, and takes it off when they leave. */
export function ThemeApplier() {
  const { session, loading } = useAuth()
  const userId = session?.user.id
  useEffect(() => {
    // While the sign-in is still being read (a page refresh), keep the remembered theme: do not flash the default look.
    if (loading) return
    if (!userId) { applyTheme(null); return }
    let alive = true
    Promise.resolve().then(() => myEquippedTheme(userId)).then((d) => { if (alive) applyTheme(d ?? null) }).catch(() => undefined)
    return () => { alive = false }
  }, [userId, loading])
  return null
}
