import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { getMyStaffAccess, type StaffAccess } from '../lib/api'
import { isAdmin, isModeration, isShopStaff } from '../staff/StaffGate'
import { StaffReportsPanel } from './StaffReports'
import { StaffSoukPanel } from './StaffSouk'
import { StaffTeamPanel } from './StaffTeam'

type TabKey = 'reports' | 'souk' | 'team'
const TABS: { key: TabKey; allow: (a: StaffAccess) => boolean }[] = [
  { key: 'reports', allow: isModeration },
  { key: 'souk', allow: isShopStaff },
  { key: 'team', allow: isAdmin },
]

export function Staff() {
  const { member } = useAuth()
  const [access, setAccess] = useState<StaffAccess | null | undefined>(undefined)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    getMyStaffAccess(member?.profile.id ?? '').then(setAccess).catch(() => setAccess(null))
  }, [member?.profile.id])

  const tabs = access ? TABS.filter((t) => t.allow(access)) : []
  const asked = params.get('onglet')
  const current = tabs.find((t) => t.key === asked)?.key ?? tabs[0]?.key

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.staff.title}</h1>
          <p className="muted">{fr.staff.subtitle}</p>
        </header>
        {access === undefined && <p className="muted">{fr.common.loading}</p>}
        {access !== undefined && tabs.length === 0 && <p className="muted">{fr.staff.denied}</p>}
        {tabs.length > 0 && (
          <div role="tablist" aria-label={fr.staff.title} className="souk-tabs">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={current === t.key} className={`pill ${current === t.key ? 'pill-on' : ''}`} onClick={() => setParams({ onglet: t.key })}>
                {fr.staff.tabs[t.key]}
              </button>
            ))}
          </div>
        )}
        {current === 'reports' && <StaffReportsPanel />}
        {current === 'souk' && <StaffSoukPanel />}
        {current === 'team' && <StaffTeamPanel />}
      </main>
    </AppShell>
  )
}
