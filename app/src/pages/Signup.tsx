import { CornerArt } from '../components/CornerArt'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { GithubButton } from '../components/GithubButton'
import { Logo } from '../components/Logo'
import { Stepper } from '../components/Stepper'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'

export function Signup() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError(fr.errors.weakPassword); return }
    setBusy(true)
    try {
      const result = await signUp(email.trim(), password)
      if (result === 'signed_in') navigate('/inscription/clan', { replace: true })
      else setNotice(fr.signup.checkEmail)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page" style={{ alignContent: 'start' }}>
      <CornerArt />
      <header style={{ width: 'min(100%, 900px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <Logo />
        <span className="muted">{fr.signup.haveAccount} <Link to="/connexion">{fr.signup.signIn}</Link></span>
      </header>
      <Stepper steps={[fr.steps.identity, fr.steps.clan, fr.steps.enter]} current={0} />
      <form className="panel auth-card" onSubmit={onSubmit} noValidate>
        <p className="eyebrow">{fr.signup.eyebrow}</p>
        <h1>{fr.signup.title}</h1>
        <p className="muted" style={{ marginBottom: 24 }}>{fr.signup.subtitle}</p>

        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        <div className="field">
          <label htmlFor="email">{fr.signup.email}</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">{fr.signup.password}</label>
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <span className="hint">{fr.signup.passwordHint}</span>
        </div>
        <button className="btn btn-cta" type="submit" disabled={busy || !email || !password} style={{ width: '100%' }}>
          {fr.signup.submit} →
        </button>
        <GithubButton label={fr.signup.github} onError={setError} />
        <p className="tiny muted" style={{ marginTop: 12 }}>
          {fr.signup.agreeBefore}<Link to="/conditions">{fr.signup.terms}</Link>{fr.signup.agreeMiddle}<Link to="/confidentialite">{fr.signup.privacy}</Link>{fr.signup.agreeAfter}
        </p>
      </form>
    </main>
  )
}
