import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  findMemberByUsername, liftSuspension, listBackOfficeTeam, listStaff, setBackOfficeRole, setModerator,
  type BackOfficeRole, type StaffMember,
} from '../lib/api'

const BACK_ROLES: BackOfficeRole[] = ['quest_writer', 'shop_manager', 'shop_owner']

/** A form that takes a username, finds the member, and runs one action on them. */
function UsernameForm({ id, label, button, extra, run, onDone }: {
  id: string
  label: string
  button: string
  extra?: React.ReactNode
  run: (userId: string) => Promise<void>
  onDone: () => void
}) {
  const t = fr.staff.team
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const found = await findMemberByUsername(name)
      if (!found) {
        setError(t.memberNotFound(name.trim().replace(/^@/, '')))
        return
      }
      await run(found.id)
      setName('')
      onDone()
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
        <label htmlFor={id}>{label}</label>
        <input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <span className="hint">{t.usernameHint}</span>
      </div>
      {extra}
      <button type="submit" className="btn btn-cta" disabled={busy || !name.trim()}>{button}</button>
    </form>
  )
}

export function StaffTeamPanel() {
  const t = fr.staff.team
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [back, setBack] = useState<StaffMember[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const [role, setRole] = useState<BackOfficeRole>('shop_manager')

  const load = useCallback(() => {
    setFailed(false)
    Promise.all([listStaff(), listBackOfficeTeam()]).then(([s, b]) => { setStaff(s); setBack(b) }).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const changed = () => { setNotice(true); setRowError(null); load() }
  async function rowAction(fn: () => Promise<void>) {
    setRowError(null)
    try { await fn(); changed() } catch (err) { setRowError(friendlyError(err)) }
  }

  return (
    <section>
      {notice && <div className="notice" role="status">{t.done}</div>}
      {rowError && <div className="alert" role="alert">{rowError}</div>}
      {failed && (
        <div className="alert" role="alert">
          {fr.staff.loadFailed} <button type="button" className="btn" onClick={load}>{fr.staff.retry}</button>
        </div>
      )}
      {!failed && !staff && <p className="muted">{fr.common.loading}</p>}

      {staff && (
        <section className="panel panel-pad" style={{ marginBottom: 16 }}>
          <h2>{t.staffTitle}</h2>
          {staff.length === 0 && <p className="muted">{t.empty}</p>}
          <ul>
            {staff.map((m) => (
              <li key={m.user_id}>
                <Link to={`/profil/${m.username}`}>@{m.username}</Link> · {t.roles[m.role as 'admin' | 'moderator'] ?? m.role}
                {m.role === 'moderator' && (
                  <> <button type="button" className="btn" aria-label={`${t.removeMod} : ${m.username}`} onClick={() => void rowAction(() => setModerator(m.user_id, false))}>{t.removeMod}</button></>
                )}
              </li>
            ))}
          </ul>
          <p className="tiny muted">{t.adminNote}</p>
          <h3>{t.addModTitle}</h3>
          <UsernameForm id="mod-name" label={t.usernameLabel} button={t.addMod} run={(id) => setModerator(id, true)} onDone={changed} />
        </section>
      )}

      {back && (
        <section className="panel panel-pad" style={{ marginBottom: 16 }}>
          <h2>{t.backTitle}</h2>
          {back.length === 0 && <p className="muted">{t.backEmpty}</p>}
          <ul>
            {back.map((m) => (
              <li key={`${m.user_id}-${m.role}`}>
                <Link to={`/profil/${m.username}`}>@{m.username}</Link> · {t.backRoles[m.role as BackOfficeRole] ?? m.role}
                {' '}<button type="button" className="btn" aria-label={`${t.removeRole} : ${m.username} ${t.backRoles[m.role as BackOfficeRole] ?? m.role}`} onClick={() => void rowAction(() => setBackOfficeRole(m.user_id, m.role as BackOfficeRole, false))}>{t.removeRole}</button>
              </li>
            ))}
          </ul>
          <h3>{t.addRoleTitle}</h3>
          <UsernameForm
            id="role-name"
            label={t.usernameLabel}
            button={t.giveRole}
            run={(id) => setBackOfficeRole(id, role, true)}
            onDone={changed}
            extra={
              <div className="field">
                <label htmlFor="role-pick">{t.roleLabel}</label>
                <select id="role-pick" value={role} onChange={(e) => setRole(e.target.value as BackOfficeRole)}>
                  {BACK_ROLES.map((r) => <option key={r} value={r}>{t.backRoles[r]}</option>)}
                </select>
              </div>
            }
          />
        </section>
      )}

      {staff && (
        <section className="panel panel-pad" style={{ marginBottom: 16 }}>
          <h2>{t.liftTitle}</h2>
          <p className="muted">{t.liftText}</p>
          <UsernameForm id="lift-name" label={t.usernameLabel} button={t.lift} run={(id) => liftSuspension(id)} onDone={changed} />
        </section>
      )}
    </section>
  )
}

