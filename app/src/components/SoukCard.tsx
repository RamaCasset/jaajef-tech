import type { SoukItem } from '../lib/api'
import { fr } from '../i18n/fr'

type Props = {
  item: SoukItem
  worn: boolean
  busy: boolean
  onBuy: () => void
  onEquip: () => void
  onUnequip: () => void
}

function Preview({ item }: { item: SoukItem }) {
  const color = String(item.data.accent ?? item.data.color ?? '')
  const style = /^#[0-9a-fA-F]{3,8}$/.test(color) ? { borderColor: color, color } : undefined
  return <div className="souk-preview" style={style} aria-hidden="true">{item.name.slice(0, 2).toUpperCase()}</div>
}

export function SoukCard({ item, worn, busy, onBuy, onEquip, onUnequip }: Props) {
  return (
    <article className="souk-card">
      <Preview item={item} />
      <div className="souk-head">
        <h3>{item.name}</h3>
        <span className="muted">{item.avg_rating === null ? fr.souk.notRated : `★ ${item.avg_rating}`}</span>
      </div>
      {item.description ? <p className="muted">{item.description}</p> : null}
      <div className="souk-foot">
        <span className="souk-price">{fr.souk.price(item.price_kopeks)}</span>
        {!item.owned ? (
          <button type="button" className="btn btn-cta" disabled={busy} onClick={onBuy} aria-label={`${fr.souk.buy} ${item.name}`}>{fr.souk.buy}</button>
        ) : worn ? (
          <button type="button" className="btn" disabled={busy} onClick={onUnequip} aria-label={`${fr.souk.unequip} ${item.name}`}>{fr.souk.unequip}</button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={onEquip} aria-label={`${fr.souk.equip} ${item.name}`}>{fr.souk.equip}</button>
        )}
      </div>
      {worn ? <span className="tag">{fr.souk.equipped}</span> : item.owned ? <span className="tag">{fr.souk.owned}</span> : null}
    </article>
  )
}
