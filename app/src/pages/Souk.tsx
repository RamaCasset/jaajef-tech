import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { SoukCard, SoukPreview } from '../components/SoukCard'
import { Icon } from '../components/Icon'
import { applyTheme } from '../lib/theme'
import baobabArt from '../assets/art/baobab.svg'
import fruitArt from '../assets/art/fruit.svg'
import singeArt from '../assets/art/singe.svg'
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
  const [mine, setMine] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)

  const load = useCallback(async () => {
    const [list, ids] = await Promise.all([soukShop(mine ? null : kind, sort), myEquippedIds(userId)])
    setItems(mine ? list.filter((i) => i.owned) : list)
    setWorn(ids)
  }, [kind, sort, userId, mine])

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

  const featured = !mine && items && items.length > 0
    ? [...items].sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1))[0]
    : null

  return (
    <AppShell>
      <main className="page souk">
        <div className="page-deco" aria-hidden="true">
          <img src={baobabArt} alt="" />
          <img src={fruitArt} alt="" />
          <img src={singeArt} alt="" />
        </div>
        <header className="panel souk-hero">
          <div>
            <p className="eyebrow">{fr.souk.eyebrow}</p>
            <h1 className="page-title">{mine ? fr.souk.mineTitle : fr.souk.title}</h1>
            <p className="muted">{fr.souk.subtitle}</p>
          </div>
          <Link className="btn" to="/kopeks">{fr.kopeks.buy}</Link>
          <Link className="btn btn-cta" to="/souk/vendre"><Icon name="plus" size={16} /> {fr.soukSell.sellLink}</Link>
        </header>

        {featured ? (
          <section className="panel souk-featured" aria-label={fr.souk.featured(featured.name)}>
            <div className="souk-featured-text">
              <span className="souk-chip">{fr.souk.featuredChip}</span>
              <h2>{fr.souk.featured(featured.name)}</h2>
              <p className="muted">{featured.description ?? (featured.creator_name ? fr.souk.featuredBy(featured.creator_name) : '')}</p>
              <a className="souk-discover" href={`#souk-${featured.id}`}>{fr.souk.discover} <Icon name="forward" size={14} /></a>
            </div>
            <SoukPreview item={featured} big />
          </section>
        ) : null}

        <div className="souk-bar">
          {mine ? (
            <button type="button" className="pill" onClick={() => setMine(false)}>{fr.souk.backToShop}</button>
          ) : (
            <div role="tablist" aria-label={fr.souk.title} className="souk-tabs">
              {KINDS.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} className={`pill ${kind === k ? 'pill-on' : ''}`} onClick={() => setKind(k)}>{fr.souk.kinds[k]}</button>
              ))}
            </div>
          )}
          <div className="souk-bar-right">
            {items ? <span className="muted souk-count">{fr.souk.count(items.length)} · {fr.souk.allCategories}</span> : null}
            <label className="souk-sort">
              <span className="muted">{fr.souk.sort}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SoukSort)}>
                {SORTS.map((s) => <option key={s} value={s}>{fr.souk.sorts[s]}</option>)}
              </select>
            </label>
          </div>
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
          <p className="muted">{mine ? fr.souk.mineEmpty : fr.souk.empty}</p>
        ) : (
          <div className="souk-grid">
            {items.map((item) => (
              <SoukCard
                key={item.id}
                item={item}
                worn={worn.includes(item.id)}
                busy={busyId === item.id}
                onBuy={() => void act(item, () => buyItem(item.id), fr.souk.bought(item.name))}
                onEquip={() => void act(item, async () => { await equipItem(item.id); if (item.kind === 'theme') applyTheme(item.data) })}
                onUnequip={() => void act(item, async () => { await unequipItem(item.kind); if (item.kind === 'theme') applyTheme(null) })}
              />
            ))}
          </div>
        )}

        <footer className="panel souk-foot-bar">
          <span className="muted tiny">{items ? `${fr.souk.countIn(items.length, items.length)} · ` : ''}{fr.souk.support}</span>
          {!mine ? <button type="button" className="souk-mine" onClick={() => setMine(true)}>{fr.souk.mine} <Icon name="forward" size={14} /></button> : null}
        </footer>
      </main>
    </AppShell>
  )
}
