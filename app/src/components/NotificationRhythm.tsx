import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'
import { listMutedKinds, setNotificationMute, type NotificationKind } from '../lib/api'
import { RHYTHM_GROUPS } from '../lib/notificationMeta'

const LABEL = { mentions: 'rhythmMentions', projects: 'rhythmProjects', quests: 'rhythmQuests' } as const

/** "À votre rythme": three switches, each one turning a group of notice kinds on or off. */
export function NotificationRhythm() {
  const t = fr.notifications
  const [muted, setMuted] = useState<NotificationKind[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { Promise.resolve().then(() => listMutedKinds()).then((m) => setMuted(Array.isArray(m) ? m : [])).catch(() => undefined) }, [])

  async function toggle(kinds: NotificationKind[], receive: boolean) {
    setError(null)
    const before = muted
    setMuted(receive ? muted.filter((k) => !kinds.includes(k)) : Array.from(new Set([...muted, ...kinds])))
    try {
      for (const k of kinds) await setNotificationMute(k, !receive)
    } catch {
      setMuted(before)
      setError(t.muteFailed)
    }
  }

  return (
    <section className="panel side-card rhythm" aria-label={t.rhythm}>
      <h2 className="side-title">{t.rhythm}</h2>
      <p className="muted tiny">{t.rhythmText}</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {RHYTHM_GROUPS.map((g) => {
        const on = g.kinds.every((k) => !muted.includes(k))
        return (
          <label key={g.key} className="switch-row">
            <span>{t[LABEL[g.key]]}</span>
            <input type="checkbox" role="switch" checked={on} onChange={(e) => void toggle(g.kinds, e.target.checked)} />
          </label>
        )
      })}
      <Link className="btn" to="/parametres#notifications">{t.managePrefs}</Link>
    </section>
  )
}
