import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoukItem } from '../lib/api'

const soukShop = vi.fn()
const buyItem = vi.fn()
const equipItem = vi.fn()
const unequipItem = vi.fn()
const myEquippedIds = vi.fn()
const refreshMember = vi.fn()

vi.mock('../lib/api', () => ({
  soukShop: (...a: unknown[]) => soukShop(...a),
  buyItem: (...a: unknown[]) => buyItem(...a),
  equipItem: (...a: unknown[]) => equipItem(...a),
  unequipItem: (...a: unknown[]) => unequipItem(...a),
  myEquippedIds: (...a: unknown[]) => myEquippedIds(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1' } },
    member: { kopeks: 100, profile: { display_name: 'Moussa Diop' } },
    signOut: vi.fn(),
    refreshMember: () => refreshMember(),
  }),
}))

import { Souk } from '../pages/Souk'

const item = (n: number, extra: Partial<SoukItem> = {}): SoukItem => ({
  id: `i${n}`, slug: `s${n}`, kind: 'theme', name: `Thème ${n}`, description: null, price_kopeks: 100 * n,
  data: { accent: '#C9A227' }, avg_rating: null, rating_count: 0, owned: false, my_rating: null, created_at: '2026-01-01', ...extra,
})

const mount = () => render(<MemoryRouter><Souk /></MemoryRouter>)

beforeEach(() => {
  for (const m of [soukShop, buyItem, equipItem, unequipItem, myEquippedIds, refreshMember]) m.mockReset()
  soukShop.mockResolvedValue([item(1), item(2, { owned: true }), item(3, { owned: true, avg_rating: 4.9 })])
  myEquippedIds.mockResolvedValue(['i3'])
  buyItem.mockResolvedValue(undefined)
  equipItem.mockResolvedValue(undefined)
  unequipItem.mockResolvedValue(undefined)
})

describe('Souk page', () => {
  it('shows each item with the right button: buy, equip or remove', async () => {
    mount()
    expect(await screen.findByText('Thème 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Acheter Thème 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Équiper Thème 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retirer Thème 3' })).toBeInTheDocument()
    expect(screen.getByText('★ 4.9')).toBeInTheDocument()
    expect(screen.getByText('3 créations')).toBeInTheDocument()
    expect(soukShop).toHaveBeenCalledWith('theme', 'new')
  })

  it('buys an item, then refreshes the list and the Kopeks balance', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Acheter Thème 1' }))
    await waitFor(() => expect(buyItem).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(refreshMember).toHaveBeenCalled())
    expect(await screen.findByText('Thème 1 est à toi.')).toBeInTheDocument()
    expect(soukShop.mock.calls.length).toBeGreaterThan(1)
  })

  it('shows a plain message when there are not enough Kopeks', async () => {
    buyItem.mockRejectedValue(new Error('Not enough Kopeks'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Acheter Thème 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Il te manque des Kopeks')
    expect(refreshMember).not.toHaveBeenCalled()
  })

  it('equips and unequips', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Équiper Thème 2' }))
    await waitFor(() => expect(equipItem).toHaveBeenCalledWith('i2'))
    await userEvent.click(screen.getByRole('button', { name: 'Retirer Thème 3' }))
    await waitFor(() => expect(unequipItem).toHaveBeenCalledWith('theme'))
  })

  it('switches category and sort', async () => {
    mount()
    await screen.findByText('Thème 1')
    await userEvent.click(screen.getByRole('tab', { name: 'Cadres animés' }))
    await waitFor(() => expect(soukShop).toHaveBeenCalledWith('avatar_frame', 'new'))
    await userEvent.selectOptions(screen.getByLabelText('Trier par'), 'price_asc')
    await waitFor(() => expect(soukShop).toHaveBeenCalledWith('avatar_frame', 'price_asc'))
  })

  it('shows the empty state and the error state with retry', async () => {
    soukShop.mockResolvedValueOnce([])
    const { unmount } = mount()
    expect(await screen.findByText(/Rien à vendre/)).toBeInTheDocument()
    unmount()
    soukShop.mockRejectedValueOnce(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Thème 1')).toBeInTheDocument()
  })
})
