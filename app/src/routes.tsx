import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { isConfigured } from './lib/supabase'
import { fr } from './i18n/fr'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { ChooseClan } from './pages/ChooseClan'
import { Home } from './pages/Home'
import { Projects } from './pages/Projects'
import { Profile } from './pages/Profile'
import { Souk } from './pages/Souk'
import { Setup } from './pages/Setup'

function Loading() {
  return <main className="center-page"><p className="muted">{fr.common.loading}</p></main>
}

/** Signed-out visitors go to the sign-in page. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/connexion" replace />
  return <>{children}</>
}

/** Members who have not chosen a character yet are sent to choose one. */
function RequireCharacter({ children }: { children: ReactNode }) {
  const { member } = useAuth()
  if (!member) return <Loading />
  if (!member.profile.clan || !member.profile.mastery) return <Navigate to="/inscription/clan" replace />
  return <>{children}</>
}

/** Signed-in members do not need the sign-in or sign-up pages. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  if (loading) return <Loading />
  if (session) return <Navigate to="/cite" replace />
  return <>{children}</>
}

export function AppRoutes() {
  if (!isConfigured) return <Setup />
  return (
    <Routes>
      <Route path="/connexion" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/inscription" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route path="/inscription/clan" element={<RequireAuth><ChooseClan /></RequireAuth>} />
      <Route path="/cite" element={<RequireAuth><RequireCharacter><Home /></RequireCharacter></RequireAuth>} />
      <Route path="/projets" element={<RequireAuth><RequireCharacter><Projects /></RequireCharacter></RequireAuth>} />
      <Route path="/souk" element={<RequireAuth><RequireCharacter><Souk /></RequireCharacter></RequireAuth>} />
      <Route path="/profil/:username" element={<RequireAuth><RequireCharacter><Profile /></RequireCharacter></RequireAuth>} />
      <Route path="*" element={<Navigate to="/cite" replace />} />
    </Routes>
  )
}
