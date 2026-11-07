import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listMySoukSubmissions: vi.fn(), submitSoukItem: vi.fn(), withdrawSoukSubmission: vi.fn(), myCreatorSummary: vi.fn(), listMySales: vi.fn() }))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { SoukSell } from '../pages/SoukSell'

const sub = (id: string, status: string, extra = {}) => ({ id, kind: 'theme', name: `Création ${id}`, description: null, data: { accent: '#fff' }, proposed_price: 150, status, review_note: null, created_at: '2026-11-01', ...extra })
const mount = () => render(<MemoryRouter><SoukSell /></MemoryRouter>)

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.myCreatorSummary.mockResolvedValue({ items_on_sale: 2, sales_count: 5, kopeks_earned: 400, share_percent: 70 })
  api.listMySoukSubmissions.mockResolvedValue([sub('a', 'pending'), sub('b', 'rejected', { review_note: 'Trop proche d\'un autre' }), sub('c', 'approved')])
  api.listMySales.mockResolvedValue([{ id: 1, item_name: 'Sable', price: 150, share_percent: 70, amount: 105, sold_at: '2026-11-02T00:00:00Z' }])
  api.submitSoukItem.mockResolvedValue('new')
  api.withdrawSoukSubmission.mockResolvedValue(undefined)
})

describe('Selling in the Souk', () => {
  it('shows my numbers, my proposals with their state, and my sales', async () => {
    mount()
    expect(await screen.findByText(/2 en vente · 5 vendues · 400 Kopeks gagnés/)).toBeInTheDocument()
    expect(screen.getByText(/Vous touchez 70 %/)).toBeInTheDocument()
    expect(screen.getByText('En relecture')).toBeInTheDocument()
    expect(screen.getByText('Refusée')).toBeInTheDocument()
    expect(screen.getByText(/Note de l'équipe : Trop proche/)).toBeInTheDocument()
    expect(screen.getByText(/Sable · 150 Kopeks → 105 Kopeks/)).toBeInTheDocument()
  })

  it('only a waiting proposal can be withdrawn', async () => {
    mount()
    const buttons = await screen.findAllByRole('button', { name: /^Retirer/ })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    expect(api.withdrawSoukSubmission).toHaveBeenCalledWith('a')
  })

  it('the send button needs a name, a look and a whole price of at least 1', async () => {
    mount()
    const send = await screen.findByRole('button', { name: 'Envoyer pour relecture' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nom'), 'Sable doré')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '200')
    expect(send).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Prix en Kopeks'))
    await userEvent.type(screen.getByLabelText(/Couleur principale/), '#C9A227')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '0')
    expect(send).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Prix en Kopeks'))
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '2.5')
    expect(send).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Prix en Kopeks'))
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '200')
    expect(send).toBeEnabled()
  })

  it('sends the look in the shape of the chosen kind', async () => {
    mount()
    await screen.findByRole('button', { name: 'Envoyer pour relecture' })
    await userEvent.type(screen.getByLabelText('Nom'), 'Sable')
    await userEvent.type(screen.getByLabelText(/Couleur principale/), ' #C9A227 ')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '150')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer pour relecture' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Création envoyée')
    expect(api.submitSoukItem).toHaveBeenLastCalledWith('theme', 'Sable', '', { accent: '#C9A227' }, 150)
    expect(screen.getByLabelText('Nom')).toHaveValue('')

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'avatar_frame')
    await userEvent.type(screen.getByLabelText('Nom'), 'Cadre')
    await userEvent.type(screen.getByLabelText(/Couleur du cadre/), '#FFD700')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer pour relecture' }))
    await waitFor(() => expect(api.submitSoukItem).toHaveBeenLastCalledWith('avatar_frame', 'Cadre', '', { color: '#FFD700' }, 300))

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'status_badge')
    await userEvent.type(screen.getByLabelText('Nom'), 'Mentor')
    await userEvent.type(screen.getByLabelText('Texte du badge'), 'Mentor')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '250')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer pour relecture' }))
    await waitFor(() => expect(api.submitSoukItem).toHaveBeenLastCalledWith('status_badge', 'Mentor', '', { label: 'Mentor' }, 250))
  })

  it('shows a refusal in French and keeps what was typed', async () => {
    api.submitSoukItem.mockRejectedValue(new Error('You are submitting too fast, try again later'))
    mount()
    await screen.findByRole('button', { name: 'Envoyer pour relecture' })
    await userEvent.type(screen.getByLabelText('Nom'), 'Sable')
    await userEvent.type(screen.getByLabelText(/Couleur principale/), '#fff')
    await userEvent.type(screen.getByLabelText('Prix en Kopeks'), '150')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer pour relecture' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('trop vite')
    expect(screen.getByLabelText('Nom')).toHaveValue('Sable')
  })

  it('offers a retry when the page cannot load', async () => {
    api.myCreatorSummary.mockRejectedValueOnce(new Error('down'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText(/2 en vente/)).toBeInTheDocument()
  })
})
