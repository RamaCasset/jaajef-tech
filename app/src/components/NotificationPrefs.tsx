import { useEffect, useState } from 'react'
import { fr } from '../i18n/fr'
import { listMutedKinds, setNotificationMute, type NotificationKind } from '../lib/api'

const KINDS = Object.keys(fr.notifications.kinds) as NotificationKind[]
const LOCKED: NotificationKind[] = ['warning', 'suspension', 'project_hidden']

/** "Choisir ce que je reçois": which kinds of notice the member wants. Lives in the settings. */
export function NotificationPrefs() {
  const [muted, setMuted] = useState<NotificationKind[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { listMutedKinds().then(setMuted).catch(() => undefined) }, [])

  async function toggle(kind: NotificationKind, receive: boolean) {
    setError(null)
    const before = muted
    setMuted(receive ? muted.filter((k) => k !== kind) : [...muted, kind])
    try {
      await setNotificationMute(kind, !receive)
    } catch {
      setMuted(before)
      setError(fr.notifications.muteFailed)
    }
  }

  return (
    <section className="panel panel-pad" style={{ marginBottom: 24 }}>
      <h2>{fr.notifications.settingsTitle}</h2>
      <p className="muted tiny">{fr.notifications.settingsHint}</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {KINDS.map((k) => {
        const locked = LOCKED.includes(k)
        return (
          <label key={k} style={{ display: 'block', padding: '4px 0' }}>
            <input type="checkbox" checked={locked || !muted.includes(k)} disabled={locked} onChange={(e) => void toggle(k, e.target.checked)} />{' '}
            {fr.notifications.kinds[k]}{locked ? ` (${fr.notifications.locked})` : ''}
          </label>
        )
      })}
    </section>
  )
}
