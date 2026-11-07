import { useEffect, useState, type ReactNode } from 'react'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { getMyStaffAccess, type StaffAccess } from '../lib/api'

/** Shows its content only to members who hold a matching staff role. The database re-checks every action anyway. */
export function StaffGate({ allow, children }: { allow: (a: StaffAccess) => boolean; children: ReactNode }) {
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [access, setAccess] = useState<StaffAccess | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setFailed(false)
    getMyStaffAccess(me).then(setAccess).catch(() => setFailed(true))
  }, [me, reload])

  if (failed) {
    return (
      <AppShell>
        <main className="page souk">
          <div className="alert" role="alert">
            {fr.staff.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.staff.retry}</button>
          </div>
        </main>
      </AppShell>
    )
  }
  if (!access) return <AppShell><main className="page souk"><p className="muted">{fr.common.loading}</p></main></AppShell>
  if (!allow(access)) return <AppShell><main className="page souk"><p className="muted">{fr.staff.denied}</p></main></AppShell>
  return <>{children}</>
}

export const isModeration = (a: StaffAccess) => a.role !== null
export const isShopStaff = (a: StaffAccess) => a.role === 'admin' || a.shopManager || a.shopOwner
export const isAdmin = (a: StaffAccess) => a.role === 'admin'
