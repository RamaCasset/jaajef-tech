import { lazy, Suspense } from 'react'
import { languageOf } from './CodeEditor'
import { fr } from '../i18n/fr'
import type { Change } from '../lib/pending'

const Diff = lazy(async () => { await import('./monacoSetup'); return import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })) })

const kb = (n: number) => `${Math.max(1, Math.round(n / 1000))} Ko`

/** One changed file, before and after side by side, so nobody saves something by mistake. */
export function ChangeDiff({ change }: { change: Change }) {
  const t = fr.editor
  const label = change.kind === 'add' ? t.changeNew : change.kind === 'delete' ? t.changeDeleted : change.path !== change.from ? t.changeRenamed(change.from ?? '') : t.changeEdited
  let body
  if (change.base64 !== undefined) body = <p className="muted tiny">{t.uploaded(kb(change.size ?? 0))}</p>
  else if (change.kind === 'delete') body = change.original !== undefined
    ? <DiffBox before={change.original} after="" path={change.path} />
    : <p className="muted tiny">{t.willBeDeleted}</p>
  else if (change.kind === 'add') body = <DiffBox before="" after={change.text ?? ''} path={change.path} />
  else if (change.text === undefined) body = <p className="muted tiny">{t.contentSame}</p>
  else body = <DiffBox before={change.original ?? ''} after={change.text} path={change.path} />
  return (
    <section className="change-diff" aria-label={change.path}>
      <h4><code>{change.path}</code> <span className="muted tiny">{label}</span></h4>
      {body}
    </section>
  )
}

function DiffBox({ before, after, path }: { before: string; after: string; path: string }) {
  return (
    <Suspense fallback={<p className="muted">…</p>}>
      <div className="change-diff-box">
        <p className="diff-heads tiny muted"><span>{fr.editor.before}</span><span>{fr.editor.after}</span></p>
        <Diff
          height="260px"
          language={languageOf(path)}
          original={before}
          modified={after}
          theme="vs-dark"
          options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, fontSize: 13 }}
        />
      </div>
    </Suspense>
  )
}
