import { useState, type FormEvent } from 'react'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { reportContent, type ReportReason, type ReportTarget } from '../lib/api'

const REASONS: ReportReason[] = ['spam', 'harassment', 'inappropriate', 'scam', 'other']

/** A small "Signaler" button. Opens a short form, sends the report to the Cité team. */
export function ReportButton({ type, id }: { type: ReportTarget; id: string | number }) {
  const t = fr.report
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason) return
    setError(null)
    setBusy(true)
    try {
      await reportContent(type, String(id), reason, note)
      setSent(true)
      setOpen(false)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) return <span className="tiny muted" role="status">{t.sent}</span>
  if (!open) return <button type="button" className="btn btn-link tiny" onClick={() => setOpen(true)}>{t.button}</button>

  return (
    <form onSubmit={(e) => void submit(e)} className="panel" aria-label={t.title} style={{ marginTop: 8 }}>
      <p><strong>{t.title}</strong></p>
      <p className="tiny muted">{t.intro}</p>
      {error && <div className="alert" role="alert">{error}</div>}
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend>{t.reasonLabel}</legend>
        {REASONS.map((r) => (
          <label key={r} style={{ display: 'block' }}>
            <input type="radio" name={`reason-${type}-${id}`} checked={reason === r} onChange={() => setReason(r)} /> {t.reasons[r]}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`note-${type}-${id}`}>{t.noteLabel}</label>
        <textarea id={`note-${type}-${id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-cta" disabled={busy || !reason}>{t.send}</button>{' '}
      <button type="button" className="btn" onClick={() => setOpen(false)}>{t.cancel}</button>
    </form>
  )
}
