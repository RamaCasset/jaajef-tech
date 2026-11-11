import { Link } from 'react-router-dom'
import { CornerArt } from '../components/CornerArt'
import { Logo } from '../components/Logo'
import communities from '../assets/landing/communaute.webp'
import projects from '../assets/landing/projets.webp'
import quests from '../assets/landing/quetes.webp'
import jobs from '../assets/landing/jobs.webp'
import { fr } from '../i18n/fr'

/** The "À propos" page: what jaajef.tech is, then a way to sign up. */
export function About() {
  const t = fr.about
  const tiles = [
    { img: communities, text: t.tiles.communities },
    { img: projects, text: t.tiles.projects },
    { img: quests, text: t.tiles.quests },
    { img: jobs, text: t.tiles.jobs },
  ]
  return (
    <main className="about">
      <CornerArt />
      <header className="about-top"><Link to="/" aria-label={t.home}><Logo size={18} /></Link></header>
      <section className="about-intro">
        <h1>{t.title}</h1>
        <p>{t.p1}</p>
        <p>{t.p2}</p>
      </section>
      <section className="about-cultures panel">
        <h2>{t.culturesTitle}</h2>
        <p>{t.cultures}</p>
      </section>
      <ul className="about-tiles">
        {tiles.map((x) => (
          <li key={x.text} className="panel about-tile">
            <img src={x.img} alt="" />
            <p>{x.text}</p>
          </li>
        ))}
      </ul>
      <section className="about-ready">
        <p>{t.ready}</p>
        <Link className="btn btn-cta" to="/inscription">{t.signUp}</Link>
      </section>
      <p className="tiny muted about-legal">
        <Link to="/conditions">{t.terms}</Link> · <Link to="/confidentialite">{t.privacy}</Link> · <Link to="/regles">{t.rules}</Link> · <Link to="/regles-offres">{t.jobRules}</Link>
      </p>
    </main>
  )
}
