import { MentionText } from './MentionText'

const FENCE = /```([A-Za-z0-9+#_-]*)\n?([\s\S]*?)```/g

/**
 * A chat message: plain text (never HTML) where @names become links, and anything between three backticks
 * is shown as a code box, like in the design.
 */
export function ChatBody({ text }: { text: string }) {
  const parts: ({ t: 'text'; v: string } | { t: 'code'; lang: string; v: string })[] = []
  let last = 0
  for (const m of text.matchAll(FENCE)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ t: 'text', v: text.slice(last, at) })
    parts.push({ t: 'code', lang: m[1], v: m[2].replace(/\n$/, '') })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ t: 'text', v: text.slice(last) })
  return (
    <>
      {parts.map((p, i) => p.t === 'text'
        ? (p.v.trim() ? <p key={i}><MentionText text={p.v.replace(/^\n+|\n+$/g, '')} /></p> : null)
        : (
          <figure key={i} className="chat-code">
            {p.lang && <figcaption>{p.lang}</figcaption>}
            <pre><code>{p.v}</code></pre>
          </figure>
        ))}
    </>
  )
}
