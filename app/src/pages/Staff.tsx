import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { getMyStaffAccess, type StaffAccess } from '../lib/api'

export function Staff() {
  const { member } = useAuth()
  const [access, setAccess] = useState<StaffAccess | null | undefined>(undefined)

  useEffect(() => {
    getMyStaffAccess(member?.profile.id ?? '').then(setAccess).catch(() => setAccess(null))
  }, [member?.profile.id])

  const any = !!access && (access.role !== null || access.shopManager || access.shopOwner || access.questWriter)
  const shop = !!access && (access.role === 'admin' || access.shopManager || access.shopOwner)

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.staff.title}</h1>
          <p className="muted">{fr.staff.subtitle}</p>
        </header>
        {access === undefined && <p className="muted">{fr.common.loading}</p>}
        {access !== undefined && !any && <p className="muted">{fr.staff.denied}</p>}
        {access && access.role !== null && (
          <>
            <section className="panel" style={{ marginBottom: 16 }}>
              <h2><Link to="/equipe/signalements">{fr.staff.tools.reports}</Link></h2>
              <p className="muted">{fr.staff.tools.reportsText}</p>
            </section>
            <section className="panel" style={{ marginBottom: 16 }}>
              <h2><Link to="/equipe/validation">{fr.staff.tools.review}</Link></h2>
              <p className="muted">{fr.staff.tools.reviewText}</p>
            </section>
          </>
        )}
        {shop && (
          <section className="panel" style={{ marginBottom: 16 }}>
            <h2><Link to="/equipe/souk">{fr.staff.tools.souk}</Link></h2>
            <p className="muted">{fr.staff.tools.soukText}</p>
          </section>
        )}
      </main>
    </AppShell>
  )
}
