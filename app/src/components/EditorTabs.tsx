import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'

const base = (p: string) => p.split('/').pop() ?? p

/** The files open in the editor, one tab each. A dot marks a file with changes that are not saved yet. */
export function EditorTabs({ tabs, active, changed, removed, hrefFor, onClose }: {
  tabs: string[]; active: string; changed: Set<string>; removed: Set<string>; hrefFor: (path: string) => string; onClose: (path: string) => void
}) {
  const t = fr.editor
  const same = (p: string) => tabs.filter((x) => base(x) === base(p)).length > 1
  // Two tabs with the same file name also show their folder, so they can be told apart.
  const label = (p: string) => (same(p) ? p.split('/').slice(-2).join('/') : base(p))
  return (
    <div className="editor-tabs-bar" role="tablist" aria-label={t.openTabs}>
      {tabs.map((p) => (
        <div key={p} className={`editor-tab ${p === active ? 'editor-tab-on' : ''}`}>
          <Link role="tab" aria-selected={p === active} to={hrefFor(p)} title={p} className={removed.has(p) ? 'editor-tab-removed' : undefined}>
            {label(p)}
            {changed.has(p) && <span className="editor-dot" role="img" aria-label={t.modified} />}
          </Link>
          <button type="button" className="editor-close" aria-label={t.closeTab(p)} onClick={() => onClose(p)}>×</button>
        </div>
      ))}
    </div>
  )
}
