import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { StaffGate, isModeration } from '../staff/StaffGate'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { listReports, resolveReport, type ReportAction, type ReportRow } from '../lib/api'

type Tab = 'open' | 'actioned' | 'dismissed'
const TABS: Tab[] = ['open', 'actioned', 'dismissed']
const ACTIONS: ReportAction[] = ['dismiss', 'remove_content', 'warn_member', 'suspend_member']

function Snapshot({ data }: { data: Record<string, unknown> }) {
  const labels = fr.staff.reports.snapshot as Record<string, string>
  const rows = Object.entries(data).filter(([k, v]) => labels[k] && v !== null && v !== '')
  return (
    <dl className="tiny" style={{ margin: '8px 0' }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="muted" style={{ display: 'inline' }}>{labels[k]} : </dt>
          {/* Plain text only: what a member wrote is never treated as markup. */}
          <dd style={{ display: 'inline', margin: 0, whiteSpace: 'pre-wrap' }}>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReportCard({ report, onDone }: { report: ReportRow; onDone: () => void }) {
  const [action, setAction] = useState<ReportAction | null>(null)
  const [note, setNote] = useState('')
  const [days, setDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = fr.staff.reports
  const canRemove = report.target_type !== 'member'

  async function confirm() {
    if (!action) return
    setError(null)
    setBusy(true)
    try {
      await resolveReport(report.report_id, action, note, action === 'suspend_member' ? Number(days) : null)
      onDone()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="panel panel-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>
        {t.types[report.target_type]} · <span className="tag">{t.reasons[report.reason]}</span>
      </h3>
      <p className="tiny muted">
        <Link to={`/profil/${report.target_author_username}`}>{t.about(report.target_author_username)}</Link>
        {' · '}{t.reportedBy(report.reporter_username)}
        {report.open_reports_on_same_target > 1 && ` · ${t.sameTarget(report.open_reports_on_same_target)}`}
      </p>
      {report.note && <p>« {report.note} »</p>}
      <Snapshot data={report.snapshot} />
      {error && <div className="alert" role="alert">{error}</div>}
      {report.status === 'open' && !action && (
        <p>
          {ACTIONS.filter((a) => a !== 'remove_content' || canRemove).map((a) => (
            <button key={a} type="button" className="btn" style={{ marginRight: 8 }} onClick={() => setAction(a)}>{t.actions[a]}</button>
          ))}
        </p>
      )}
      {report.status === 'open' && action && (
        <div>
          <p><strong>{t.actions[action]}</strong></p>
          <div className="field">
            <label htmlFor={`note-${report.report_id}`}>{t.noteLabel}</label>
            <textarea id={`note-${report.report_id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {action === 'suspend_member' && (
            <div className="field">
              <label htmlFor={`days-${report.report_id}`}>{t.daysLabel}</label>
              <input id={`days-${report.report_id}`} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          )}
          <button type="button" className="btn btn-cta" disabled={busy || (action === 'suspend_member' && !(Number(days) >= 1))} onClick={() => void confirm()}>{t.confirm}</button>{' '}
          <button type="button" className="btn" onClick={() => setAction(null)}>{t.cancel}</button>
        </div>
      )}
    </article>
  )
}

function StaffReportsPage() {
  const [tab, setTab] = useState<Tab>('open')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setRows(null)
    listReports(tab).then(setRows).catch(() => setFailed(true))
  }, [tab])
  useEffect(load, [load])

  return (
    <AppShell>
        <main className="page souk">
          <p><Link to="/equipe">← {fr.staff.back}</Link></p>
          <h1 className="page-title">{fr.staff.reports.title}</h1>
          <div role="tablist" className="souk-tabs">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`pill ${tab === k ? 'pill-on' : ''}`} onClick={() => { setTab(k); setNotice(false) }}>
                {fr.staff.reports.tabs[k]}
              </button>
            ))}
          </div>
          {notice && <div className="notice" role="status">{fr.staff.reports.done}</div>}
          {failed && (
            <div className="alert" role="alert">
              {fr.staff.loadFailed} <button type="button" className="btn" onClick={load}>{fr.staff.retry}</button>
            </div>
          )}
          {!failed && !rows && <p className="muted">{fr.common.loading}</p>}
          {rows && rows.length === 0 && <p className="muted">{fr.staff.reports.empty}</p>}
          {(rows ?? []).map((r) => <ReportCard key={r.report_id} report={r} onDone={() => { setNotice(true); load() }} />)}
        </main>
    </AppShell>
  )
}

export function StaffReports() {
  return (
    <StaffGate allow={isModeration}>
      <StaffReportsPage />
    </StaffGate>
  )
}
