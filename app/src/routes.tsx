import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './auth/AuthContext'
import { isConfigured } from './lib/supabase'
import { fr } from './i18n/fr'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Splash } from './pages/Splash'
import { About } from './pages/About'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { ChooseClan } from './pages/ChooseClan'
import { Home } from './pages/Home'
import { LaCite } from './pages/LaCite'
import { Quests } from './pages/Quests'
import { QuestNotebook } from './pages/QuestNotebook'
import { Quest } from './pages/Quest'
import { LearningPaths } from './pages/LearningPaths'
import { LearningPath } from './pages/LearningPath'
import { Projects } from './pages/Projects'
import { MyRepos } from './pages/MyRepos'
import { MyStars } from './pages/MyStars'
import { ProjectPage } from './pages/ProjectPage'
import { ImportProject } from './pages/ImportProject'
import { Jobs } from './pages/Jobs'
import { JobDetail } from './pages/JobDetail'
import { ApplicationFile } from './pages/ApplicationFile'
import { Guide } from './pages/Guide'
import { Employer } from './pages/Employer'
import { OfferForm } from './pages/OfferForm'
import { OfferApplicants } from './pages/OfferApplicants'
import { Talents } from './pages/Talents'
import { TalentProfile } from './pages/TalentProfile'
import { CvPortfolio } from './pages/CvPortfolio'
import { RepoHistory } from './pages/RepoHistory'
import { RepoProposals } from './pages/RepoProposals'
import { RepoBrowser } from './pages/RepoBrowser'
import { Profile } from './pages/Profile'
import { Souk } from './pages/Souk'
import { Staff } from './pages/Staff'
import { StaffReports } from './pages/StaffReports'
import { StaffReview } from './pages/StaffReview'
import { StaffTeam } from './pages/StaffTeam'
import { StaffSouk } from './pages/StaffSouk'
import { SoukSell } from './pages/SoukSell'
import { EditProfile } from './pages/EditProfile'
import { Search } from './pages/Search'
import { Blog } from './pages/Blog'
import { Questions } from './pages/Questions'
import { AskQuestion } from './pages/AskQuestion'
import { QuestionPage } from './pages/QuestionPage'
import { BlogPost } from './pages/BlogPost'
import { BlogEditor } from './pages/BlogEditor'
import { BlogMine } from './pages/BlogMine'
import { Messages } from './pages/Messages'
import { Conversation } from './pages/Conversation'
import { Communities } from './pages/Communities'
import { Community } from './pages/Community'
import { Notifications } from './pages/Notifications'
import { Settings } from './pages/Settings'
import { SettingsHub } from './pages/SettingsHub'
import { LanguageSettings } from './pages/LanguageSettings'
import { BuyKopeks } from './pages/BuyKopeks'
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
  if (session) return <Navigate to="/la-cite" replace />
  return <>{children}</>
}

