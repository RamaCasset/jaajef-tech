import { SiteFooter } from '../components/SiteFooter'
import { Link } from 'react-router-dom'
import { CornerArt } from '../components/CornerArt'
import mascot from '../assets/landing/splash-mascot.webp'
import { fr } from '../i18n/fr'

/** The first screen for visitors: mascot, name, tagline, then sign up / sign in. */
export function Splash() {
  const t = fr.splash
  return (
    <main className="splash">
      <CornerArt />
      <Link to="/a-propos" className="splash-about">{t.about}</Link>
      <img className="splash-mascot" src={mascot} alt="" />
      <h1 className="splash-name">jaajef<span>.tech</span></h1>
      <p className="splash-tagline">{t.tagline}</p>
      <div className="splash-actions">
        <Link className="btn btn-cta" to="/inscription">{t.signUp}</Link>
        <Link className="btn" to="/connexion">{t.signIn}</Link>
      </div>
      <SiteFooter />
    </main>
  )
}
