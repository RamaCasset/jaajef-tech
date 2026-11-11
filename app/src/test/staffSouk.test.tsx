import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMyStaffAccess = vi.fn()
const listSoukSubmissions = vi.fn()
const reviewSoukSubmission = vi.fn()

vi.mock('../lib/api', () => ({
  getMyStaffAccess: (...a: unknown[]) => getMyStaffAccess(...a),
  listSoukSubmissions: (...a: unknown[]) => listSoukSubmissions(...a),
  reviewSoukSubmission: (...a: unknown[]) => reviewSoukSubmission(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 0, profile: { id: 'me', username: 'boss', display_name: 'Boss', clan: 'saltigue', mastery: 'bagne', xp: 0 } },
    signOut: vi.fn(),
  }),
}))

import { Staff } from '../pages/Staff'

const sub = (extra = {}) => ({
  id: 's1', creator_id: 'u2', creator_username: 'awa', kind: 'theme', name: 'Sahel doré', description: '<i>beau</i>',
  data: { accent: '#C9A227', label: 'Doré' }, proposed_price: 300, status: 'pending', review_note: null, created_at: '2026-11-06T10:00:00Z', ...extra,
})
const access = (extra = {}) => ({ role: null, shopManager: true, questWriter: false, shopOwner: false, ...extra })
const mount = () => render(<MemoryRouter initialEntries={['/equipe?onglet=souk']}><Staff /></MemoryRouter>)

beforeEach(() => {
  for (const m of [getMyStaffAccess, listSoukSubmissions, reviewSoukSubmission]) m.mockReset()
  getMyStaffAccess.mockResolvedValue(access())
  listSoukSubmissions.mockResolvedValue([sub()])
  reviewSoukSubmission.mockResolvedValue('item1')
})

describe('Staff Souk review', () => {
  it('shows the submission as plain text, with its settings', async () => {
    mount()
    expect(await screen.findByText('<i>beau</i>')).toBeInTheDocument()
    expect(screen.getByText('#C9A227')).toBeInTheDocument()
    expect(document.querySelector('i')).toBeNull()
  })

  it('is closed to members without a shop role', async () => {
    getMyStaffAccess.mockResolvedValue(access({ shopManager: false }))
    mount()
    expect(await screen.findByText(/réservée à l'équipe/)).toBeInTheDocument()
    expect(listSoukSubmissions).not.toHaveBeenCalled()
  })

  it('is open to the shop owner and to an admin', async () => {
    getMyStaffAccess.mockResolvedValue(access({ shopManager: false, shopOwner: true }))
    mount()
    expect(await screen.findByText('Sahel doré')).toBeInTheDocument()
  })

  it('approves at the proposed price by default', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByLabelText('Accepter : Sahel doré'))
    await waitFor(() => expect(reviewSoukSubmission).toHaveBeenCalledWith('s1', true, '', 300))
    expect(await screen.findByText('Décision enregistrée.')).toBeInTheDocument()
  })

  it('approves at a changed price', async () => {
    const user = userEvent.setup()
    mount()
    const price = await screen.findByLabelText(/Prix de vente/)
    await user.clear(price)
    await user.type(price, '450')
    await user.click(screen.getByLabelText('Accepter : Sahel doré'))
    await waitFor(() => expect(reviewSoukSubmission).toHaveBeenCalledWith('s1', true, '', 450))
  })

  it('needs a reason before a refusal, and sends no price', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByLabelText('Refuser : Sahel doré'))
    const confirm = screen.getByText('Confirmer le refus')
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Note pour le créateur'), 'Couleurs illisibles')
    await user.click(confirm)
    await waitFor(() => expect(reviewSoukSubmission).toHaveBeenCalledWith('s1', false, 'Couleurs illisibles', null))
  })

  it('offers no decision on my own submission', async () => {
    listSoukSubmissions.mockResolvedValue([sub({ creator_id: 'me' })])
    mount()
    expect(await screen.findByText(/propre création/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Accepter : Sahel doré')).not.toBeInTheDocument()
  })

  it('shows a friendly message when the database refuses', async () => {
    reviewSoukSubmission.mockRejectedValue(new Error('This submission has already been handled'))
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByLabelText('Accepter : Sahel doré'))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà été traitée')
  })
})
