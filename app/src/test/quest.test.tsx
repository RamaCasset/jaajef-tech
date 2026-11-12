import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestDetail, RunOutcome } from '../lib/api'

const getQuest = vi.fn()
const startQuest = vi.fn()
const getUnlockedHints = vi.fn()
const revealHint = vi.fn()
const getExplanation = vi.fn()
const saveDraft = vi.fn()
const runQuest = vi.fn()
const refreshMember = vi.fn()

vi.mock('../lib/api', () => ({
  getQuest: (...a: unknown[]) => getQuest(...a),
  startQuest: (...a: unknown[]) => startQuest(...a),
  getUnlockedHints: (...a: unknown[]) => getUnlockedHints(...a),
  revealHint: (...a: unknown[]) => revealHint(...a),
  getExplanation: (...a: unknown[]) => getExplanation(...a),
  saveDraft: (...a: unknown[]) => saveDraft(...a),
  runQuest: (...a: unknown[]) => runQuest(...a),
  RunError: class RunError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  },
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'u1', display_name: 'Moussa' } }, signOut: vi.fn(), refreshMember }),
}))

import { RunError } from '../lib/api'
vi.mock('../components/CodeEditor', () => ({
  // Monaco needs a real browser, so a plain text box stands in for it.
  CodeEditor: ({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) => <textarea aria-label="Votre code" value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />,
}))
import { Quest } from '../pages/Quest'

const quest: QuestDetail = {
  id: 'q1', slug: 'somme-liste', title: 'Somme d’une liste', summary: 'Additionner', clan: 'griot_du_code', mastery: 'ndongo', language: 'python',
  topic: 'Boucles', est_minutes: 10, xp_reward: 250, kopek_reward: 50, daily_on: null,
  statement_md: 'Écrivez une fonction somme(liste).', starter_code: 'def somme(liste):\n    pass\n', min_seconds: 15,
}
const failing: RunOutcome = {
  solved: false, reason: 'tests_not_passed', tests_passed: 1, tests_total: 2,
  tests: [{ name: 'liste vide', passed: true }, { name: 'liste simple', passed: false, message: 'résultat inattendu' }],
}
const winning: RunOutcome = {
  solved: true, already_solved: false, tests_passed: 2, tests_total: 2, xp: 250, kopeks: 50, streak_days: 3, duration_ms: 42000, daily_quest: false,
  tests: [{ name: 'liste vide', passed: true }, { name: 'liste simple', passed: true }],
}
const mount = () => render(
  <MemoryRouter initialEntries={['/quetes/somme-liste']}>
    <Routes><Route path="/quetes/:slug" element={<Quest />} /><Route path="/quetes" element={<p>liste des quêtes</p>} /></Routes>
  </MemoryRouter>,
)
const editor = () => screen.getByLabelText('Votre code') as HTMLTextAreaElement

beforeEach(() => {
  for (const m of [getQuest, startQuest, getUnlockedHints, revealHint, getExplanation, saveDraft, runQuest, refreshMember]) m.mockReset()
  getQuest.mockResolvedValue(quest)
  startQuest.mockResolvedValue({ status: 'in_progress', code: null, tests_passed: 0, tests_total: 0, started_at: '2026-11-06T10:00:00Z' })
  getUnlockedHints.mockResolvedValue([])
  getExplanation.mockResolvedValue('On parcourt la liste et on additionne.')
  saveDraft.mockResolvedValue(undefined)
})

describe('Quest page', () => {
  it('shows the statement and puts the starter code in the editor', async () => {
    mount()
    expect(await screen.findByText('Somme d’une liste')).toBeInTheDocument()
    expect(screen.getByText('Écrivez une fonction somme(liste).')).toBeInTheDocument()
    expect(editor().value).toBe('def somme(liste):\n    pass\n')
    expect(startQuest).toHaveBeenCalledWith('q1')
    expect(screen.queryByText('On parcourt la liste et on additionne.')).toBeNull()
  })

  it('brings back the code the member saved earlier', async () => {
    startQuest.mockResolvedValue({ status: 'in_progress', code: 'def somme(l): return sum(l)', tests_passed: 1, tests_total: 2, started_at: 'x' })
    mount()
    await screen.findByText('Somme d’une liste')
    expect(editor().value).toBe('def somme(l): return sum(l)')
  })

  it('has the run button in the editor header and scrolls to the terminal when it is pressed', async () => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    runQuest.mockResolvedValue(failing)
    mount()
    await screen.findByText('Somme d’une liste')
    const header = screen.getByText('solution.py').closest('header') as HTMLElement
    await userEvent.click(within(header).getByRole('button', { name: 'Lancer les tests' }))
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true')
  })

  it('sends the typed code to be graded and lists each test', async () => {
    runQuest.mockResolvedValue(failing)
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.clear(editor())
    await userEvent.type(editor(), 'x = 1')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    await waitFor(() => expect(runQuest).toHaveBeenCalledWith('q1', 'x = 1'))
    expect(await screen.findByText('1 échoué(s), 1 réussi(s)')).toBeInTheDocument()
    expect(screen.getByText('résultat inattendu')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Résultats' }))
    expect(await screen.findByText('1 sur 2 tests réussis')).toBeInTheDocument()
    expect(screen.getByText('liste simple')).toBeInTheDocument()
    expect(screen.getByText('résultat inattendu')).toBeInTheDocument()
    expect(screen.getAllByText('Réussi').length).toBe(1)
    expect(screen.getAllByText('Échoué').length).toBe(1)
    expect(screen.queryByText('Quête résolue !')).toBeNull()
    expect(refreshMember).not.toHaveBeenCalled()
  })

  it('celebrates a solve, keeps the editor open for practice, opens the explanation and refreshes the wallet', async () => {
    runQuest.mockResolvedValue(winning)
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText('Quête résolue !')).toBeInTheDocument()
    expect(screen.getByText('+250 XP et +50 Kopeks')).toBeInTheDocument()
    expect(screen.getByText('Série : 3 jours')).toBeInTheDocument()
    expect(screen.getByText('Temps : 42 s')).toBeInTheDocument()
    expect(editor().readOnly).toBe(false)
    expect(screen.getByRole('button', { name: 'Lancer les tests' })).toBeEnabled()
    expect(await screen.findByText('On parcourt la liste et on additionne.')).toBeInTheDocument()
    expect(refreshMember).toHaveBeenCalled()
  })

  it('says a practice solve earns no points and shows no reward', async () => {
    runQuest.mockResolvedValue({ ...winning, rewarded: false, xp: 0, kopeks: 0, streak_days: undefined })
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText(/ne rapporte ni XP ni Kopeks/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Quête résolue !' })).queryByText(/^\+\d+ XP/)).toBeNull()
  })

  it('shows the daily bonus only when the quest was the quest of the day', async () => {
    runQuest.mockResolvedValue({ ...winning, daily_quest: true, bonus_xp: 20, bonus_kopeks: 5 })
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText('Bonus quête du jour : +20 XP, +5 Kopeks')).toBeInTheDocument()
  })

  it('opens an already solved quest for practice, with its explanation and no hint button', async () => {
    startQuest.mockResolvedValue({ status: 'solved', code: 'def somme(l): return sum(l)', tests_passed: 2, tests_total: 2, started_at: 'x' })
    mount()
    expect(await screen.findByText('Vous avez déjà résolu cette quête.')).toBeInTheDocument()
    expect(editor().readOnly).toBe(false)
    expect(await screen.findByText('On parcourt la liste et on additionne.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demander un indice' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Lancer les tests' })).toBeEnabled()
  })

  it('explains when every test passes but the solve came too fast', async () => {
    runQuest.mockResolvedValue({ ...failing, reason: 'too_fast', min_seconds: 15, tests_passed: 2, tests_total: 2 })
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText(/au moins 15 secondes/)).toBeInTheDocument()
    expect(screen.queryByText('Quête résolue !')).toBeNull()
  })

  it('keeps the code and says so when the grading service is down', async () => {
    runQuest.mockRejectedValue(new RunError('runner_unavailable'))
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText(/correction automatique n'est pas disponible/)).toBeInTheDocument()
    expect(editor().value).toBe('def somme(liste):\n    pass\n')
    expect(screen.getByRole('button', { name: 'Lancer les tests' })).toBeEnabled()
  })

  it('tells the member to wait when there were too many runs', async () => {
    runQuest.mockRejectedValue(new RunError('too_many_runs'))
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
    expect(await screen.findByText(/Trop d’essais/)).toBeInTheDocument()
  })

  it('does not allow running an empty editor', async () => {
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.clear(editor())
    expect(screen.getByRole('button', { name: 'Lancer les tests' })).toBeDisabled()
  })

  it('saves a draft with the code and the tests passed so far', async () => {
    startQuest.mockResolvedValue({ status: 'in_progress', code: 'abc', tests_passed: 1, tests_total: 2, started_at: 'x' })
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('q1', 'abc', 1))
    expect(await screen.findByText('Brouillon enregistré.')).toBeInTheDocument()
  })

  it('reveals hints one at a time and says when there are no more', async () => {
    getUnlockedHints.mockResolvedValue([{ level: 1, body: 'Pensez à une boucle.' }])
    revealHint.mockResolvedValueOnce({ level: 2, body: 'Gardez un total.', hints_used: 2, hints_total: 2 })
    revealHint.mockResolvedValueOnce({ no_more_hints: true, hints_used: 2, hints_total: 2 })
    mount()
    expect(await screen.findByText('Pensez à une boucle.')).toBeInTheDocument()
    expect(screen.getByText('1 indice utilisé')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Demander un indice' }))
    expect(await screen.findByText('Gardez un total.')).toBeInTheDocument()
    expect(screen.getByText('2 indices utilisés')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Demander un indice' }))
    expect(await screen.findByText("Il n'y a plus d'indice pour cette quête.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Demander un indice' })).toBeDisabled()
  })

  it('says so when the quest does not exist', async () => {
    getQuest.mockResolvedValue(null)
    mount()
    expect(await screen.findByText("Cette quête n'existe pas ou n'est plus disponible.")).toBeInTheDocument()
    expect(startQuest).not.toHaveBeenCalled()
  })

  it('offers a retry when loading fails', async () => {
    getQuest.mockRejectedValueOnce(new Error('boom'))
    mount()
    expect(await screen.findByText(/Impossible de charger cette quête/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Somme d’une liste')).toBeInTheDocument()
  })

  it('goes back to the list of quests', async () => {
    mount()
    await screen.findByText('Somme d’une liste')
    await userEvent.click(screen.getByRole('link', { name: 'Toutes les quêtes' }))
    expect(await screen.findByText('liste des quêtes')).toBeInTheDocument()
  })
})
