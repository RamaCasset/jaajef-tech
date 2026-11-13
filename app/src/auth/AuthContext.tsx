import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { loadMember, type MemberState } from '../lib/api'

type SignUpResult = 'signed_in' | 'confirm_email'

type AuthState = {
  loading: boolean
  session: Session | null
  member: MemberState | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, profile?: { fullName: string; username: string }) => Promise<SignUpResult>
  signInWithGithub: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  signOut: () => Promise<void>
  refreshMember: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [member, setMember] = useState<MemberState | null>(null)

  const refreshFor = useCallback(async (s: Session | null) => {
    if (!s) { setMember(null); return }
    try { setMember(await loadMember(s.user.id)) } catch { setMember(null) }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await refreshFor(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Defer, so the sign-in call that triggered this has finished before we query.
      setTimeout(() => { void refreshFor(s) }, 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [refreshFor])

  const value = useMemo<AuthState>(() => ({
    loading,
    session,
    member,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
    },
    async signUp(email, password, profile) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/connexion`,
          ...(profile ? { data: { full_name: profile.fullName, username: profile.username } } : {}),
        },
      })
      if (error) throw new Error(error.message)
      return data.session ? 'signed_in' : 'confirm_email'
    },
    async signInWithGithub() {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${window.location.origin}/la-cite` } })
      if (error) throw new Error(error.message)
    },
    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/la-cite` } })
      if (error) throw new Error(error.message)
    },
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/nouveau-mot-de-passe` })
      if (error) throw new Error(error.message)
    },
    async updatePassword(newPassword) {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw new Error(error.message)
    },
    async signOut() { await supabase.auth.signOut() },
    async refreshMember() { await refreshFor(session) },
  }), [loading, session, member, refreshFor])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
