import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  getJobEmailSetting, getSignInMethods, listBlockedMembers, setJobEmailSetting, unblockUser,
  type BlockedMember,
} from '../lib/api'

export function PasswordSection() {
  const t = fr.settings
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (password.length < 8) { setError(fr.errors.weakPassword); return }
    if (password !== confirm) { setError(t.passwordMismatch); return }
    setBusy(true)
    try {
      await updatePassword(password)
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h2>{t.passwordTitle}</h2>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="alert" role="alert">{error}</div>}
        {done && <div className="notice" role="status">{t.passwordDone}</div>}
        <div className="field">
          <label htmlFor="pw-new">{t.passwordNew}</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">{t.passwordConfirm}</label>
          <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={busy || !password}>{t.passwordButton}</button>
      </form>
    </section>
  )
}

export function BlockedSection() {
  const t = fr.settings
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [list, setList] = useState<BlockedMember[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    listBlockedMembers(me).then(setList).catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function unblock(m: BlockedMember) {
    setError(null)
    setNotice(null)
    try {
      await unblockUser(m.id)
      setNotice(t.unblocked)
      load()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h2>{t.blockedTitle}</h2>
      {failed && <p className="muted">{t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button></p>}
      {!failed && !list && <p className="muted">{fr.common.loading}</p>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {list && list.length === 0 && <p className="muted">{t.blockedNone}</p>}
      {list && list.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {list.map((m) => (
            <li key={m.id} style={{ padding: '6px 0' }}>
              {m.display_name} <span className="muted">@{m.username}</span>{' '}
              <button type="button" className="btn" aria-label={`${t.unblock} : ${m.display_name}`} onClick={() => void unblock(m)}>{t.unblock}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function EmailSection() {
  const t = fr.settings
  const [on, setOn] = useState<boolean | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    getJobEmailSetting().then(setOn).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  async function change(next: boolean) {
    setError(null)
    setNotice(null)
    const before = on
    setOn(next)
    try {
      await setJobEmailSetting(next)
      setNotice(t.jobEmailSaved)
    } catch (err) {
      setOn(before)
      setError(friendlyError(err))
    }
  }

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h2>{t.emailTitle}</h2>
      {failed && <p className="muted">{t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button></p>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {on !== null && (
        <p><label><input type="checkbox" checked={on} onChange={(e) => void change(e.target.checked)} /> {t.jobEmail}</label></p>
      )}
      <p><Link to="/notifications">{t.notificationsLink}</Link></p>
    </section>
  )
}

export function SignInSection() {
  const t = fr.settings
  const [info, setInfo] = useState<{ email: string | null; github: boolean } | null>(null)
  useEffect(() => { getSignInMethods().then(setInfo).catch(() => setInfo(null)) }, [])
  if (!info) return null
  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h2>{t.signInTitle}</h2>
      {info.email && <p>{t.signInEmail(info.email)}</p>}
      <p>{info.github ? t.signInGithub : t.signInNoGithub}</p>
    </section>
  )
}
