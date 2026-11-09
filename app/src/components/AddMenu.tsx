import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fr } from '../i18n/fr'
import { validName } from './ProjectFiles'

/** The "+" button of the editor: a small list with new file, new folder and upload. */
export function AddMenu({ busy, onNewFile, onNewFolder, onUpload, exists }: {
  busy: boolean
  onNewFile: (name: string) => void
  onNewFolder: () => void
  onUpload: () => void
  exists: (name: string) => boolean
}) {
  const t = fr.editor
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  function close() { setOpen(false); setNaming(null); setError(null) }

  function submit(e: FormEvent) {
    e.preventDefault()
    const name = (naming ?? '').trim()
    if (!validName(name)) { setError(t.badName); return }
    if (exists(name)) { setError(t.exists); return }
    close()
    onNewFile(name)
  }

  return (
    <div className="add-menu" ref={box}>
      <button type="button" className="icon-btn" aria-label={t.addMenu} title={t.addMenu} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => (open ? close() : setOpen(true))}>+</button>
      {open && (
        <div className="add-pop" role="menu" aria-label={t.addMenu}>
          {naming === null ? (
            <>
              <button type="button" role="menuitem" onClick={() => setNaming('')}>{t.newFile}</button>
              <button type="button" role="menuitem" onClick={() => { close(); onNewFolder() }}>{t.newFolder}</button>
              <button type="button" role="menuitem" onClick={() => { close(); onUpload() }}>{t.upload}</button>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <label htmlFor="add-file-name" className="sr-only">{t.newFileName}</label>
              <input id="add-file-name" placeholder={t.newFileName} value={naming} onChange={(e) => { setNaming(e.target.value); setError(null) }} autoFocus />
              {error && <p className="tiny add-error" role="alert">{error}</p>}
              <div className="panel-form-actions">
                <button type="button" className="btn btn-small" onClick={close}>{t.cancelShort}</button>
                <button type="submit" className="btn btn-cta btn-small">{t.createFile}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
