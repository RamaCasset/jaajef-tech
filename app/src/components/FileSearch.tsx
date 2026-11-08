import { forwardRef, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fileUrl } from './ProjectFiles'
import { EditorError, editorSearch, type SearchResult } from '../lib/api'
import { fr } from '../i18n/fr'

const MAX_NAMES = 30

/** Looks for a file by name as you type (like Ctrl+P), and for members also inside the text of every file. */
export const FileSearch = forwardRef<HTMLInputElement, { projectId: string; paths: string[]; branch: string | null; canSearchText: boolean }>(
  function FileSearch({ projectId, paths, branch, canSearchText }, ref) {
    const t = fr.editor
    const [q, setQ] = useState('')
    const [text, setText] = useState<SearchResult | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const needle = q.trim().toLowerCase()
    const names = useMemo(() => (needle ? paths.filter((p) => p.toLowerCase().includes(needle)).slice(0, MAX_NAMES) : []), [paths, needle])

    async function searchText() {
      setBusy(true); setError(null)
      try { setText(await editorSearch(projectId, q.trim(), branch)) }
      catch (e) { setText(null); setError(fr.editor.errors[e instanceof EditorError ? e.code : 'search_failed'] ?? t.errors.search_failed) }
      finally { setBusy(false) }
    }

    return (
      <div className="file-search">
        <label htmlFor="file-search" className="sr-only">{t.searchLabel}</label>
        <input id="file-search" ref={ref} type="search" placeholder={t.searchPlaceholder} value={q} onChange={(e) => { setQ(e.target.value); setText(null); setError(null) }} />
        {needle && (
          <ul className="search-results" aria-label={t.searchResults}>
            {names.map((p) => <li key={p}><Link to={fileUrl(projectId, p, branch)} title={p}>{p}</Link></li>)}
            {names.length === 0 && <li className="muted tiny">{t.searchNone}</li>}
          </ul>
        )}
        {canSearchText && needle.length >= 2 && (
          <button type="button" className="btn" disabled={busy} onClick={() => void searchText()}>{busy ? t.searching : t.searchText}</button>
        )}
        {error && <p role="alert" className="alert">{error}</p>}
        {text && (
          <ul className="search-results" aria-label={t.searchText}>
            {text.matches.map((m) => (
              <li key={`${m.path}:${m.line}`}>
                <Link to={fileUrl(projectId, m.path, branch)}>{m.path}</Link> <span className="muted tiny">{t.textLine(m.line)}</span>
                <div className="search-line tiny">{m.text}</div>
              </li>
            ))}
            {text.matches.length === 0 && <li className="muted tiny">{t.textNone}</li>}
            {text.more && <li className="muted tiny">{t.textMore}</li>}
            {text.skipped > 0 && <li className="muted tiny">{t.textSkipped(text.skipped)}</li>}
          </ul>
        )}
      </div>
    )
  })
