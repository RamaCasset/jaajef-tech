import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getDailyQuest: vi.fn(), listPastDailyQuests: vi.fn(), listQuests: vi.fn(), listMyQuestProgress: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Arena } from '../pages/Arena'

const today = (status: string | null) => ({ quest_id: 't', slug: 'du-jour', title: 'Quête du jour', status })
const past = (n: number, status: string | null) => ({
  day: `2026-11-0${n}`, quest_id: `p${n}`, slug: `passee-${n}`, title: `Passée ${n}`, clan: 'saltigue', mastery: 'ndongo', language: 'python', est_minutes: 5, status,
})
const quest = (id: string) => ({ id, slug: `q-${id}`, title: `Quête ${id}`, summary: null, clan: 'saltigue', mastery: 'ndongo', language: 'python', topic: null, est_minutes: 5, xp_reward: 1, kopek_reward: 1, daily_on: null })
const mount = () => render(<MemoryRouter><Arena /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  api.getDailyQuest.mockResolvedValue(today(null))
  api.listPastDailyQuests.mockResolvedValue([])
  api.listQuests.mockResolvedValue([])
  api.listMyQuestProgress.mockResolvedValue([])
})

describe('Arena', () => {
  it('shows the quest of the day with a start button', async () => {
    mount()
    expect(await screen.findByText('Quête du jour')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Commencer' })).toHaveAttribute('href', '/quetes/du-jour')
  })

  it('offers to resume or review depending on progress', async () => {
    api.getDailyQuest.mockResolvedValue(today('in_progress'))
    const { unmount } = mount()
    expect(await screen.findByRole('link', { name: 'Reprendre' })).toBeInTheDocument()
    unmount()
    api.getDailyQuest.mockResolvedValue(today('solved'))
    mount()
    expect(await screen.findByRole('link', { name: 'Revoir' })).toBeInTheDocument()
  })

  it('says when there is no quest today', async () => {
    api.getDailyQuest.mockResolvedValue(null)
    mount()
    expect(await screen.findByText("Pas de quête aujourd'hui.")).toBeInTheDocument()
  })

  it('lists the past days with the right status and link', async () => {
    api.listPastDailyQuests.mockResolvedValue([past(3, 'solved'), past(2, null), past(1, 'in_progress')])
    mount()
    await screen.findByText('Les jours passés')
    expect(screen.getByRole('link', { name: 'Refaire : Passée 3' })).toHaveAttribute('href', '/quetes/passee-3')
    expect(screen.getByRole('link', { name: 'Ouvrir : Passée 2' })).toHaveAttribute('href', '/quetes/passee-2')
    const list = within(screen.getByRole('region', { name: 'Les jours passés' }))
    const row = (name: string) => list.getByRole('link', { name: new RegExp(name) }).closest('li') as HTMLElement
    expect(within(row('Passée 3')).getByText('Faite')).toBeInTheDocument()
    expect(within(row('Passée 2')).getByText('À faire')).toBeInTheDocument()
    expect(within(row('Passée 1')).getByText('En cours')).toBeInTheDocument()
  })

  it('lists only the quests the member solved, with a redo link', async () => {
    api.listQuests.mockResolvedValue([quest('a'), quest('b'), quest('c')])
    api.listMyQuestProgress.mockResolvedValue([
      { quest_id: 'a', status: 'solved', tests_passed: 1, tests_total: 1 },
      { quest_id: 'b', status: 'in_progress', tests_passed: 0, tests_total: 1 },
    ])
    mount()
    expect(await screen.findByRole('link', { name: 'Refaire : Quête a' })).toHaveAttribute('href', '/quetes/q-a')
    expect(screen.queryByRole('link', { name: 'Refaire : Quête b' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Refaire : Quête c' })).toBeNull()
  })

  it('states the points rule', async () => {
    mount()
    expect(await screen.findByText(/Seule la quête du jour rapporte des points/)).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    api.listPastDailyQuests.mockRejectedValueOnce(new Error('boom'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(screen.getByText('Quête du jour')).toBeInTheDocument())
  })
})
