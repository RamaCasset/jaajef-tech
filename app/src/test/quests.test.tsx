import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestSummary } from '../lib/api'

const listQuests = vi.fn()
const listMyQuestProgress = vi.fn()

vi.mock('../lib/api', () => ({
  listQuests: (...a: unknown[]) => listQuests(...a),
  listMyQuestProgress: (...a: unknown[]) => listMyQuestProgress(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'u1', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Quests } from '../pages/Quests'

const quest = (n: number, extra: Partial<QuestSummary> = {}): QuestSummary => ({
  id: `q${n}`, slug: `quete-${n}`, title: `Quête ${n}`, summary: `Résumé ${n}`, clan: 'griot_du_code', mastery: 'ndongo',
  language: 'python', topic: 'Boucles', est_minutes: 10, xp_reward: 250, kopek_reward: 50, daily_on: null, ...extra,
})
const lastFilters = () => listQuests.mock.calls[listQuests.mock.calls.length - 1][0] as Record<string, unknown>
const mount = () => render(<MemoryRouter><Quests /></MemoryRouter>)

beforeEach(() => {
  listQuests.mockReset()
  listMyQuestProgress.mockReset()
  listQuests.mockResolvedValue([quest(1), quest(2, { daily_on: '2026-11-06', kopek_reward: 0, language: 'javascript' }), quest(3)])
  listMyQuestProgress.mockResolvedValue([
    { quest_id: 'q1', status: 'solved', tests_passed: 3, tests_total: 3 },
    { quest_id: 'q3', status: 'in_progress', tests_passed: 1, tests_total: 3 },
  ])
})

describe('Quests page', () => {
  it('lists quests with clan, level, language, time and reward', async () => {
    mount()
    expect(await screen.findByText('Quête 1')).toBeInTheDocument()
    expect(screen.getByText('3 quêtes')).toBeInTheDocument()
    expect(screen.getAllByText('+250 XP · +50 Kopeks').length).toBe(2)
    expect(screen.getByText('+250 XP')).toBeInTheDocument()
    expect(screen.getAllByText(/10 min/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(/· Quête du jour/)).toBeInTheDocument()
    expect(screen.getAllByText(/^Griot du Code/).length).toBeGreaterThanOrEqual(3)
  })

  it('shows solved and in-progress marks only on the right quests', async () => {
    mount()
    await screen.findByText('Quête 1')
    expect(screen.getAllByText('Résolue').length).toBe(1)
    expect(screen.getByText('En cours (1/3)')).toBeInTheDocument()
    expect(screen.getAllByText('Disponible').length).toBe(1)
    expect(screen.getAllByRole('link', { name: /^Ouvrir/ }).map((a) => a.textContent).sort()).toEqual(['Lancer la quête', 'Reprendre', 'Revoir'])
  })

  it('sends the chosen filters to the database', async () => {
    mount()
    await screen.findByText('Quête 1')
    await userEvent.click(within(screen.getByRole('group', { name: 'Clan' })).getByRole('button', { name: 'Saltigué' }))
    await waitFor(() => expect(lastFilters().clan).toBe('saltigue'))
    await userEvent.selectOptions(screen.getByLabelText('Langage'), 'javascript')
    await waitFor(() => expect(lastFilters().language).toBe('javascript'))
    await userEvent.selectOptions(screen.getByLabelText('Niveau'), 'bagne')
    await waitFor(() => expect(lastFilters().mastery).toBe('bagne'))
  })

  it('splits the list into all, in progress and completed, with counts', async () => {
    mount()
    await screen.findByText('Quête 1')
    expect(screen.getByRole('tab', { name: /Toutes les quêtes\s*3/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /En cours\s*1/ }))
    expect(screen.getByText('Quête 3')).toBeInTheDocument()
    expect(screen.queryByText('Quête 1')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: /Terminées\s*1/ }))
    expect(screen.getByText('Quête 1')).toBeInTheDocument()
    expect(screen.queryByText('Quête 3')).toBeNull()
  })

  it('greets the member by first name', async () => {
    mount()
    expect(await screen.findByRole('heading', { level: 1, name: 'Une petite quête, Moussa ?' })).toBeInTheDocument()
  })

  it('waits for the typing to pause before searching', async () => {
    mount()
    await screen.findByText('Quête 1')
    const before = listQuests.mock.calls.length
    await userEvent.type(screen.getByRole('searchbox'), 'boucle', { delay: 60 })
    await waitFor(() => expect(lastFilters().query).toBe('boucle'))
    const queries = listQuests.mock.calls.slice(before).map((c) => (c[0] as { query: string }).query)
    expect(queries).toEqual(['boucle'])
  })

  it('clears the filters with the reset button', async () => {
    mount()
    await screen.findByText('Quête 1')
    await userEvent.click(within(screen.getByRole('group', { name: 'Clan' })).getByRole('button', { name: 'Forgeron' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Réinitialiser' }))
    await waitFor(() => expect(lastFilters().clan).toBe(''))
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).toBeNull()
  })

  it('says so when nothing matches', async () => {
    listQuests.mockResolvedValue([])
    mount()
    expect(await screen.findByText("Aucune quête ne correspond pour l'instant.")).toBeInTheDocument()
  })

  it('offers a retry that loads again after a failure', async () => {
    listQuests.mockRejectedValueOnce(new Error('boom'))
    mount()
    expect(await screen.findByText(/Impossible de charger les quêtes/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Quête 1')).toBeInTheDocument()
  })

  it('links each quest to its own page', async () => {
    mount()
    await screen.findByText('Quête 1')
    expect(screen.getByRole('link', { name: 'Ouvrir : Quête 2' })).toHaveAttribute('href', '/quetes/quete-2')
  })
})
