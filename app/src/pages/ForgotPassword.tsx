import { CornerArt } from '../components/CornerArt'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'

export function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await requestPasswordReset(email.trim())
      // Same message whether or not an account exists, so nobody can use this page to find out who is a member.
      setSent(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page">
      <CornerArt />
      <form className="panel auth-card" onSubmit={onSubmit} noValidate>
        <Logo />
        <p className="eyebrow" style={{ marginTop: 28 }}>{fr.forgotPassword.eyebrow}</p>
        <h1>{fr.forgotPassword.title}</h1>
        <p className="muted" style={{ marginBottom: 24 }}>{fr.forgotPassword.subtitle}</p>

        {error && <div className="alert" role="alert">{error}</div>}
        {sent && <div className="notice" role="status">{fr.forgotPassword.sent}</div>}

        {!sent && (
          <>
            <div className="field">
              <label htmlFor="email">{fr.forgotPassword.email}</label>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn btn-cta" type="submit" disabled={busy || !email} style={{ width: '100%' }}>
              {fr.forgotPassword.submit} →
            </button>
          </>
        )}
        <p className="muted" style={{ textAlign: 'center', margin: '24px 0 0' }}>
          <Link to="/connexion">{fr.forgotPassword.backToLogin}</Link>
        </p>
      </form>
    </main>
  )
}
