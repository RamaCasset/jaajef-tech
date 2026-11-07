import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { isConfigured } from './lib/supabase'
import { fr } from './i18n/fr'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { ChooseClan } from './pages/ChooseClan'
import { Home } from './pages/Home'
import { Quests } from './pages/Quests'
import { Quest } from './pages/Quest'
import { Projects } from './pages/Projects'
import { ImportProject } from './pages/ImportProject'
import { Jobs } from './pages/Jobs'
import { JobDetail } from './pages/JobDetail'
import { ApplicationFile } from './pages/ApplicationFile'
import { Profile } from './pages/Profile'
import { Souk } from './pages/Souk'
import { Staff } from './pages/Staff'
import { StaffReports } from './pages/StaffReports'
import { StaffReview } from './pages/StaffReview'
import { Messages } from './pages/Messages'
import { Conversation } from './pages/Conversation'
import { Communities } from './pages/Communities'
import { Community } from './pages/Community'
import { Notifications } from './pages/Notifications'
import { Settings } from './pages/Settings'
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
      <Route path="/mot-de-passe-oublie" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/nouveau-mot-de-passe" element={<ResetPassword />} />
      <Route path="/inscription" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route path="/inscription/clan" element={<RequireAuth><ChooseClan /></RequireAuth>} />
      <Route path="/cite" element={<RequireAuth><RequireCharacter><Home /></RequireCharacter></RequireAuth>} />
      <Route path="/quetes" element={<RequireAuth><RequireCharacter><Quests /></RequireCharacter></RequireAuth>} />
      <Route path="/quetes/:slug" element={<RequireAuth><RequireCharacter><Quest /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/ajouter" element={<RequireAuth><RequireCharacter><ImportProject /></RequireCharacter></RequireAuth>} />
      <Route path="/projets" element={<RequireAuth><RequireCharacter><Projects /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe" element={<RequireAuth><RequireCharacter><Staff /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/signalements" element={<RequireAuth><RequireCharacter><StaffReports /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/validation" element={<RequireAuth><RequireCharacter><StaffReview /></RequireCharacter></RequireAuth>} />
      <Route path="/messages" element={<RequireAuth><RequireCharacter><Messages /></RequireCharacter></RequireAuth>} />
      <Route path="/messages/:id" element={<RequireAuth><RequireCharacter><Conversation /></RequireCharacter></RequireAuth>} />
      <Route path="/communautes" element={<RequireAuth><RequireCharacter><Communities /></RequireCharacter></RequireAuth>} />
      <Route path="/communautes/:slug" element={<RequireAuth><RequireCharacter><Community /></RequireCharacter></RequireAuth>} />
      <Route path="/jobs/:id" element={<RequireAuth><RequireCharacter><JobDetail /></RequireCharacter></RequireAuth>} />
      <Route path="/dossier" element={<RequireAuth><RequireCharacter><ApplicationFile /></RequireCharacter></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><RequireCharacter><Notifications /></RequireCharacter></RequireAuth>} />
      <Route path="/parametres" element={<RequireAuth><RequireCharacter><Settings /></RequireCharacter></RequireAuth>} />
      <Route path="/souk" element={<RequireAuth><RequireCharacter><Souk /></RequireCharacter></RequireAuth>} />
      <Route path="/profil/:username" element={<RequireAuth><RequireCharacter><Profile /></RequireCharacter></RequireAuth>} />
      <Route path="/jobs" element={<RequireAuth><RequireCharacter><Jobs /></RequireCharacter></RequireAuth>} />
      <Route path="*" element={<Navigate to="/cite" replace />} />
    </Routes>
  )
}
