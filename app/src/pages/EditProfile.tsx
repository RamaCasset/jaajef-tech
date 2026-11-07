import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { loadMyProfileFields, updateMyProfile } from '../lib/api'

export function EditProfile() {
  const { member, refreshMember } = useAuth()
  const me = member?.profile.id ?? ''
  const username = member?.profile.username ?? ''
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    loadMyProfileFields(me)
      .then((p) => { setDisplayName(p.display_name); setBio(p.bio); setLocation(p.location); setAvailable(p.available_to_collab); setLoaded(true) })
      .catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await updateMyProfile(me, { display_name: displayName, bio, location, available_to_collab: available })
      setSaved(true)
      await refreshMember()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.editProfile.title}</h1>
          <p className="muted">{fr.editProfile.subtitle}</p>
        </header>
        {failed && (
          <div className="alert" role="alert">
            {fr.editProfile.loadFailed} <button type="button" className="btn" onClick={load}>{fr.editProfile.retry}</button>
          </div>
        )}
        {!failed && !loaded && <p className="muted">{fr.common.loading}</p>}
        {loaded && (
          <form className="panel" onSubmit={onSubmit} noValidate>
            {error && <div className="alert" role="alert">{error}</div>}
            {saved && <div className="notice" role="status">{fr.editProfile.saved} <Link to={`/profil/${username}`}>{fr.editProfile.seeProfile}</Link></div>}
            <div className="field">
              <label htmlFor="e-name">{fr.editProfile.displayName}</label>
              <input id="e-name" maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="e-bio">{fr.editProfile.bio}</label>
              <textarea id="e-bio" rows={4} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} />
              <span className="hint">{fr.editProfile.bioHint}</span>
            </div>
            <div className="field">
              <label htmlFor="e-loc">{fr.editProfile.location}</label>
              <input id="e-loc" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} /> {fr.editProfile.available}
            </label>
            <button className="btn btn-cta" type="submit" disabled={busy || !displayName.trim()}>{fr.editProfile.save}</button>
          </form>
        )}
      </main>
    </AppShell>
  )
}
