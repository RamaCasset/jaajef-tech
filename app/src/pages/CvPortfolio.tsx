import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  addPortfolioItem, cvLink, deletePortfolioItem, getMyCv, listMyPortfolio, removeMyCv, updatePortfolioItem, uploadCv,
  type MyCv, type PortfolioItem,
} from '../lib/api'

const MAX_ITEMS = 10
const MAX_CV_BYTES = 5 * 1024 * 1024

function ItemForm({ item, onSave, onCancel }: {
  item?: PortfolioItem
  onSave: (title: string, description: string, url: string) => Promise<void>
  onCancel?: () => void
}) {
  const t = fr.cvPortfolio
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = item?.id ?? 'new'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSave(title.trim(), description.trim(), url.trim())
      if (!item) { setTitle(''); setDescription(''); setUrl('') }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor={`pt-${id}`}>{t.itemTitle}</label>
        <input id={`pt-${id}`} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`pd-${id}`}>{t.itemDescription}</label>
        <textarea id={`pd-${id}`} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`pu-${id}`}>{t.itemUrl}</label>
        <input id={`pu-${id}`} type="url" value={url} maxLength={300} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-cta" disabled={busy || title.trim().length < 2 || !url.trim()}>{item ? t.save : t.add}</button>
      {onCancel && <>{' '}<button type="button" className="btn" onClick={onCancel}>{t.cancel}</button></>}
    </form>
  )
}

export function CvPortfolio() {
  const t = fr.cvPortfolio
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [items, setItems] = useState<PortfolioItem[] | null>(null)
  const [cv, setCv] = useState<MyCv | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setFailed(false)
    Promise.all([listMyPortfolio(me), getMyCv(me)]).then(([i, c]) => { setItems(i); setCv(c) }).catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function run(fn: () => Promise<void>, message: string) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await fn()
      setNotice(message)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError(t.cvNotPdf); return }
    if (file.size > MAX_CV_BYTES) { setError(t.cvTooBig); return }
    void run(() => uploadCv(me, file), t.cvUploaded)
  }

  async function openCv() {
    if (!cv?.cv_path) return
    setError(null)
    try {
      window.open(await cvLink(cv.cv_path), '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const full = (items?.length ?? 0) >= MAX_ITEMS

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/dossier">← {t.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>
        {failed && (
          <div className="alert" role="alert">
            {t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button>
          </div>
        )}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && <div className="alert" role="alert">{error}</div>}

        {items && cv && (
          <>
            <section className="panel panel-pad" style={{ marginBottom: 16 }}>
              <h2>{t.cvTitle}</h2>
              {cv.cv_name ? (
                <>
                  <p>{cv.cv_name}</p>
                  <p>
                    <button type="button" className="btn" onClick={() => void openCv()}>{t.cvOpen}</button>{' '}
                    <button type="button" className="btn" disabled={busy} onClick={() => picker.current?.click()}>{t.cvReplace}</button>{' '}
                    <button type="button" className="btn" disabled={busy} onClick={() => void run(removeMyCv, t.cvRemoved)}>{t.cvRemove}</button>
                  </p>
                </>
              ) : (
                <>
                  <p className="muted">{t.cvNone}</p>
                  <p><button type="button" className="btn btn-cta" disabled={busy} onClick={() => picker.current?.click()}>{t.cvChoose}</button></p>
                </>
              )}
              <p className="tiny muted">{t.cvHint}</p>
              <input
                ref={picker}
                type="file"
                accept="application/pdf,.pdf"
                aria-label={t.cvChoose}
                style={{ display: 'none' }}
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </section>

            <section className="panel panel-pad" style={{ marginBottom: 16 }}>
              <h2>{t.portfolioTitle}</h2>
              <p className="tiny muted">{t.portfolioHint(items.length, MAX_ITEMS)}</p>
              {items.length === 0 && <p className="muted">{t.portfolioEmpty}</p>}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {items.map((it) => (
                  <li key={it.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    {editing === it.id ? (
                      <ItemForm
                        item={it}
                        onCancel={() => setEditing(null)}
                        onSave={async (title, description, url) => { await updatePortfolioItem(it.id, title, description, url); setEditing(null); setNotice(t.saved); load() }}
                      />
                    ) : (
                      <>
                        <strong>{it.title}</strong>
                        {it.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{it.description}</p>}
                        {it.url && <p className="tiny" style={{ margin: 0 }}><a href={it.url} target="_blank" rel="noopener noreferrer nofollow">{it.url}</a></p>}
                        <p style={{ margin: '4px 0 0' }}>
                          <button type="button" className="btn" aria-label={`${t.edit} : ${it.title}`} onClick={() => setEditing(it.id)}>{t.edit}</button>{' '}
                          <button type="button" className="btn" aria-label={`${t.remove} : ${it.title}`} disabled={busy} onClick={() => void run(() => deletePortfolioItem(it.id), t.saved)}>{t.remove}</button>
                        </p>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {full ? (
                <p className="muted">{t.portfolioFull}</p>
              ) : (
                <ItemForm onSave={async (title, description, url) => { await addPortfolioItem(title, description, url); setNotice(t.saved); load() }} />
              )}
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