export function AppRoutes() {
  if (!isConfigured) return <Setup />
  return (
    <Routes>
      <Route path="/" element={<PublicOnly><Splash /></PublicOnly>} />
      <Route path="/a-propos" element={<About />} />
      <Route path="/connexion" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/mot-de-passe-oublie" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/nouveau-mot-de-passe" element={<ResetPassword />} />
      <Route path="/inscription" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route path="/inscription/clan" element={<RequireAuth><ChooseClan /></RequireAuth>} />
      <Route path="/cite" element={<RequireAuth><RequireCharacter><Profile own /></RequireCharacter></RequireAuth>} />
      <Route path="/accueil" element={<RequireAuth><RequireCharacter><Home /></RequireCharacter></RequireAuth>} />
      <Route path="/quetes" element={<RequireAuth><RequireCharacter><Quests /></RequireCharacter></RequireAuth>} />
      <Route path="/quetes/carnet" element={<RequireAuth><RequireCharacter><QuestNotebook /></RequireCharacter></RequireAuth>} />
      <Route path="/parcours" element={<RequireAuth><RequireCharacter><LearningPaths /></RequireCharacter></RequireAuth>} />
      <Route path="/parcours/:slug" element={<RequireAuth><RequireCharacter><LearningPath /></RequireCharacter></RequireAuth>} />
      <Route path="/quetes/:slug" element={<RequireAuth><RequireCharacter><Quest /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/ajouter" element={<RequireAuth><RequireCharacter><ImportProject /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/:id/modifier" element={<RequireAuth><RequireCharacter><RepoBrowser /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/:id/historique" element={<RequireAuth><RequireCharacter><RepoHistory /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/:id/propositions" element={<RequireAuth><RequireCharacter><RepoProposals /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/:id/code" element={<RequireAuth><RequireCharacter><RepoBrowser /></RequireCharacter></RequireAuth>} />
      <Route path="/projets/:id" element={<RequireAuth><RequireCharacter><ProjectPage /></RequireCharacter></RequireAuth>} />
      <Route path="/depots/etoiles" element={<RequireAuth><RequireCharacter><MyStars /></RequireCharacter></RequireAuth>} />
      <Route path="/depots" element={<RequireAuth><RequireCharacter><MyRepos /></RequireCharacter></RequireAuth>} />
      <Route path="/la-cite" element={<RequireAuth><RequireCharacter><LaCite /></RequireCharacter></RequireAuth>} />
      <Route path="/projets" element={<RequireAuth><RequireCharacter><Projects /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe" element={<RequireAuth><RequireCharacter><Staff /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/signalements" element={<RequireAuth><RequireCharacter><StaffReports /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/equipe" element={<RequireAuth><RequireCharacter><StaffTeam /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/souk" element={<RequireAuth><RequireCharacter><StaffSouk /></RequireCharacter></RequireAuth>} />
      <Route path="/equipe/validation" element={<RequireAuth><RequireCharacter><StaffReview /></RequireCharacter></RequireAuth>} />
      <Route path="/souk/vendre" element={<RequireAuth><RequireCharacter><SoukSell /></RequireCharacter></RequireAuth>} />
      <Route path="/parametres/profil" element={<RequireAuth><RequireCharacter><EditProfile /></RequireCharacter></RequireAuth>} />
      <Route path="/recherche" element={<RequireAuth><RequireCharacter><Search /></RequireCharacter></RequireAuth>} />
      <Route path="/questions" element={<RequireAuth><RequireCharacter><Questions /></RequireCharacter></RequireAuth>} />
      <Route path="/questions/poser" element={<RequireAuth><RequireCharacter><AskQuestion /></RequireCharacter></RequireAuth>} />
      <Route path="/questions/:id" element={<RequireAuth><RequireCharacter><QuestionPage /></RequireCharacter></RequireAuth>} />
      <Route path="/blog" element={<RequireAuth><RequireCharacter><Blog /></RequireCharacter></RequireAuth>} />
      <Route path="/blog/ecrire" element={<RequireAuth><RequireCharacter><BlogEditor /></RequireCharacter></RequireAuth>} />
      <Route path="/blog/mes-articles" element={<RequireAuth><RequireCharacter><BlogMine /></RequireCharacter></RequireAuth>} />
      <Route path="/blog/modifier/:id" element={<RequireAuth><RequireCharacter><BlogEditor /></RequireCharacter></RequireAuth>} />
      <Route path="/blog/:slug" element={<RequireAuth><RequireCharacter><BlogPost /></RequireCharacter></RequireAuth>} />
      <Route path="/messages" element={<RequireAuth><RequireCharacter><Messages /></RequireCharacter></RequireAuth>} />
      <Route path="/messages/:id" element={<RequireAuth><RequireCharacter><Conversation /></RequireCharacter></RequireAuth>} />
      <Route path="/communautes" element={<RequireAuth><RequireCharacter><Communities /></RequireCharacter></RequireAuth>} />
      <Route path="/communautes/:slug" element={<RequireAuth><RequireCharacter><Community /></RequireCharacter></RequireAuth>} />
      <Route path="/jobs/:id" element={<RequireAuth><RequireCharacter><JobDetail /></RequireCharacter></RequireAuth>} />
      <Route path="/guide" element={<RequireAuth><RequireCharacter><Guide /></RequireCharacter></RequireAuth>} />
      <Route path="/employeur" element={<RequireAuth><RequireCharacter><Employer /></RequireCharacter></RequireAuth>} />
      <Route path="/employeur/offres/nouvelle" element={<RequireAuth><RequireCharacter><OfferForm /></RequireCharacter></RequireAuth>} />
      <Route path="/employeur/offres/:id" element={<RequireAuth><RequireCharacter><OfferForm /></RequireCharacter></RequireAuth>} />
      <Route path="/employeur/offres/:id/candidatures" element={<RequireAuth><RequireCharacter><OfferApplicants /></RequireCharacter></RequireAuth>} />
      <Route path="/talents" element={<RequireAuth><RequireCharacter><Talents /></RequireCharacter></RequireAuth>} />
      <Route path="/talents/:id" element={<RequireAuth><RequireCharacter><TalentProfile /></RequireCharacter></RequireAuth>} />
      <Route path="/dossier/cv-portfolio" element={<RequireAuth><RequireCharacter><CvPortfolio /></RequireCharacter></RequireAuth>} />
      <Route path="/dossier" element={<RequireAuth><RequireCharacter><ApplicationFile /></RequireCharacter></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><RequireCharacter><Notifications /></RequireCharacter></RequireAuth>} />
      <Route path="/parametres" element={<RequireAuth><RequireCharacter><SettingsHub /></RequireCharacter></RequireAuth>} />
      <Route path="/parametres/compte" element={<RequireAuth><RequireCharacter><Settings /></RequireCharacter></RequireAuth>} />
      <Route path="/parametres/langue" element={<RequireAuth><RequireCharacter><LanguageSettings /></RequireCharacter></RequireAuth>} />
      <Route path="/kopeks" element={<RequireAuth><RequireCharacter><BuyKopeks /></RequireCharacter></RequireAuth>} />
      <Route path="/souk" element={<RequireAuth><RequireCharacter><Souk /></RequireCharacter></RequireAuth>} />
      <Route path="/profil/:username" element={<RequireAuth><RequireCharacter><Profile /></RequireCharacter></RequireAuth>} />
      <Route path="/jobs" element={<RequireAuth><RequireCharacter><Jobs /></RequireCharacter></RequireAuth>} />
      <Route path="*" element={<Navigate to="/la-cite" replace />} />
    </Routes>
  )
}
