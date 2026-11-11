import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { BackLink } from '../components/BackLink'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { NotificationPrefs } from '../components/NotificationPrefs'
import { BlockedSection, EmailSection, PasswordSection, SignInSection } from './SettingsSections'
import {
  cancelAccountDeletion, exportMyData, myAccountDeletion, requestAccountDeletion,
  type AccountDeletion,
} from '../lib/api'

const WAIT_DAYS = 14

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
}

export function Settings() {
  const [state, setState] = useState<AccountDeletion | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    myAccountDeletion().then(setState).catch(() => setLoadFailed(true))
  }, [])
  useEffect(load, [load])
  // A link such as /parametres/compte#notifications jumps to that section.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView?.()
  }, [])

  async function download() {
    setError(null)
    setBusy(true)
    try {
      const data = await exportMyData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = fr.settings.exportFile
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(fr.settings.exportFailed)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeletion() {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await requestAccountDeletion()
      setAsking(false)
      load()
    } catch (err) {
      setError(friendlyError(err))
      setAsking(false)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion() {
    setError(null)
    setBusy(true)
    try {
      await cancelAccountDeletion()
      setNotice(fr.settings.cancelled)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const pending = state?.requested_at && state.delete_on
  const blocked = state ? state.blockers.length > 0 : false

  return (
    <AppShell>
      <main className="page souk">
        <BackLink to="/parametres">{fr.settingsHub.backToSettings}</BackLink>
        <header className="page-head"><h1 className="page-title">{fr.settings.title}</h1></header>
        <p className="muted">{fr.settings.subtitle}</p>

        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}

        <SignInSection />
        <PasswordSection />
        <EmailSection />
        <BlockedSection />
        <div id="notifications"><NotificationPrefs /></div>

        <section className="panel panel-pad" style={{ marginBottom: 24 }}>
          <h2>{fr.settings.exportTitle}</h2>
          <p className="muted">{fr.settings.exportText}</p>
          <button className="btn" type="button" onClick={() => void download()} disabled={busy}>{fr.settings.exportButton}</button>
        </section>

        <section id="suppression" className="panel panel-pad">
          <h2>{fr.settings.deleteTitle}</h2>
          {loadFailed && (
            <>
              <p className="muted">{fr.settings.loadFailed}</p>
              <button className="btn" type="button" onClick={load}>{fr.settings.retry}</button>
            </>
          )}
          {!loadFailed && !state && <p className="muted">{fr.common.loading}</p>}

          {state && pending && (
            <>
              <div className="notice" role="status">{fr.settings.pending.replace('{date}', longDate(state.delete_on as string))}</div>
              <button className="btn" type="button" onClick={() => void cancelDeletion()} disabled={busy}>{fr.settings.cancel}</button>
            </>
          )}

          {state && !pending && blocked && (
            <>
              <p><strong>{fr.settings.cannotTitle}</strong></p>
              <ul>
                {state.blockers.map((b) => <li key={b.code}>{fr.settings.blockers[b.code] ?? b.code}</li>)}
              </ul>
            </>
          )}

          {state && !pending && !blocked && !asking && (
            <>
              <p className="muted">{fr.settings.deleteText.replace('{days}', String(WAIT_DAYS))}</p>
              <button className="btn" type="button" onClick={() => setAsking(true)}>{fr.settings.deleteButton}</button>
            </>
          )}

          {state && !pending && !blocked && asking && (
            <>
              <p>{fr.settings.deleteAsk}</p>
              <button className="btn btn-cta" type="button" onClick={() => void confirmDeletion()} disabled={busy}>{fr.settings.deleteConfirm}</button>{' '}
              <button className="btn" type="button" onClick={() => setAsking(false)}>{fr.settings.deleteBack}</button>
            </>
          )}
        </section>
      </main>
    </AppShell>
  )
}
