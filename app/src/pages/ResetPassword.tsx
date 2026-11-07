import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'

/** Opened from the link in the reset e-mail. The link signs the member in for a short while; this page then sets the new password. */
export function ResetPassword() {
  const { loading, session, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError(fr.errors.weakPassword); return }
    if (password !== confirm) { setError(fr.resetPassword.mismatch); return }
    setBusy(true)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="center-page"><p className="muted">{fr.common.loading}</p></main>

  if (!session) {
    return (
      <main className="center-page">
        <div className="panel auth-card">
          <Logo />
          <h1 style={{ marginTop: 28 }}>{fr.resetPassword.expiredTitle}</h1>
          <p className="muted" style={{ marginBottom: 24 }}>{fr.resetPassword.expired}</p>
          <Link className="btn btn-cta" to="/mot-de-passe-oublie" style={{ display: 'block', textAlign: 'center' }}>{fr.resetPassword.askAgain}</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="center-page">
      <form className="panel auth-card" onSubmit={onSubmit} noValidate>
        <Logo />
        <p className="eyebrow" style={{ marginTop: 28 }}>{fr.resetPassword.eyebrow}</p>
        <h1>{fr.resetPassword.title}</h1>

        {error && <div className="alert" role="alert">{error}</div>}
        {done ? (
          <>
            <div className="notice" role="status">{fr.resetPassword.done}</div>
            <button className="btn btn-cta" type="button" onClick={() => navigate('/cite', { replace: true })} style={{ width: '100%' }}>
              {fr.resetPassword.continue} →
            </button>
          </>
        ) : (
          <>
            <div className="field" style={{ marginTop: 24 }}>
              <label htmlFor="password">{fr.resetPassword.password}</label>
              <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <span className="hint">{fr.resetPassword.hint}</span>
            </div>
            <div className="field">
              <label htmlFor="confirm">{fr.resetPassword.confirm}</label>
              <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <button className="btn btn-cta" type="submit" disabled={busy || !password || !confirm} style={{ width: '100%' }}>
              {fr.resetPassword.submit} →
            </button>
          </>
        )}
      </form>
    </main>
  )
}
