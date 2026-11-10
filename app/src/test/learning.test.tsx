import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningPath as Path, LearningStep } from '../lib/api'

const listLearningPaths = vi.fn()
const listLearningSteps = vi.fn()
const markStepRead = vi.fn()

vi.mock('../lib/api', () => ({
  listLearningPaths: (...a: unknown[]) => listLearningPaths(...a),
  listLearningSteps: (...a: unknown[]) => listLearningSteps(...a),
  markStepRead: (...a: unknown[]) => markStepRead(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'u1', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { LearningPaths } from '../pages/LearningPaths'
import { LearningPath } from '../pages/LearningPath'

const path = (n: number, extra: Partial<Path> = {}): Path => ({
  id: `p${n}`, slug: `parcours-${n}`, clan: 'griot_du_code', title: `Parcours ${n}`, summary: `Résumé ${n}`, steps_total: 3, steps_done: 0, ...extra,
})
const step = (n: number, extra: Partial<LearningStep> = {}): LearningStep => ({
  id: `s${n}`, step_no: n, title: `Étape ${n}`, lesson_md: `Leçon ${n}`, mastery: 'ndongo', est_minutes: 10,
  quest_slug: null, quest_title: null, quest_xp: null, quest_kopeks: null, quest_status: null, done: false, ...extra,
})

beforeEach(() => {
  listLearningPaths.mockReset()
  listLearningSteps.mockReset()
  markStepRead.mockReset()
})

describe('Learning paths page', () => {
  const mount = () => render(<MemoryRouter><LearningPaths /></MemoryRouter>)

  it('shows each path with its progress and the right button', async () => {
    listLearningPaths.mockResolvedValue([path(1), path(2, { steps_done: 1, clan: 'forgeron' }), path(3, { steps_done: 3, clan: 'saltigue' })])
    mount()
    expect(await screen.findByText('Parcours 1')).toBeInTheDocument()
    expect(screen.getByText('0 sur 3 étapes')).toBeInTheDocument()
    expect(screen.getByText('1 sur 3 étapes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Commencer : Parcours 1' })).toHaveAttribute('href', '/parcours/parcours-1')
    expect(screen.getByRole('link', { name: 'Continuer : Parcours 2' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revoir : Parcours 3' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Parcours 2' })).toHaveAttribute('aria-valuenow', '33')
  })

  it('says so when there is no path yet, and offers a retry on failure', async () => {
    listLearningPaths.mockResolvedValueOnce([])
    const { unmount } = mount()
    expect(await screen.findByText('Les parcours arrivent bientôt.')).toBeInTheDocument()
    unmount()
    listLearningPaths.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([path(1)])
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les parcours.')
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Parcours 1')).toBeInTheDocument()
  })
})

describe('Learning path page', () => {
  const mount = () => render(
    <MemoryRouter initialEntries={['/parcours/parcours-1']}>
      <Routes><Route path="/parcours/:slug" element={<LearningPath />} /></Routes>
    </MemoryRouter>,
  )

  it('opens on the first step to do and links a quest step to its quest', async () => {
    listLearningPaths.mockResolvedValue([path(1)])
    listLearningSteps.mockResolvedValue([
      step(1, { done: true }),
      step(2, { quest_slug: 'boucle', quest_title: 'La boucle', quest_xp: 250, quest_kopeks: 50 }),
      step(3),
    ])
    mount()
    expect(await screen.findByText('Leçon 2')).toBeInTheDocument()
    expect(screen.getByText('1 sur 3 étapes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lancer la quête/ })).toHaveAttribute('href', '/quetes/boucle')
    expect(screen.queryByRole('button', { name: "J'ai lu" })).not.toBeInTheDocument()
  })

  it('marks a lesson as read and moves to the next step', async () => {
    listLearningPaths.mockResolvedValue([path(1)])
    listLearningSteps.mockResolvedValue([step(1), step(2)])
    markStepRead.mockResolvedValue(undefined)
    mount()
    expect(await screen.findByText('Leçon 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "J'ai lu" }))
    expect(markStepRead).toHaveBeenCalledWith('s1')
    expect(await screen.findByText('Leçon 2')).toBeInTheDocument()
    expect(screen.getByText('1 sur 2 étapes')).toBeInTheDocument()
  })

  it('lets the member pick any step, and tells when a save fails', async () => {
    listLearningPaths.mockResolvedValue([path(1)])
    listLearningSteps.mockResolvedValue([step(1), step(2)])
    markStepRead.mockRejectedValue(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /Étape 2/ }))
    expect(screen.getByText('Leçon 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "J'ai lu" }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Impossible d'enregistrer"))
    expect(screen.getByText('Leçon 2')).toBeInTheDocument()
  })

  it('shows a message when the path does not exist', async () => {
    listLearningPaths.mockResolvedValue([])
    listLearningSteps.mockResolvedValue([])
    mount()
    expect(await screen.findByText("Ce parcours n'existe pas.")).toBeInTheDocument()
  })
})
