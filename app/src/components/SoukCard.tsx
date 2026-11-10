import type { SoukItem } from '../lib/api'
import { Icon } from './Icon'
import { fr } from '../i18n/fr'

type Props = {
  item: SoukItem
  worn: boolean
  busy: boolean
  onBuy: () => void
  onEquip: () => void
  onUnequip: () => void
}

const SMALL: Record<string, string> = { theme: 'Cyber-Sahel / OS', avatar_frame: 'Avatar frame / 01', status_badge: 'Status badge / RPG' }

/** The little picture of an item: a mini screen for a theme, a ring for a frame, a seal for a badge. */
export function SoukPreview({ item, big = false }: { item: SoukItem; big?: boolean }) {
  const raw = String(item.data.accent ?? item.data.color ?? item.data.border ?? '')
  const color = /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : 'var(--accent)'
  const initials = item.name.slice(0, 2).toUpperCase()
  const cls = `souk-preview${big ? ' souk-preview-big' : ''}`
  if (item.kind === 'theme') {
    return (
      <div className={`${cls} souk-preview-theme`} style={{ ['--pv' as string]: color }} aria-hidden="true">
        <span className="pv-label">{item.name.toUpperCase()}</span>
        <span className="pv-side" />
        <span className="pv-tile"><i>12</i></span><span className="pv-tile"><i>42</i></span><span className="pv-tile"><i>86</i></span>
        <span className="pv-term">&gt; init teranga();<br />✓ system.connected</span>
      </div>
    )
  }
  if (item.kind === 'avatar_frame') {
    return (
      <div className={cls} aria-hidden="true">
        <span className="pv-label">{SMALL.avatar_frame}</span>
        <span className="pv-ring" style={{ borderColor: color }}><span className="pv-frame" style={{ borderColor: color }}>{initials}</span></span>
      </div>
    )
  }
  return (
    <div className={cls} aria-hidden="true">
      <span className="pv-label">{SMALL.status_badge}</span>
      <span className="pv-badge" style={{ borderColor: color, color }}>{String(item.data.label ?? initials)}</span>
    </div>
  )
}

export function SoukCard({ item, worn, busy, onBuy, onEquip, onUnequip }: Props) {
  const who = item.creator_name
  return (
    <article className={`souk-card${worn ? ' souk-card-on' : ''}`} id={`souk-${item.id}`}>
      <SoukPreview item={item} />
      <div className="souk-head">
        <h3>{item.name}</h3>
        <span className="muted tiny">{item.avg_rating === null ? fr.souk.notRated : `★ ${item.avg_rating}`}</span>
      </div>
      {who ? (
        <p className="souk-creator">
          <span className="souk-creator-avatar" aria-hidden="true">{who.slice(0, 2).toUpperCase()}</span>
          <span className="muted">{who}</span>
          {item.creator_clan ? <span className={`souk-clan souk-clan-${item.creator_clan}`}>{fr.clans[item.creator_clan].name}</span> : null}
        </p>
      ) : null}
      {item.description ? <p className="muted souk-desc">{item.description}</p> : null}
      <div className="souk-foot">
        <span className="souk-price">{fr.souk.price(item.price_kopeks)}</span>
        {!item.owned ? (
          <button type="button" className="btn souk-buy" disabled={busy} onClick={onBuy} aria-label={`${fr.souk.buy} ${item.name}`}><Icon name="souk" size={16} /> {fr.souk.buy}</button>
        ) : worn ? (
          <button type="button" className="btn" disabled={busy} onClick={onUnequip} aria-label={`${fr.souk.unequip} ${item.name}`}>{fr.souk.unequip}</button>
        ) : (
          <button type="button" className="btn btn-cta" disabled={busy} onClick={onEquip} aria-label={`${fr.souk.equip} ${item.name}`}>{fr.souk.equip}</button>
        )}
      </div>
      {worn ? <span className="tag">{fr.souk.equipped}</span> : item.owned ? <span className="tag">{fr.souk.owned}</span> : null}
    </article>
  )
}
