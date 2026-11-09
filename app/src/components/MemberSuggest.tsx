import { useEffect, useId, useRef, useState } from 'react'
import { useDebounced } from '../hooks'
import { fr } from '../i18n/fr'
import { searchEverything } from '../lib/api'

type Member = { username: string; name: string; avatar: string | null }

/**
 * A text box for a member's username that suggests members as you type (two letters are enough),
 * so nobody has to type the whole name. Arrow keys and Enter work; typing the full name still works too.
 */
export function MemberSuggest({ id, value, onChange, exclude = [], placeholder, maxLength = 40 }: {
  id: string; value: string; onChange: (v: string) => void; exclude?: string[]; placeholder?: string; maxLength?: number
}) {
  const t = fr.memberSuggest
  const listId = useId()
  const query = value.trim().replace(/^@/, '')
  const debounced = useDebounced(query, 250)
  const [found, setFound] = useState<Member[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const picked = useRef<string | null>(null)

  useEffect(() => {
    if (debounced.length < 2 || picked.current === debounced) { setFound([]); return }
    let alive = true
    searchEverything(debounced)
      .then((hits) => {
        if (!alive) return
        const skip = new Set(exclude.map((x) => x.toLowerCase()))
        setFound(hits.filter((h) => h.kind === 'member' && !skip.has(h.slug.toLowerCase())).slice(0, 6)
          .map((h) => ({ username: h.slug, name: h.title, avatar: h.image_url })))
        setActive(-1)
      })
      .catch(() => { if (alive) setFound([]) })
    return () => { alive = false }
    // `exclude` is a fresh array on each render; its content only changes when the team does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, exclude.join(',')])

  function pick(m: Member) {
    picked.current = m.username
    onChange(m.username)
    setFound([])
    setOpen(false)
    setActive(-1)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || found.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % found.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? found.length - 1 : a - 1)) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(found[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showList = open && found.length > 0
  return (
    <div className="member-suggest">
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => { picked.current = null; onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      <ul id={listId} role="listbox" aria-label={t.label} className="member-suggest-list" hidden={!showList}>
        {found.map((m, i) => (
          <li key={m.username} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : undefined}
            onMouseDown={(e) => { e.preventDefault(); pick(m) }}>
            {m.avatar ? <img src={m.avatar} alt="" width={24} height={24} /> : <span className="member-suggest-dot" aria-hidden="true">{m.username[0]?.toUpperCase()}</span>}
            <span>{m.name}</span> <span className="muted tiny">@{m.username}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
