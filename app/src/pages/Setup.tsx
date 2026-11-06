import { fr } from '../i18n/fr'

export function Setup() {
  return (
    <main className="center-page">
      <section className="panel auth-card">
        <h1>{fr.setup.title}</h1>
        <p className="muted">{fr.setup.body}</p>
      </section>
    </main>
  )
}
