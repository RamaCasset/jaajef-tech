import { useCallback, useEffect, useState } from 'react'
import { answerCollabInvite, listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationRow } from './api'
import { fr } from '../i18n/fr'
import { friendlyError } from './errors'

/** The notifications of the signed-in member, with the actions that can be done on them (shared by the bell and the inbox page). */
export function useNotifications(limit: number, enabled = true) {
  const [items, setItems] = useState<NotificationRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Record<string, boolean | null>>({})

  const load = useCallback(() => {
    setFailed(false)
    listNotifications(limit).then(setItems).catch(() => setFailed(true))
  }, [limit])
  useEffect(() => { if (enabled) load() }, [enabled, load])

  const open = useCallback(async (n: NotificationRow) => {
    if (n.read_at) return
    setItems((cur) => cur && cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
    try { await markNotificationRead(n.id) } catch { load() }
  }, [load])

  const readAll = useCallback(async () => {
    setItems((cur) => cur && cur.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    try { await markAllNotificationsRead() } catch { load() }
  }, [load])

  const answer = useCallback(async (n: NotificationRow, invite: string, accept: boolean) => {
    setError(null)
    try {
      await answerCollabInvite(invite, accept)
      setAnswered((a) => ({ ...a, [invite]: accept }))
      void open(n)
    } catch (err) {
      const text = friendlyError(err)
      if (text === fr.errors.inviteGone || text === fr.errors.inviteExpired) {
        setAnswered((a) => ({ ...a, [invite]: null }))
        void open(n)
      } else setError(text)
    }
  }, [open])

  const unread = items ? items.filter((n) => !n.read_at).length : 0
  return { items, failed, error, answered, unread, load, open, readAll, answer }
}
