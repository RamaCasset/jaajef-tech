import { CornerArt } from '../components/CornerArt'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      navigate('/projets', { replace: true })
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
        <p className="eyebrow" style={{ marginTop: 28 }}>{fr.login.eyebrow}</p>
        <h1>{fr.login.title}</h1>
        <p className="muted" style={{ marginBottom: 24 }}>{fr.login.subtitle}</p>

        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        <div className="field">
          <label htmlFor="email">{fr.login.email}</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="password">{fr.login.password}</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <p style={{ textAlign: 'right', margin: '0 0 20px', fontSize: 13 }}>
          <Link to="/mot-de-passe-oublie">{fr.login.forgot}</Link>
        </p>

        <button className="btn btn-cta" type="submit" disabled={busy || !email || !password} style={{ width: '100%' }}>
          {fr.login.submit} →
        </button>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '24px 0 16px' }} />
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          {fr.login.noAccount} <Link to="/inscription">{fr.login.signUp}</Link>
        </p>
      </form>
    </main>
  )
}
