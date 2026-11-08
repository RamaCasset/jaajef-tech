import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadMyProfileFields = vi.fn()
const updateMyProfile = vi.fn()
const loadProfile = vi.fn()
const refreshMember = vi.fn()
vi.mock('../lib/api', () => ({
  loadMyProfileFields: (...a: unknown[]) => loadMyProfileFields(...a),
  updateMyProfile: (...a: unknown[]) => updateMyProfile(...a),
  loadProfile: (...a: unknown[]) => loadProfile(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'me' } }, refreshMember,
    member: { kopeks: 1, profile: { id: 'me', username: 'moussa', display_name: 'Moussa' } }, signOut: vi.fn(),
  }),
}))

import { EditProfile } from '../pages/EditProfile'
import { Profile } from '../pages/Profile'

beforeEach(() => {
  for (const f of [loadMyProfileFields, updateMyProfile, loadProfile, refreshMember]) f.mockReset()
  loadMyProfileFields.mockResolvedValue({ display_name: 'Moussa Diop', bio: 'Dev', location: 'Dakar', available_to_collab: false })
  updateMyProfile.mockResolvedValue(undefined)
  refreshMember.mockResolvedValue(undefined)
})

const mount = () => render(<MemoryRouter><EditProfile /></MemoryRouter>)

describe('Edit profile', () => {
  it('fills the form with what is saved', async () => {
    mount()
    expect(await screen.findByLabelText('Nom affiché')).toHaveValue('Moussa Diop')
    expect(screen.getByLabelText('Présentation')).toHaveValue('Dev')
    expect(screen.getByLabelText('Lieu')).toHaveValue('Dakar')
    expect(screen.getByLabelText('Je suis disponible pour collaborer')).not.toBeChecked()
  })

  it('saves the changes for my own account, refreshes the top bar, and links to my profile', async () => {
    mount()
    const name = await screen.findByLabelText('Nom affiché')
    await userEvent.clear(name)
    await userEvent.type(name, 'Moussa D.')
    await userEvent.click(screen.getByLabelText('Je suis disponible pour collaborer'))
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Profil enregistré')
    expect(updateMyProfile).toHaveBeenCalledWith('me', { display_name: 'Moussa D.', bio: 'Dev', location: 'Dakar', available_to_collab: true })
    expect(refreshMember).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Voir mon profil' })).toHaveAttribute('href', '/profil/moussa')
  })

  it('cannot save with an empty name', async () => {
    mount()
    await userEvent.clear(await screen.findByLabelText('Nom affiché'))
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nom affiché'), '   ')
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  it('shows a refusal and does not claim it saved', async () => {
    updateMyProfile.mockRejectedValue(new Error('new row for relation "profiles" violates check constraint "profiles_display_name_check"'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être vide')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(refreshMember).not.toHaveBeenCalled()
  })

  it('offers a retry when loading fails', async () => {
    loadMyProfileFields.mockRejectedValueOnce(new Error('down'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByLabelText('Nom affiché')).toBeInTheDocument()
  })
})

describe('Edit link on a profile', () => {
  const data = (id: string) => ({
    profile: { id, username: 'awa', display_name: 'Awa', avatar_url: null, banner_url: null, bio: null, location: null, github_username: null, clan: null, mastery: null, xp: 0, available_to_collab: false, is_verified: false, created_at: '2026-01-01T00:00:00Z' },
    xpPerLevel: 100, badges: [], projects: [], questsSolved: null, appreciation: 0,
  })
  const show = () => render(<MemoryRouter initialEntries={['/profil/awa']}><Routes><Route path="/profil/:username" element={<Profile />} /></Routes></MemoryRouter>)

  it('is there on my profile only', async () => {
    loadProfile.mockResolvedValue(data('me'))
    const first = show()
    expect(await screen.findByRole('link', { name: 'Modifier mon profil' })).toHaveAttribute('href', '/parametres/profil')
    first.unmount()
    loadProfile.mockResolvedValue(data('someone'))
    show()
    await screen.findByText('Awa')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Modifier mon profil' })).not.toBeInTheDocument())
  })
})
