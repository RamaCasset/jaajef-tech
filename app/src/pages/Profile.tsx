import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { ProfileView } from '../components/ProfileView'
import { loadProfile, type ProfileData } from '../lib/api'
import { fr } from '../i18n/fr'

export function Profile() {
  const { username = '' } = useParams()
  const { session } = useAuth()
  const viewerId = session?.user.id ?? ''
  const [data, setData] = useState<ProfileData | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    let alive = true
    setData(undefined)
    setFailed(false)
    loadProfile(username, viewerId).then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [username, viewerId])

  useEffect(() => load(), [load])

  return (
    <AppShell>
      <main className="page profile">
        {failed ? (
          <div className="alert" role="alert">
            {fr.profile.error} <button type="button" className="btn" onClick={() => load()}>{fr.profile.retry}</button>
          </div>
        ) : data === undefined ? (
          <p className="muted">{fr.common.loading}</p>
        ) : data === null ? (
          <p role="status">{fr.profile.notFound}</p>
        ) : (
          <ProfileView data={data} viewerId={viewerId} />
        )}
      </main>
    </AppShell>
  )
}
