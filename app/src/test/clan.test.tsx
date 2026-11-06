import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setCharacter = vi.fn()
const setOnboardingStep = vi.fn()
const refreshMember = vi.fn()

vi.mock('../lib/api', () => ({
  setCharacter: (...a: unknown[]) => setCharacter(...a),
  setOnboardingStep: (...a: unknown[]) => setOnboardingStep(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 100, profile: { id: '1', username: 'moussa_dev', display_name: 'Moussa Diop', clan: null, mastery: null, xp: 0, onboarding_step: 1 } },
    refreshMember,
  }),
}))

import { ChooseClan } from '../pages/ChooseClan'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/inscription/clan']}>
      <Routes>
        <Route path="/inscription/clan" element={<ChooseClan />} />
        <Route path="/cite" element={<p>arrived</p>} />
        <Route path="/connexion" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { setCharacter.mockReset(); setOnboardingStep.mockReset(); refreshMember.mockReset() })

describe('ChooseClan', () => {
  it('cannot enter before a clan is chosen', () => {
    mount()
    expect(screen.getByRole('button', { name: /Entrer dans la Cité/ })).toBeDisabled()
  })

  it('shows the choice live in the preview', async () => {
    mount()
    await userEvent.click(screen.getByRole('radio', { name: /Saltigué/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Bagne/ }))
    const preview = screen.getByLabelText('Aperçu en direct')
    expect(preview).toHaveTextContent('Saltigué')
    expect(preview).toHaveTextContent('Bagne')
    expect(preview).toHaveTextContent('Moussa Diop')
  })

  it('saves the character with the database names and goes to the city', async () => {
    setCharacter.mockResolvedValue(undefined)
    setOnboardingStep.mockResolvedValue(undefined)
    mount()
    await userEvent.click(screen.getByRole('radio', { name: /Buur\/Lingeer/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Borom Xam-Xam/ }))
    await userEvent.click(screen.getByRole('button', { name: /Entrer dans la Cité/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
    expect(setCharacter).toHaveBeenCalledWith('buur_linguere', 'borom_xam_xam')
    expect(setOnboardingStep).toHaveBeenCalledWith(4)
  })

  it('shows a French message when the database refuses', async () => {
    setCharacter.mockRejectedValue(new Error('Your character is already chosen and cannot be changed'))
    mount()
    await userEvent.click(screen.getByRole('radio', { name: /Forgeron/ }))
    await userEvent.click(screen.getByRole('button', { name: /Entrer dans la Cité/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà choisi')
    expect(screen.queryByText('arrived')).not.toBeInTheDocument()
  })
})
