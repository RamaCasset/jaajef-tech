import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadMyProfileFields = vi.fn()
const listMyCommunities = vi.fn()
const listMyQuestProgress = vi.fn()
const listDiscoverCommunities = vi.fn()

vi.mock('../lib/api', () => ({
  loadMyProfileFields: (...a: unknown[]) => loadMyProfileFields(...a),
  listMyCommunities: (...a: unknown[]) => listMyCommunities(...a),
  listMyQuestProgress: (...a: unknown[]) => listMyQuestProgress(...a),
  listDiscoverCommunities: (...a: unknown[]) => listDiscoverCommunities(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'u1', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { LaCite } from '../pages/LaCite'

const comm = (n: number, extra: Record<string, unknown> = {}) => ({ id: `c${n}`, slug: `comm-${n}`, name: `Comm ${n}`, description: `Texte ${n}`, is_private: false, is_listed: true, owner_id: 'o', ...extra })
const mount = () => render(<MemoryRouter><LaCite /></MemoryRouter>)

beforeEach(() => {
  loadMyProfileFields.mockReset().mockResolvedValue({ bio: '' })
  listMyCommunities.mockReset().mockResolvedValue([])
  listMyQuestProgress.mockReset().mockResolvedValue([])
  listDiscoverCommunities.mockReset().mockResolvedValue([comm(1), comm(2), comm(3), comm(4), comm(5, { project_id: 'p' })])
})

describe('La Cité welcome page', () => {
  it('welcomes the member, links the three places and shows three communities', async () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Bienvenue.*dans La Cité\./)
    expect(screen.getByRole('link', { name: /Explorer les projets/ })).toHaveAttribute('href', '/projets')
    expect(screen.getByRole('link', { name: /Découvrir les quêtes/ })).toHaveAttribute('href', '/quetes')
    expect(screen.getByRole('link', { name: /Visiter le Souk/ })).toHaveAttribute('href', '/souk')
    expect(await screen.findByText('Comm 3')).toBeInTheDocument()
    expect(screen.queryByText('Comm 4')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Découvrir : Comm 1' })).toHaveAttribute('href', '/communautes/comm-1')
  })

  it('starts at 0 of 3 first steps and counts each one that is done', async () => {
    const { unmount } = mount()
    const bar = await screen.findByRole('progressbar', { name: 'Vos premiers pas' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    unmount()
    loadMyProfileFields.mockResolvedValue({ bio: 'Dev à Dakar' })
    listMyCommunities.mockResolvedValue([{ ...comm(1), role: 'member' }])
    listMyQuestProgress.mockResolvedValue([{ quest_id: 'q1', status: 'in_progress', tests_passed: 0, tests_total: 3 }])
    mount()
    const done = await screen.findByRole('progressbar', { name: 'Vos premiers pas' })
    await vi.waitFor(() => expect(done).toHaveAttribute('aria-valuenow', '3'))
    expect(within(screen.getByRole('region', { name: 'Vos premiers pas' })).getAllByText('Fait')).toHaveLength(3)
  })

  it('a project room does not count as finding a community', async () => {
    listMyCommunities.mockResolvedValue([{ ...comm(9, { project_id: 'p' }), role: 'owner' }])
    mount()
    const bar = await screen.findByRole('progressbar', { name: 'Vos premiers pas' })
    await new Promise((r) => setTimeout(r, 30))
    expect(bar).toHaveAttribute('aria-valuenow', '0')
  })
})
