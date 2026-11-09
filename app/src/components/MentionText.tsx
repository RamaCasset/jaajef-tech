import { Link } from 'react-router-dom'

const TAG = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})/g

/** Plain text where each @username becomes a link to that profile. The text itself is never treated as HTML. */
export function MentionText({ text }: { text: string }) {
  const parts: (string | { name: string })[] = []
  let last = 0
  for (const m of text.matchAll(TAG)) {
    const start = (m.index ?? 0) + m[1].length
    if (start > last) parts.push(text.slice(last, start))
    parts.push({ name: m[2] })
    last = start + 1 + m[2].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <Link key={i} className="mention" to={`/profil/${p.name.toLowerCase()}`}>@{p.name}</Link>))}
    </>
  )
}
