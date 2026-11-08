import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { loadMyProfileFields, removeProfileImage, updateMyProfile, uploadProfileImage, type ProfileImageKind } from '../lib/api'

export function EditProfile() {
  const { member, refreshMember } = useAuth()
  const me = member?.profile.id ?? ''
  const username = member?.profile.username ?? ''
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [headline, setHeadline] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMsg, setImageMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    loadMyProfileFields(me)
      .then((p) => { setDisplayName(p.display_name); setHeadline(p.headline); setAvatarUrl(p.avatar_url); setCoverUrl(p.banner_url); setBio(p.bio); setLocation(p.location); setAvailable(p.available_to_collab); setLoaded(true) })
      .catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await updateMyProfile(me, { display_name: displayName, headline, bio, location, available_to_collab: available })
      setSaved(true)
      await refreshMember()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function changeImage(kind: ProfileImageKind, file: File | undefined) {
    if (!file) return
    setImageMsg(null)
    setImageBusy(true)
    try {
      const url = await uploadProfileImage(me, kind, file, kind === 'avatar' ? avatarUrl : coverUrl)
      if (kind === 'avatar') setAvatarUrl(url); else setCoverUrl(url)
      setImageMsg({ ok: true, text: fr.editProfile.imageSaved })
      await refreshMember()
    } catch (err) {
      const m = err instanceof Error ? err.message : ''
      setImageMsg({ ok: false, text: m === 'image-type' ? fr.editProfile.imageType : m === 'image-size' ? fr.editProfile.imageSize : friendlyError(err) })
    } finally {
      setImageBusy(false)
    }
  }

  async function dropImage(kind: ProfileImageKind) {
    setImageMsg(null)
    setImageBusy(true)
    try {
      await removeProfileImage(me, kind, kind === 'avatar' ? avatarUrl : coverUrl)
      if (kind === 'avatar') setAvatarUrl(null); else setCoverUrl(null)
      setImageMsg({ ok: true, text: fr.editProfile.imageSaved })
      await refreshMember()
    } catch (err) {
      setImageMsg({ ok: false, text: friendlyError(err) })
    } finally {
      setImageBusy(false)
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
          <form className="panel panel-pad" onSubmit={onSubmit} noValidate>
            {error && <div className="alert" role="alert">{error}</div>}
            {saved && <div className="notice" role="status">{fr.editProfile.saved} <Link to={`/profil/${username}`}>{fr.editProfile.seeProfile}</Link></div>}
            <div className="picture-edit">
              <div className="profile-avatar picture-avatar" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : displayName.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="picture-label">{fr.editProfile.avatar}</p>
                <div className="picture-actions">
                  <label className="btn">
                    {fr.editProfile.changeImage}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={fr.editProfile.avatar} disabled={imageBusy} onChange={(e) => { void changeImage('avatar', e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  {avatarUrl && <button type="button" className="btn" disabled={imageBusy} onClick={() => void dropImage('avatar')}>{fr.editProfile.removeImage}</button>}
                </div>
                <span className="hint">{fr.editProfile.imageHint}</span>
              </div>
            </div>
            <div className="picture-edit picture-edit-cover">
              <div className="picture-cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined} aria-hidden="true" />
              <div>
                <p className="picture-label">{fr.editProfile.cover}</p>
                <div className="picture-actions">
                  <label className="btn">
                    {fr.editProfile.changeImage}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={fr.editProfile.cover} disabled={imageBusy} onChange={(e) => { void changeImage('cover', e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  {coverUrl && <button type="button" className="btn" disabled={imageBusy} onClick={() => void dropImage('cover')}>{fr.editProfile.removeImage}</button>}
                </div>
                <span className="hint">{fr.editProfile.imageHint}</span>
              </div>
            </div>
            {imageMsg && <div className={imageMsg.ok ? 'notice' : 'alert'} role={imageMsg.ok ? 'status' : 'alert'}>{imageMsg.text}</div>}
            <div className="field">
              <label htmlFor="e-name">{fr.editProfile.displayName}</label>
              <input id="e-name" maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="e-head">{fr.editProfile.headline}</label>
              <input id="e-head" maxLength={80} value={headline} onChange={(e) => setHeadline(e.target.value)} />
              <span className="hint">{fr.editProfile.headlineHint}</span>
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
