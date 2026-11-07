import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMyStaffAccess = vi.fn()
const listReports = vi.fn()
const resolveReport = vi.fn()
const listReviewQueue = vi.fn()
const reviewEmployer = vi.fn()
const reviewJobOffer = vi.fn()

vi.mock('../lib/api', () => ({
  getMyStaffAccess: (...a: unknown[]) => getMyStaffAccess(...a),
  listReports: (...a: unknown[]) => listReports(...a),
  resolveReport: (...a: unknown[]) => resolveReport(...a),
  listReviewQueue: (...a: unknown[]) => listReviewQueue(...a),
  reviewEmployer: (...a: unknown[]) => reviewEmployer(...a),
  reviewJobOffer: (...a: unknown[]) => reviewJobOffer(...a),
  getUnreadCount: vi.fn().mockResolvedValue(0),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 0, profile: { id: 'u1', username: 'mod', display_name: 'Mod', clan: 'saltigue', mastery: 'bagne', xp: 0 } },
    signOut: vi.fn(),
  }),
}))

import { StaffReports } from '../pages/StaffReports'
import { StaffReview } from '../pages/StaffReview'

const report = (extra = {}) => ({
  report_id: 'r1', target_type: 'message', target_id: 'm1', target_author_id: 'u2', target_author_username: 'fatou', reporter_username: 'ibou',
  reason: 'spam', note: 'Il répète le même lien', snapshot: { body: '<b>achetez</b>' }, status: 'open', created_at: '2026-11-06T10:00:00Z',
  open_reports_on_same_target: 1, ...extra,
})
const staff = (extra = {}) => ({ role: 'moderator', shopManager: false, questWriter: false, shopOwner: false, ...extra })

beforeEach(() => {
  for (const m of [getMyStaffAccess, listReports, resolveReport, listReviewQueue, reviewEmployer, reviewJobOffer]) m.mockReset()
  getMyStaffAccess.mockResolvedValue(staff())
  listReports.mockResolvedValue([report()])
  resolveReport.mockResolvedValue(undefined)
  listReviewQueue.mockResolvedValue([
    { kind: 'employer', id: 'e1', title: 'Wave', owner_username: 'cto', created_at: '2026-11-05T10:00:00Z' },
    { kind: 'offer', id: 'o1', title: 'Dev Python', owner_username: 'cto', created_at: '2026-11-05T11:00:00Z' },
  ])
  reviewEmployer.mockResolvedValue(undefined)
  reviewJobOffer.mockResolvedValue(undefined)
})

describe('Staff reports', () => {
  it('shows the queue to a moderator, as plain text', async () => {
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    expect(await screen.findByText('<b>achetez</b>')).toBeInTheDocument()
    expect(screen.getByText(/Il répète le même lien/)).toBeInTheDocument()
  })

  it('shows nothing to a member without a staff role', async () => {
    getMyStaffAccess.mockResolvedValue(staff({ role: null }))
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    expect(await screen.findByText(/réservée à l'équipe/)).toBeInTheDocument()
    expect(listReports).not.toHaveBeenCalled()
  })

  it('offers no "remove content" for a reported member', async () => {
    listReports.mockResolvedValue([report({ target_type: 'member' })])
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    await screen.findByText('Avertir le membre')
    expect(screen.queryByText('Retirer le contenu')).not.toBeInTheDocument()
  })

  it('sends the suspension length only for a suspension', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    await user.click(await screen.findByText('Suspendre le membre'))
    const days = screen.getByLabelText(/Durée de la suspension/)
    await user.clear(days)
    await user.type(days, '3')
    await user.click(screen.getByText('Confirmer'))
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r1', 'suspend_member', '', 3))
  })

  it('sends no days for a warning, and reloads', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    await user.click(await screen.findByText('Avertir le membre'))
    await user.click(screen.getByText('Confirmer'))
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r1', 'warn_member', '', null))
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Signalement traité.')).toBeInTheDocument()
  })

  it('shows a friendly message when the database refuses', async () => {
    resolveReport.mockRejectedValue(new Error('This report has already been handled'))
    const user = userEvent.setup()
    render(<MemoryRouter><StaffReports /></MemoryRouter>)
    await user.click(await screen.findByText('Classer sans suite'))
    await user.click(screen.getByText('Confirmer'))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà été traité')
  })
})

describe('Staff review', () => {
  it('approves an employer and an offer through the right calls', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffReview /></MemoryRouter>)
    await user.click(await screen.findByLabelText('Valider : Wave'))
    await waitFor(() => expect(reviewEmployer).toHaveBeenCalledWith('e1', true, ''))
    await user.click(await screen.findByLabelText('Valider : Dev Python'))
    await waitFor(() => expect(reviewJobOffer).toHaveBeenCalledWith('o1', true, ''))
  })

  it('needs a reason before a refusal can be confirmed', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><StaffReview /></MemoryRouter>)
    await user.click(await screen.findByLabelText('Refuser : Wave'))
    const confirm = screen.getByText('Confirmer le refus')
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Raison du refus'), 'Pas de site')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(reviewEmployer).toHaveBeenCalledWith('e1', false, 'Pas de site'))
  })
})
