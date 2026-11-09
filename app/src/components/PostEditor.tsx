import { useRef, useState, type ChangeEvent } from 'react'
import { fr } from '../i18n/fr'
import { ArticleBody } from './ArticleBody'
import { CodeEditor, languageOf } from './CodeEditor'

const LIMIT = 8000
const MAX_SNIPPETS = 3
const MAX_FILE_BYTES = 100_000

const LANGS: { ext: string; label: string }[] = [
  { ext: 'py', label: 'Python' }, { ext: 'js', label: 'JavaScript' }, { ext: 'ts', label: 'TypeScript' }, { ext: 'dart', label: 'Dart' },
  { ext: 'java', label: 'Java' }, { ext: 'c', label: 'C' }, { ext: 'cpp', label: 'C++' }, { ext: 'go', label: 'Go' }, { ext: 'rs', label: 'Rust' },
  { ext: 'sql', label: 'SQL' }, { ext: 'html', label: 'HTML' }, { ext: 'css', label: 'CSS' }, { ext: 'json', label: 'JSON' }, { ext: 'sh', label: 'Shell' },
  { ext: 'txt', label: 'Texte' },
]
const UPLOAD_TYPES = LANGS.map((l) => `.${l.ext}`).concat(['.jsx', '.tsx', '.md', '.yml', '.yaml', '.xml', '.kt', '.swift', '.rb', '.php']).join(',')

type Snippet = { id: number; name: string; ext: string; code: string }

/** The markdown that is sent: the text, then each code block, fenced with more backticks than the code itself contains. */
export function composePost(text: string, snippets: Snippet[]): string {
  let out = text.trimEnd()
  for (const s of snippets) {
    if (!s.code.trim()) continue
    const longest = Math.max(2, ...(s.code.match(/`+/g) ?? []).map((r) => r.length))
    const fence = '`'.repeat(longest + 1)
    out += `${out ? '\n\n' : ''}${s.name ? `**${s.name}**\n\n` : ''}${fence}${languageOf(`x.${s.ext}`)}\n${s.code.replace(/\n+$/, '')}\n${fence}`
  }
  return out
}

/**
 * The box where a question or an answer is written: formatting buttons, a preview, and, if the person wants,
 * a code editor or an uploaded code file. Each code block can be removed. What it hands back is plain markdown.
 */
export function PostEditor({ id, initial = '', rows = 8, placeholder, onChange }: {
  id: string
  initial?: string
  rows?: number
  placeholder?: string
  onChange: (markdown: string) => void
}) {
  const t = fr.postEditor
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const next = useRef(1)
  const [text, setText] = useState(initial)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [preview, setPreview] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const composed = composePost(text, snippets)
  const emit = (nextText: string, nextSnippets: Snippet[]) => { setText(nextText); setSnippets(nextSnippets); onChange(composePost(nextText, nextSnippets)) }

  function wrap(before: string, after: string, fallback: string) {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const picked = text.slice(a, b) || fallback
    emit(text.slice(0, a) + before + picked + after + text.slice(b), snippets)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + picked.length) })
  }
  function linePrefix(prefix: string) {
    const el = area.current
    if (!el) return
    const a = el.selectionStart
    const start = text.lastIndexOf('\n', a - 1) + 1
    emit(text.slice(0, start) + prefix + text.slice(start), snippets)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + prefix.length, a + prefix.length) })
  }

  const addSnippet = (partial: Partial<Snippet> = {}) => {
    if (snippets.length >= MAX_SNIPPETS) return
    emit(text, [...snippets, { id: next.current++, name: '', ext: 'py', code: '', ...partial }])
  }
  const patch = (sid: number, p: Partial<Snippet>) => emit(text, snippets.map((s) => (s.id === sid ? { ...s, ...p } : s)))
  const remove = (sid: number) => emit(text, snippets.filter((s) => s.id !== sid))

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setFileError(null)
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setFileError(t.fileTooBig); return }
    const code = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result ?? '')); r.onerror = () => reject(r.error); r.readAsText(file) }).catch(() => null)
    if (code === null) { setFileError(t.fileTooBig); return }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'txt'
    addSnippet({ name: file.name, ext: LANGS.some((l) => l.ext === ext) ? ext : 'txt', code })
  }

  const over = composed.length > LIMIT

  return (
    <div className="post-editor">
      <div className="post-toolbar" role="toolbar" aria-label={t.toolbar}>
        <button type="button" className="btn" aria-label={t.bold} onClick={() => wrap('**', '**', t.boldSample)}><strong>B</strong></button>
        <button type="button" className="btn" aria-label={t.italic} onClick={() => wrap('_', '_', t.italicSample)}><em>I</em></button>
        <button type="button" className="btn" aria-label={t.inlineCode} onClick={() => wrap('`', '`', 'code')}>{'</>'}</button>
        <button type="button" className="btn" aria-label={t.link} onClick={() => wrap('[', '](https://)', t.linkSample)}>{t.linkShort}</button>
        <button type="button" className="btn" aria-label={t.list} onClick={() => linePrefix('- ')}>{t.listShort}</button>
        <button type="button" className="btn" aria-label={t.quote} onClick={() => linePrefix('> ')}>{t.quoteShort}</button>
        <span className="post-toolbar-gap" />
        <button type="button" className={`btn ${preview ? 'btn-cta' : ''}`} aria-pressed={preview} onClick={() => setPreview((p) => !p)}>{preview ? t.write : t.preview}</button>
      </div>

      {preview ? (
        <div className="post-preview panel-pad" aria-label={t.preview}>
          {composed.trim() ? <ArticleBody text={composed} /> : <p className="muted">{t.previewEmpty}</p>}
        </div>
      ) : (
        <textarea ref={area} id={id} rows={rows} placeholder={placeholder} value={text} onChange={(e) => emit(e.target.value, snippets)} />
      )}

      {snippets.map((s, i) => (
        <section key={s.id} className="post-snippet" aria-label={t.snippet(i + 1)}>
          <header className="post-snippet-head">
            <strong>{s.name || t.snippet(i + 1)}</strong>
            <select aria-label={t.language} value={s.ext} onChange={(e) => patch(s.id, { ext: e.target.value })}>
              {LANGS.map((l) => <option key={l.ext} value={l.ext}>{l.label}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => remove(s.id)}>{t.removeCode}</button>
          </header>
          <CodeEditor height="260px" path={`snippet-${s.id}.${s.ext}`} value={s.code} onChange={(code) => patch(s.id, { code })} />
        </section>
      ))}

      <div className="post-actions">
        <button type="button" className="btn" disabled={snippets.length >= MAX_SNIPPETS} onClick={() => addSnippet()}>{t.addCode}</button>
        <button type="button" className="btn" disabled={snippets.length >= MAX_SNIPPETS} onClick={() => picker.current?.click()}>{t.uploadCode}</button>
        <input ref={picker} type="file" hidden accept={UPLOAD_TYPES} aria-label={t.uploadCode} onChange={(e) => void onFile(e)} />
        <span className={`tiny ${over ? 'post-over' : 'muted'}`}>{t.count(composed.length, LIMIT)}</span>
      </div>
      {fileError && <p role="alert" className="alert">{fileError}</p>}
      {over && <p role="alert" className="alert">{t.tooLong(LIMIT)}</p>}
    </div>
  )
}
