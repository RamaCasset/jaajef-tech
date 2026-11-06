import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { SoukCard } from '../components/SoukCard'
import { useAuth } from '../auth/AuthContext'
import { buyItem, equipItem, myEquippedIds, soukShop, unequipItem, type SoukItem, type SoukKind, type SoukSort } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

const KINDS: SoukKind[] = ['theme', 'avatar_frame', 'status_badge']
const SORTS: SoukSort[] = ['new', 'rating', 'price_asc', 'price_desc']

export function Souk() {
  const { session, refreshMember } = useAuth()
  const userId = session?.user.id ?? ''
  const [kind, setKind] = useState<SoukKind>('theme')
  const [sort, setSort] = useState<SoukSort>('new')
  const [items, setItems] = useState<SoukItem[] | null>(null)
  const [worn, setWorn] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)

  const load = useCallback(async () => {
    const [list, ids] = await Promise.all([soukShop(kind, sort), myEquippedIds(userId)])
    setItems(list)
    setWorn(ids)
  }, [kind, sort, userId])

  useEffect(() => {
    let alive = true
    setItems(null)
    setFailed(false)
    load().catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [load])

  async function act(item: SoukItem, action: () => Promise<void>, okText?: string) {
    setBusyId(item.id)
    setNotice(null)
    try {
      await action()
      await load()
      if (okText) await refreshMember()
      if (okText) setNotice({ text: okText, bad: false })
    } catch (e) {
      setNotice({ text: friendlyError(e), bad: true })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <p className="eyebrow">{fr.souk.eyebrow}</p>
          <h1 className="page-title">{fr.souk.title}</h1>
          <p className="muted">{fr.souk.subtitle}</p>
        </header>

        <div className="souk-bar">
          <div role="tablist" aria-label={fr.souk.title} className="souk-tabs">
            {KINDS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={`pill ${kind === k ? 'pill-on' : ''}`} onClick={() => setKind(k)}>{fr.souk.kinds[k]}</button>
            ))}
          </div>
          <label className="souk-sort">
            <span className="muted">{fr.souk.sort}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SoukSort)}>
              {SORTS.map((s) => <option key={s} value={s}>{fr.souk.sorts[s]}</option>)}
            </select>
          </label>
        </div>

        {notice ? <p role={notice.bad ? 'alert' : 'status'} className={notice.bad ? "alert" : "notice"}>{notice.text}</p> : null}

        {failed ? (
          <div role="alert" className="alert">
            <p>{fr.souk.error}</p>
            <button type="button" className="btn" onClick={() => { setFailed(false); setItems(null); load().catch(() => setFailed(true)) }}>{fr.souk.retry}</button>
          </div>
        ) : items === null ? (
          <p className="muted">{fr.common.loading}</p>
        ) : items.length === 0 ? (
          <p className="muted">{fr.souk.empty}</p>
        ) : (
          <>
            <p className="muted souk-count">{fr.souk.count(items.length)}</p>
            <div className="souk-grid">
              {items.map((item) => (
                <SoukCard
                  key={item.id}
                  item={item}
                  worn={worn.includes(item.id)}
                  busy={busyId === item.id}
                  onBuy={() => void act(item, () => buyItem(item.id), fr.souk.bought(item.name))}
                  onEquip={() => void act(item, () => equipItem(item.id))}
                  onUnequip={() => void act(item, () => unequipItem(item.kind))}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}
